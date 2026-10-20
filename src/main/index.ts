import { app, BrowserWindow, clipboard, Menu, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import { AdbManager } from '@services/adb/adb-manager'
import { defaultLocatorEnv } from '@services/adb/adb-locator'
import { DeviceMonitor } from '@services/adb/device-monitor'
import { ProcessRegistry } from '@services/process/process-registry'
import { ScrcpySession } from '@services/scrcpy/session'
import type { Settings } from '@shared/settings'
import type { AppContext } from './context'
import { broadcast, registerIpc } from './ipc'
import { Logger } from './logger'
import { MirrorController } from './mirror-controller'
import { bundledAdbDir, logFilePath, serverJarPath, settingsFilePath } from './paths'
import { SettingsStore } from './settings-store'

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const logger = new Logger(logFilePath())
const log = logger.scope('main')
const registry = new ProcessRegistry()
const settings = new SettingsStore(settingsFilePath())
let mainWindow: BrowserWindow | null = null

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
  window: () => mainWindow,
  logger,
  settings,
  registry,
  adb,
  monitor,
  mirror,
  savedFiles: new Set()
}

function titleBarColors(): { color: string; symbolColor: string } {
  const theme = settings.get().theme
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? { color: '#0e1014', symbolColor: '#c3c8d0' } : { color: '#f4f5f7', symbolColor: '#3a3f47' }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'FrameCast',
    backgroundColor: titleBarColors().color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...titleBarColors(), height: 44 },
    // Packaged builds use the icon embedded in the .exe.
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.on('enter-full-screen', () => broadcast(win, 'window:fullscreen', true))
  win.on('leave-full-screen', () => broadcast(win, 'window:fullscreen', false))

  // No popups and no navigation away from the app; https links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })
  // No application menu: its accelerators (Ctrl+R, Ctrl+W…) would swallow keys meant for the phone.
  win.removeMenu()
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }
  win.webContents.on('render-process-gone', (_e, details) => log.error(`Renderer gone: ${details.reason}`))

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function wireEvents(): void {
  const send = <T>(channel: string, payload: T): void => broadcast(mainWindow, channel, payload)
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
  mirror.on('video', (ev) => send('mirror:video', ev))
  mirror.on('recording', (r) => send('recording:status', r))
  adb.on('status', (s) => send('adb:status', s))

  let previous = settings.get()
  settings.on('changed', (next) => {
    send('settings:changed', next)
    if (JSON.stringify(previous.adb) !== JSON.stringify(next.adb)) {
      void adb.init(next.adb).then(() => monitor.refresh())
    }
    if (previous.theme !== next.theme) mainWindow?.setTitleBarOverlay({ ...titleBarColors(), height: 44 })
    previous = next
  })
  nativeTheme.on('updated', () => mainWindow?.setTitleBarOverlay({ ...titleBarColors(), height: 44 }))
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

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => app.quit())

app.whenReady().then(async () => {
  app.setAppUserModelId('com.framecast.app')
  log.info(`FrameCast ${app.getVersion()} starting (Electron ${process.versions.electron})`)

  // The renderer needs no browser permissions (camera, geolocation, notifications…).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  Menu.setApplicationMenu(null)
  registerIpc(ctx)
  wireEvents()
  createWindow()

  await adb.init(settings.get().adb)
  monitor.start()
})
