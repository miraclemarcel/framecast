import type { BrowserWindow } from 'electron'
import type { AdbManager } from '@services/adb/adb-manager'
import type { DeviceMonitor } from '@services/adb/device-monitor'
import type { ProcessRegistry } from '@services/process/process-registry'
import type { Logger } from './logger'
import type { MirrorController } from './mirror-controller'
import type { SettingsStore } from './settings-store'
import type { WindowManager } from './windows'

/** Long-lived services shared by the IPC handlers. */
export interface AppContext {
  /** The visible window (full or compact). */
  window(): BrowserWindow | null
  windows: WindowManager
  logger: Logger
  settings: SettingsStore
  registry: ProcessRegistry
  adb: AdbManager
  monitor: DeviceMonitor
  mirror: MirrorController
  /** Absolute paths of files FrameCast saved; the only ones the renderer may reveal. */
  savedFiles: Set<string>
}
