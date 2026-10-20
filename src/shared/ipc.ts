import { z } from 'zod'
import type {
  AdbStatus,
  AppErrorInfo,
  DeviceInfo,
  IpcResult,
  MirrorState,
  RecordingStatus
} from './types'
import type { Settings, SettingsPatch } from './settings'

/** Serial numbers come from `adb devices`; restrict to characters adb actually uses. */
export const serialSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:\-\[\]%]+$/, 'Invalid device serial')

/** IPv4, IPv6 (bare) or hostname. */
export const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$|^[0-9a-fA-F:]+$/, 'Invalid host')

export const portSchema = z.number().int().min(1).max(65535)

export const wirelessConnectSchema = z.object({ host: hostSchema, port: portSchema })
export const wirelessPairSchema = z.object({
  host: hostSchema,
  port: portSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'The pairing code has 6 digits')
})
export const enableTcpipSchema = z.object({ serial: serialSchema, port: portSchema })
export const serialArgSchema = z.object({ serial: serialSchema })
export const pathArgSchema = z.object({ path: z.string().min(1).max(4096) })
export const savePngSchema = z.object({
  data: z.instanceof(Uint8Array).refine((d) => d.byteLength > 0 && d.byteLength < 200_000_000),
  suffix: z.string().regex(/^[a-z-]{0,24}$/).optional()
})
export const directoryPurposeSchema = z.object({ purpose: z.enum(['screenshot', 'recording']) })
export const externalUrlSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => ALLOWED_EXTERNAL_HOSTS.some((h) => new URL(u).hostname === h) && u.startsWith('https://'))
})
export const ALLOWED_EXTERNAL_HOSTS = ['developer.android.com', 'github.com', 'support.google.com']

const i32 = z.number().int().min(-2147483648).max(2147483647)
const u16 = z.number().int().min(0).max(0xffff)
const position = { x: i32, y: i32, width: u16, height: u16 }

/** High-level control commands accepted from the renderer, validated before serialization. */
export const controlCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('touch'),
    action: z.enum(['down', 'up', 'move', 'hover']),
    /** -1 = mouse, -2 = generic finger, >= 0 = specific finger. */
    pointerId: z.number().int().min(-3).max(31),
    ...position,
    pressure: z.number().min(0).max(1),
    actionButton: z.number().int().min(0).max(0xff),
    buttons: z.number().int().min(0).max(0xff)
  }),
  z.object({
    type: z.literal('scroll'),
    ...position,
    hScroll: z.number().min(-16).max(16),
    vScroll: z.number().min(-16).max(16),
    buttons: z.number().int().min(0).max(0xff)
  }),
  z.object({
    type: z.literal('key'),
    action: z.enum(['down', 'up']),
    keycode: z.number().int().min(0).max(400),
    repeat: z.number().int().min(0).max(10000),
    metaState: z.number().int().min(0).max(0x7fffffff)
  }),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(300) }),
  z.object({
    type: z.literal('nav'),
    key: z.enum(['back', 'home', 'recents', 'power', 'volumeUp', 'volumeDown', 'menu'])
  }),
  z.object({ type: z.literal('backOrScreenOn'), action: z.enum(['down', 'up']) }),
  z.object({ type: z.literal('rotate') }),
  z.object({ type: z.literal('panel'), panel: z.enum(['notifications', 'settings', 'collapse']) }),
  /** Paste the host clipboard into the device; the main process fills in `text` itself. */
  z.object({ type: z.literal('paste'), text: z.string().max(100_000).optional() }),
  z.object({ type: z.literal('displayPower'), on: z.boolean() }),
  z.object({ type: z.literal('resetVideo') })
])

export type ControlCommand = z.infer<typeof controlCommandSchema>

/** Video stream events forwarded from the main process to the renderer. */
export type VideoEvent =
  | { kind: 'session'; width: number; height: number }
  | { kind: 'packet'; config: boolean; key: boolean; pts: number; data: Uint8Array }
  | { kind: 'end' }

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  scrcpyServerVersion: string
  serverAvailable: boolean
  logPath: string
}

export interface ToastMessage {
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  /** Optional file the toast refers to, offered as "Show in folder". */
  filePath?: string
}

/** Invoke channels: request → response. */
export interface InvokeMap {
  'app:info': { args: void; result: AppInfo }
  'adb:status': { args: void; result: AdbStatus }
  'adb:restart': { args: void; result: AdbStatus }
  'settings:get': { args: void; result: Settings }
  'settings:update': { args: SettingsPatch; result: Settings }
  'settings:reset': { args: void; result: Settings }
  'devices:list': { args: void; result: DeviceInfo[] }
  'devices:connectWireless': { args: z.infer<typeof wirelessConnectSchema>; result: string }
  'devices:pair': { args: z.infer<typeof wirelessPairSchema>; result: string }
  'devices:enableTcpip': { args: z.infer<typeof enableTcpipSchema>; result: string }
  'devices:disconnectWireless': { args: z.infer<typeof serialArgSchema>; result: void }
  'mirror:start': { args: z.infer<typeof serialArgSchema>; result: void }
  'mirror:stop': { args: void; result: void }
  'mirror:state': { args: void; result: MirrorState }
  'capture:screenshot': { args: void; result: string | null }
  'capture:grab': { args: void; result: Uint8Array }
  'capture:savePng': { args: z.infer<typeof savePngSchema>; result: string | null }
  'capture:startRecording': { args: void; result: RecordingStatus }
  'capture:stopRecording': { args: void; result: RecordingStatus }
  'capture:recordingStatus': { args: void; result: RecordingStatus }
  'dialog:chooseDirectory': { args: z.infer<typeof directoryPurposeSchema>; result: string | null }
  'shell:showItemInFolder': { args: z.infer<typeof pathArgSchema>; result: void }
  'shell:openExternal': { args: z.infer<typeof externalUrlSchema>; result: void }
  'shell:openLogs': { args: void; result: void }
  'window:setFullScreen': { args: { value: boolean }; result: boolean }
}

/** Events pushed from main to renderer. */
export interface EventMap {
  'devices:changed': DeviceInfo[]
  'mirror:state': MirrorState
  'mirror:video': VideoEvent
  'recording:status': RecordingStatus
  'settings:changed': Settings
  'window:fullscreen': boolean
  'adb:status': AdbStatus
  toast: ToastMessage
}

export type InvokeChannel = keyof InvokeMap
export type EventChannel = keyof EventMap

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  'app:info',
  'adb:status',
  'adb:restart',
  'settings:get',
  'settings:update',
  'settings:reset',
  'devices:list',
  'devices:connectWireless',
  'devices:pair',
  'devices:enableTcpip',
  'devices:disconnectWireless',
  'mirror:start',
  'mirror:stop',
  'mirror:state',
  'capture:screenshot',
  'capture:grab',
  'capture:savePng',
  'capture:startRecording',
  'capture:stopRecording',
  'capture:recordingStatus',
  'dialog:chooseDirectory',
  'shell:showItemInFolder',
  'shell:openExternal',
  'shell:openLogs',
  'window:setFullScreen'
]

export const EVENT_CHANNELS: readonly EventChannel[] = [
  'devices:changed',
  'mirror:state',
  'mirror:video',
  'recording:status',
  'settings:changed',
  'window:fullscreen',
  'adb:status',
  'toast'
]

export const CONTROL_CHANNEL = 'mirror:control'

/** The API exposed on `window.framecast` by the preload script. */
export interface FramecastApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeMap[C]['args'] extends void ? [] : [InvokeMap[C]['args']]
  ): Promise<IpcResult<InvokeMap[C]['result']>>
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void
  control(command: ControlCommand): void
}

export type { AppErrorInfo }
