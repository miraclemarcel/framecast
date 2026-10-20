import { app, clipboard, Menu, nativeTheme, session } from 'electron'
import { AdbManager } from '@services/adb/adb-manager'
import { defaultLocatorEnv } from '@services/adb/adb-locator'
import { DeviceMonitor } from '@services/adb/device-monitor'
import { ProcessRegistry } from '@services/process/process-registry'
import { ScrcpySession } from '@services/scrcpy/session'
import type { Settings } from '@shared/settings'
import type { AppContext } from './context'
import { registerIpc } from './ipc'
import { Logger } from './logger'
import { MirrorController } from './mirror-controller'
import { bundledAdbDir, logFilePath, serverJarPath, settingsFilePath } from './paths'
import { SettingsStore } from './settings-store'
import { WindowManager } from './windows'

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const logger = new Logger(logFilePath())
const log = logger.scope('main')
const registry = new ProcessRegistry()
const settings = new SettingsStore(settingsFilePath())
const windows = new WindowManager(settings, logger.scope('window'))

const adb = new AdbManager({
  registry,
  locatorEnv: defaultLocatorEnv(bundledAdbDir()),
  log: (level, m) => logger.log(level, 'adb', m)
})
const monitor = new DeviceMonitor(() => adb.get())

const mirror = new MirrorController({
  createSession: (serial: string, s: Settings) =>
    new ScrcpySession(adb.require(), registry, {
      serial,
      serverJarPath: serverJarPath(),
      launch: { video: s.video, control: s.control },
      log: (level, m) => logger.log(level, 'scrcpy', m)
    }),
  getSettings: () => settings.get(),
  findDevice: (serial) => monitor.find(serial),
  onClipboard: (text) => void clipboard.writeText(text),
  log: logger.scope('mirror')
})

const ctx: AppContext = {
  window: () => windows.active(),
  windows,
  logger,
  settings,
  registry,
  adb,
  monitor,
  mirror,
  savedFiles: new Set()
}

function wireEvents(): void {
  const send = (channel: string, payload: unknown): void => windows.broadcast(channel, payload)
  monitor.on('changed', (list) => send('devices:changed', list))
  monitor.on('error', (err) => log.warn(`Device polling: ${err.code} ${err.detail ?? ''}`))
  monitor.on('ready', (d) => {
    mirror.onDeviceReady(d.serial)
    const s = settings.get().connection
    if (s.autoStartOnConnect && mirror.state.phase === 'idle') {
      mirror.start(d.serial).catch((e: Error) => log.warn(`Auto-start failed: ${e.message}`))
    }
  })
  monitor.on('lost', (serial) => mirror.onDeviceLost(serial))
  mirror.on('state', (s) => send('mirror:state', s))
  // Video goes only to the visible window so frames are decoded once.
  mirror.on('video', (ev) => windows.sendActive('mirror:video', ev))
  mirror.on('recording', (r) => send('recording:status', r))
  adb.on('status', (s) => send('adb:status', s))
  // The newly visible window has no decoder state yet: ask the phone for a key frame.
  windows.onActiveChanged = () => {
    send('window:mode', windows.mode)
    mirror.control({ type: 'resetVideo' })
  }

  let previous = settings.get()
  settings.on('changed', (next) => {
    send('settings:changed', next)
    if (JSON.stringify(previous.adb) !== JSON.stringify(next.adb)) {
      void adb.init(next.adb).then(() => monitor.refresh())
    }
    if (previous.theme !== next.theme) windows.updateTitleBar()
    if (previous.display.compactAlwaysOnTop !== next.display.compactAlwaysOnTop) {
      windows.setAlwaysOnTop(next.display.compactAlwaysOnTop)
    }
    previous = next
  })
  nativeTheme.on('updated', () => windows.updateTitleBar())
}

let quitting = false
async function shutdown(): Promise<void> {
  log.info('Shutting down')
  monitor.stop()
  try {
    await Promise.race([mirror.stop(), new Promise((r) => setTimeout(r, 3000))])
  } catch (err) {
    log.warn(`Stopping mirroring failed: ${(err as Error).message}`)
  }
  await registry.killAll()
  await adb.shutdown(settings.get().adb.stopServerOnExit)
}

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void shutdown().finally(() => app.exit(0))
})
process.on('exit', () => registry.killAllSync())

app.on('second-instance', () => windows.focusActive())

app.on('window-all-closed', () => app.quit())

app.whenReady().then(async () => {
  app.setAppUserModelId('com.framecast.app')
  log.info(`FrameCast ${app.getVersion()} starting (Electron ${process.versions.electron})`)

  // The renderer needs no browser permissions (camera, geolocation, notifications…).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  Menu.setApplicationMenu(null)
  registerIpc(ctx)
  wireEvents()
  windows.createMain()

  await adb.init(settings.get().adb)
  monitor.start()
})
