import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SCRCPY_SERVER_VERSION } from '@services/scrcpy/protocol'

/** `resources/bin` in development, `<install>/resources/bin` when packaged (see electron-builder extraResources). */
export function binDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'resources', 'bin')
}

export function bundledAdbDir(): string {
  return join(binDir(), 'platform-tools')
}

export function serverJarPath(): string {
  return join(binDir(), `scrcpy-server-v${SCRCPY_SERVER_VERSION}`)
}

export function serverAvailable(): boolean {
  return existsSync(serverJarPath())
}

export function logFilePath(): string {
  return join(app.getPath('logs'), 'framecast.log')
}

export function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function defaultScreenshotDir(): string {
  return join(app.getPath('pictures'), 'FrameCast')
}

export function defaultRecordingDir(): string {
  return join(app.getPath('videos'), 'FrameCast')
}
