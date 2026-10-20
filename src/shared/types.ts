/** States reported by `adb devices -l`. */
export type AdbDeviceState =
  | 'device'
  | 'unauthorized'
  | 'offline'
  | 'authorizing'
  | 'connecting'
  | 'no permissions'
  | 'recovery'
  | 'sideload'
  | 'bootloader'
  | 'host'
  | 'unknown'

export type ConnectionKind = 'usb' | 'wireless'

/** One row of `adb devices -l`. */
export interface AdbDeviceEntry {
  serial: string
  state: AdbDeviceState
  kind: ConnectionKind
  product?: string
  model?: string
  device?: string
  transportId?: string
}

/** Details fetched from the device once it is authorized. */
export interface DeviceDetails {
  manufacturer?: string
  model?: string
  androidVersion?: string
  sdkInt?: number
  /** Physical screen size reported by `wm size` (portrait-native), e.g. 1080x2400. */
  screenWidth?: number
  screenHeight?: number
  density?: number
}

export interface DeviceInfo extends AdbDeviceEntry {
  details?: DeviceDetails
}

export interface Size {
  width: number
  height: number
}

export type MirrorPhase = 'idle' | 'starting' | 'streaming' | 'reconnecting' | 'stopping' | 'error'

export interface MirrorState {
  phase: MirrorPhase
  serial: string | null
  /** Human-readable step during `starting`, e.g. "Pushing server". */
  step?: string
  /** Current encoded video size (changes on rotation). */
  videoSize?: Size
  deviceName?: string
  error?: AppErrorInfo
  reconnectAttempt?: number
}

export type AppErrorCode =
  | 'ADB_NOT_FOUND'
  | 'ADB_FAILED'
  | 'NO_DEVICE'
  | 'DEVICE_UNAUTHORIZED'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_NO_PERMISSIONS'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_UNSUPPORTED'
  | 'DEVICE_DISCONNECTED'
  | 'SERVER_MISSING'
  | 'SERVER_START_FAILED'
  | 'SERVER_CONNECT_FAILED'
  | 'ENCODER_FAILED'
  | 'DECODER_FAILED'
  | 'WIRELESS_FAILED'
  | 'PAIRING_FAILED'
  | 'SCREENSHOT_FAILED'
  | 'RECORDING_FAILED'
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN'

export interface AppErrorInfo {
  code: AppErrorCode
  message: string
  hint?: string
  /** Technical detail for the diagnostic log / "details" disclosure. */
  detail?: string
}

export interface RecordingStatus {
  active: boolean
  filePath?: string
  startedAt?: number
  /** Files written so far (a rotation splits the recording into parts). */
  parts: string[]
  bytesWritten: number
}

export interface StreamStats {
  fps: number
  kbps: number
}

export interface AdbStatus {
  available: boolean
  path?: string
  version?: string
  source?: 'custom' | 'system' | 'bundled'
  error?: AppErrorInfo
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppErrorInfo }
