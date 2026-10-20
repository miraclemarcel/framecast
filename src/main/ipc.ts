import { app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { resolve as resolvePath } from 'node:path'
import { z, ZodError } from 'zod'
import { AppError, errorInfo, toErrorInfo } from '@shared/errors'
import { partFileName } from '@shared/filenames'
import {
  CONTROL_CHANNEL,
  WINDOW_DRAG_CHANNEL,
  controlCommandSchema,
  compactSizeSchema,
  directoryPurposeSchema,
  enableTcpipSchema,
  externalUrlSchema,
  pathArgSchema,
  savePngSchema,
  serialArgSchema,
  wirelessConnectSchema,
  wirelessPairSchema,
  windowModeSchema,
  type InvokeChannel,
  type InvokeMap
} from '@shared/ipc' 
import type { SettingsPatch } from '@shared/settings'
import type { IpcResult } from '@shared/types'
import { Mp4Recorder } from '@services/capture/mp4-recorder'
import { SCRCPY_SERVER_VERSION } from '@services/scrcpy/protocol'
import type { AppContext } from './context'
import { resolveCapturePath, uniquePath, writeCapture } from './capture'
import { serverAvailable } from './paths'

type Handler<C extends InvokeChannel> = (
  args: InvokeMap[C]['args'],
  event: IpcMainInvokeEvent
) => Promise<InvokeMap[C]['result']> | InvokeMap[C]['result']

const settingsPatchSchema = z.record(z.string(), z.unknown())

export function registerIpc(ctx: AppContext): void {
  const log = ctx.logger.scope('ipc')

  /** Only our own renderer (dev server or packaged file) may call privileged APIs. */
  const isTrusted = (event: { senderFrame: Electron.WebFrameMain | null }): boolean => {
    const url = event.senderFrame?.url ?? ''
    const dev = process.env.ELECTRON_RENDERER_URL
    return (dev !== undefined && url.startsWith(dev)) || url.startsWith('file://')
  }

  function handle<C extends InvokeChannel>(channel: C, schema: z.ZodType | null, fn: Handler<C>): void {
    ipcMain.handle(channel, async (event, raw): Promise<IpcResult<InvokeMap[C]['result']>> => {
      if (!isTrusted(event)) return { ok: false, error: errorInfo('INVALID_ARGUMENT', 'untrusted sender') }
      try {
        const args = (schema ? schema.parse(raw) : undefined) as InvokeMap[C]['args']
        return { ok: true, value: await fn(args, event) }
      } catch (err) {
        if (err instanceof ZodError) {
          return { ok: false, error: { ...errorInfo('INVALID_ARGUMENT'), message: err.issues[0]?.message ?? 'Invalid request' } }
        }
        const info = toErrorInfo(err)
        log.warn(`${channel} failed: ${info.code} ${info.detail ?? info.message}`)
        return { ok: false, error: info }
      }
    })
  }

  const deviceNameFor = (serial: string): string => {
    const state = ctx.mirror.state
    if (state.serial === serial && state.deviceName) return state.deviceName
    const d = ctx.monitor.find(serial)
    return d?.details?.model ?? d?.model ?? serial
  }

  const requireMirroredSerial = (code: 'SCREENSHOT_FAILED' | 'RECORDING_FAILED'): string => {
    const serial = ctx.mirror.currentSerial
    if (!serial || ctx.mirror.state.phase !== 'streaming') {
      throw new AppError(code, { message: 'Start mirroring a device first.', hint: undefined })
    }
    return serial
  }

  // --- App / ADB ---------------------------------------------------------
  handle('app:info', null, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    scrcpyServerVersion: SCRCPY_SERVER_VERSION,
    serverAvailable: serverAvailable(),
    logPath: ctx.logger.filePath
  }))
  handle('adb:status', null, () => ctx.adb.status)
  handle('adb:restart', null, async () => {
    const status = await ctx.adb.init(ctx.settings.get().adb)
    void ctx.monitor.refresh()
    return status
  })

  // --- Settings ----------------------------------------------------------
  handle('settings:get', null, () => ctx.settings.get())
  handle('settings:update', settingsPatchSchema, (patch) => ctx.settings.update(patch as SettingsPatch))
  handle('settings:reset', null, () => ctx.settings.reset())

  // --- Devices -----------------------------------------------------------
  handle('devices:list', null, () => ctx.monitor.refresh())
  handle('devices:connectWireless', wirelessConnectSchema, async ({ host, port }) => {
    const target = await ctx.adb.require().connect(host, port)
    ctx.settings.update({ connection: { lastWirelessHost: host, wirelessPort: port } })
    await ctx.monitor.refresh()
    return target
  })
  handle('devices:pair', wirelessPairSchema, ({ host, port, code }) => ctx.adb.require().pair(host, port, code))
  handle('devices:enableTcpip', enableTcpipSchema, async ({ serial, port }) => {
    const adb = ctx.adb.require()
    // Read the IP first: `adb tcpip` restarts adbd and briefly drops the USB connection.
    const ip = await adb.wlanIp(serial).catch(() => undefined)
    if (!ip) {
      throw new AppError('WIRELESS_FAILED', {
        message: 'Could not find the phone’s Wi-Fi address.',
        hint: 'Connect the phone to the same Wi-Fi network as this computer and try again.'
      })
    }
    await adb.tcpip(serial, port)
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        const target = await adb.connect(ip, port)
        ctx.settings.update({ connection: { lastWirelessHost: ip, wirelessPort: port } })
        await ctx.monitor.refresh()
        return target
      } catch (err) {
        lastError = err
      }
    }
    throw lastError instanceof AppError ? lastError : new AppError('WIRELESS_FAILED', { cause: lastError })
  })
  handle('devices:disconnectWireless', serialArgSchema, async ({ serial }) => {
    if (ctx.mirror.currentSerial === serial) await ctx.mirror.stop()
    await ctx.adb.require().disconnect(serial)
    await ctx.monitor.refresh()
  })

  // --- Mirroring ---------------------------------------------------------
  handle('mirror:start', serialArgSchema, async ({ serial }) => {
    if (!serverAvailable()) throw new AppError('SERVER_MISSING')
    ctx.adb.require()
    await ctx.monitor.refresh()
    await ctx.mirror.start(serial)
  })
  handle('mirror:stop', null, () => ctx.mirror.stop())
  handle('mirror:state', null, () => ctx.mirror.state)

  ipcMain.on(CONTROL_CHANNEL, (event, raw) => {
    if (!isTrusted(event)) return
    const parsed = controlCommandSchema.safeParse(raw)
    if (!parsed.success) {
      log.debug(`Rejected control command: ${parsed.error.issues[0]?.message}`)
      return
    }
    const cmd = parsed.data
    if (cmd.type === 'paste') {
      // Read the host clipboard here so the renderer never needs clipboard permissions.
      void clipboard.readText().then((text) => {
        if (text) ctx.mirror.control({ type: 'paste', text })
      })
      return
    }
    ctx.mirror.control(cmd)
  })

  ipcMain.on(WINDOW_DRAG_CHANNEL, (event, phase: unknown) => {
    if (!isTrusted(event)) return
    if (phase === 'start') ctx.windows.beginDrag()
    else if (phase === 'move') ctx.windows.dragTo()
    else if (phase === 'end') ctx.windows.endDrag()
  })

  // --- Capture -----------------------------------------------------------
  handle('capture:screenshot', null, async () => {
    const serial = requireMirroredSerial('SCREENSHOT_FAILED')
    const png = await ctx.adb.require().screencap(serial)
    const path = await resolveCapturePath(ctx.window(), ctx.settings.get(), 'screenshot', deviceNameFor(serial))
    if (!path) return null
    await writeCapture(path, png)
    ctx.savedFiles.add(resolvePath(path))
    log.info(`Screenshot saved (${png.length} bytes)`)
    return path
  })
  handle('capture:grab', null, async () => {
    const serial = requireMirroredSerial('SCREENSHOT_FAILED')
    return new Uint8Array(await ctx.adb.require().screencap(serial))
  })
  handle('capture:savePng', savePngSchema, async ({ data, suffix }) => {
    const serial = requireMirroredSerial('SCREENSHOT_FAILED')
    const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
    if (!PNG_MAGIC.every((b, i) => data[i] === b)) throw new AppError('INVALID_ARGUMENT', { detail: 'not a PNG' })
    const path = await resolveCapturePath(ctx.window(), ctx.settings.get(), 'screenshot', deviceNameFor(serial), suffix)
    if (!path) return null
    await writeCapture(path, data)
    ctx.savedFiles.add(resolvePath(path))
    return path
  })
  handle('capture:startRecording', null, async () => {
    const serial = requireMirroredSerial('RECORDING_FAILED')
    if (ctx.mirror.recordingStatus.active) return ctx.mirror.recordingStatus
    const path = await resolveCapturePath(ctx.window(), ctx.settings.get(), 'recording', deviceNameFor(serial))
    if (!path) return ctx.mirror.recordingStatus
    const recorder = new Mp4Recorder((part) => {
      const file = part === 1 ? path : uniquePath(partFileName(path, part))
      ctx.savedFiles.add(resolvePath(file))
      return file
    })
    log.info('Recording started')
    return ctx.mirror.startRecording(recorder)
  })
  handle('capture:stopRecording', null, () => {
    const status = ctx.mirror.stopRecording()
    log.info(`Recording stopped (${status.parts.length} file(s), ${status.bytesWritten} bytes)`)
    return status
  })
  handle('capture:recordingStatus', null, () => ctx.mirror.recordingStatus)

  // --- Dialogs / shell ---------------------------------------------------
  handle('dialog:chooseDirectory', directoryPurposeSchema, async ({ purpose }) => {
    const win = ctx.window()
    const options: Electron.OpenDialogOptions = {
      title: purpose === 'screenshot' ? 'Screenshot folder' : 'Recording folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const dir = result.canceled ? null : (result.filePaths[0] ?? null)
    if (dir) ctx.settings.update({ capture: purpose === 'screenshot' ? { screenshotDir: dir } : { recordingDir: dir } })
    return dir
  })
  handle('shell:showItemInFolder', pathArgSchema, ({ path }) => {
    // Only reveal files FrameCast itself wrote.
    if (!ctx.savedFiles.has(resolvePath(path))) throw new AppError('INVALID_ARGUMENT', { detail: 'unknown file' })
    shell.showItemInFolder(path)
  })
  handle('shell:openExternal', externalUrlSchema, async ({ url }) => {
    await shell.openExternal(url)
  })
  handle('shell:openLogs', null, async () => {
    await shell.openPath(ctx.logger.directory)
  })
  handle('window:setFullScreen', z.object({ value: z.boolean() }), ({ value }) => {
    const win = ctx.window()
    win?.setFullScreen(value)
    return win?.isFullScreen() ?? false
  })
  handle('window:setMode', windowModeSchema, ({ mode, dialog }) => {
    const result = ctx.windows.setMode(mode)
    if (mode === 'full' && dialog) ctx.windows.broadcast('ui:openDialog', dialog)
    return result
  })
  handle('window:getMode', null, () => ctx.windows.mode)
  handle('window:setCompactSize', compactSizeSchema, ({ width, height }) => ctx.windows.setCompactSize(width, height))
  handle('window:minimize', null, () => ctx.windows.minimize())
}
