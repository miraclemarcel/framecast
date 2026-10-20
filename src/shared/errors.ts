import type { AppErrorCode, AppErrorInfo } from './types'

const DEFAULTS: Record<AppErrorCode, { message: string; hint?: string }> = {
  ADB_NOT_FOUND: {
    message: 'ADB (Android Debug Bridge) could not be found.',
    hint: 'Run "npm run fetch-deps" when building from source, install Android SDK Platform-Tools, or set a custom ADB path in Settings → Connection.'
  },
  ADB_FAILED: { message: 'An ADB command failed.' },
  NO_DEVICE: {
    message: 'No Android device is connected.',
    hint: 'Connect your phone with a USB data cable and enable USB debugging (Settings → Developer options).'
  },
  DEVICE_UNAUTHORIZED: {
    message: 'The phone has not authorized this computer yet.',
    hint: 'Unlock the phone and tap "Allow" on the "Allow USB debugging?" prompt. If no prompt appears, unplug and replug the cable, or revoke USB debugging authorizations in Developer options and try again.'
  },
  DEVICE_OFFLINE: {
    message: 'The device is offline.',
    hint: 'Unplug and replug the USB cable. If it persists, toggle USB debugging off and on.'
  },
  DEVICE_NO_PERMISSIONS: {
    message: 'ADB does not have permission to access this device.',
    hint: 'On Windows, install the OEM USB driver for your phone (or the Google USB Driver) and replug the cable.'
  },
  DEVICE_NOT_FOUND: {
    message: 'The selected device is no longer connected.',
    hint: 'Check the cable or Wi-Fi connection and select the device again.'
  },
  DEVICE_UNSUPPORTED: {
    message: 'This device is not supported.',
    hint: 'Mirroring requires Android 5.0 (API 21) or newer.'
  },
  DEVICE_DISCONNECTED: {
    message: 'The device was disconnected.',
    hint: 'Reconnect the phone. Mirroring resumes automatically when auto-reconnect is enabled.'
  },
  SERVER_MISSING: {
    message: 'The mirroring server component (scrcpy-server) is missing.',
    hint: 'Run "npm run fetch-deps" to download it, or reinstall FrameCast.'
  },
  SERVER_START_FAILED: {
    message: 'The mirroring server could not be started on the phone.',
    hint: 'Some manufacturers (e.g. Xiaomi) require enabling "USB debugging (Security settings)" in Developer options.'
  },
  SERVER_CONNECT_FAILED: {
    message: 'Could not connect to the mirroring server on the phone.',
    hint: 'Another mirroring tool may be using the device, or a firewall/antivirus may block local connections. Try again.'
  },
  ENCODER_FAILED: {
    message: 'The phone could not encode its screen at the requested quality.',
    hint: 'Lower the resolution or bitrate in Settings → Video.'
  },
  DECODER_FAILED: {
    message: 'The video stream could not be decoded.',
    hint: 'Try a lower resolution in Settings → Video. Make sure your graphics drivers are up to date.'
  },
  WIRELESS_FAILED: {
    message: 'Could not connect to the device over Wi-Fi.',
    hint: 'Make sure the phone and computer are on the same network and wireless debugging is enabled.'
  },
  PAIRING_FAILED: {
    message: 'Wireless pairing failed.',
    hint: 'Check the pairing code and the pairing port shown in Developer options → Wireless debugging → Pair device with pairing code.'
  },
  SCREENSHOT_FAILED: { message: 'Could not capture a screenshot.' },
  RECORDING_FAILED: { message: 'Screen recording failed.' },
  INVALID_ARGUMENT: { message: 'Invalid request.' },
  UNKNOWN: { message: 'An unexpected error occurred.' }
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly hint?: string
  readonly detail?: string

  constructor(code: AppErrorCode, opts: { message?: string; hint?: string; detail?: string; cause?: unknown } = {}) {
    super(opts.message ?? DEFAULTS[code].message, { cause: opts.cause })
    this.name = 'AppError'
    this.code = code
    this.hint = opts.hint ?? DEFAULTS[code].hint
    this.detail = opts.detail
  }

  toInfo(): AppErrorInfo {
    return { code: this.code, message: this.message, hint: this.hint, detail: this.detail }
  }
}

export function errorInfo(code: AppErrorCode, detail?: string): AppErrorInfo {
  return { code, ...DEFAULTS[code], detail }
}

export function toErrorInfo(err: unknown): AppErrorInfo {
  if (err instanceof AppError) return err.toInfo()
  const detail = err instanceof Error ? err.message : String(err)
  return { ...errorInfo('UNKNOWN'), detail }
}

/** Map raw adb stderr/stdout text to an error code. */
export function classifyAdbOutput(text: string): AppErrorCode | null {
  const t = text.toLowerCase()
  if (t.includes('unauthorized')) return 'DEVICE_UNAUTHORIZED'
  if (t.includes('no permissions') || t.includes('insufficient permissions')) return 'DEVICE_NO_PERMISSIONS'
  if (t.includes('device offline')) return 'DEVICE_OFFLINE'
  if (t.includes('no devices/emulators found') || t.includes('no devices found')) return 'NO_DEVICE'
  if (/device '.*' not found/.test(t) || t.includes('device not found')) return 'DEVICE_NOT_FOUND'
  return null
}

/** Map scrcpy-server stderr/log output to an error code. */
export function classifyServerOutput(text: string): AppErrorCode | null {
  if (/INJECT_EVENTS permission/i.test(text)) return 'SERVER_START_FAILED'
  if (/Could not (?:open|configure|create) (?:video )?encoder|MediaCodec|encoder/i.test(text) && /ERROR/.test(text))
    return 'ENCODER_FAILED'
  if (/does not match the client/i.test(text)) return 'SERVER_START_FAILED'
  if (/ClassNotFoundException|app_process/i.test(text)) return 'SERVER_START_FAILED'
  return null
}
