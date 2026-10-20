import type { Settings } from '@shared/settings'
import { SCRCPY_SERVER_VERSION, SERVER_DEVICE_PATH, SERVER_MAIN_CLASS } from './protocol'

export interface ServerLaunchOptions {
  scid: number
  tunnelForward: boolean
  video: Settings['video']
  control: Settings['control']
  /** Override for a retry after an encoder failure. */
  maxSizeOverride?: number
}

/** 31-bit random session id, formatted by the server as `scrcpy_%08x`. */
export function randomScid(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

export function socketName(scid: number): string {
  return `scrcpy_${scid.toString(16).padStart(8, '0')}`
}

/**
 * Arguments for `adb shell`, which joins them with spaces on the device side.
 * Every value here is numeric, boolean, or a constant, so no shell quoting is needed.
 */
export function buildServerArgs(opts: ServerLaunchOptions): string[] {
  const maxSize = opts.maxSizeOverride ?? opts.video.maxSize
  const args = [
    `CLASSPATH=${SERVER_DEVICE_PATH}`,
    'app_process',
    '/',
    SERVER_MAIN_CLASS,
    SCRCPY_SERVER_VERSION,
    `scid=${opts.scid.toString(16).padStart(8, '0')}`,
    'log_level=info',
    'video=true',
    'audio=false',
    'control=true',
    'video_codec=h264',
    `video_bit_rate=${opts.video.bitRate}`,
    `tunnel_forward=${opts.tunnelForward}`,
    'cleanup=true',
    `clipboard_autosync=${opts.control.clipboardSync}`,
    `stay_awake=${opts.control.stayAwake}`,
    `show_touches=${opts.control.showTouches}`,
    `power_off_on_close=${opts.control.powerOffOnClose}`,
    `downsize_on_error=${opts.video.downsizeOnError}`
  ]
  if (maxSize > 0) args.push(`max_size=${maxSize}`)
  if (opts.video.maxFps > 0) args.push(`max_fps=${opts.video.maxFps}`)
  return args
}

const SCID_PATTERN = /^[0-9a-f]{8}$/
const SAFE_ARG = /^[A-Za-z0-9_=./:-]+$/

/** Defensive check that nothing in the argument list could be interpreted by the device shell. */
export function assertSafeServerArgs(args: string[]): void {
  for (const arg of args) {
    if (!SAFE_ARG.test(arg)) throw new Error(`Unsafe server argument: ${arg}`)
    if (arg.startsWith('scid=') && !SCID_PATTERN.test(arg.slice(5))) throw new Error(`Invalid scid: ${arg}`)
  }
}
