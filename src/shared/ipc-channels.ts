/**
 * Channel allow-lists. Kept free of runtime dependencies because the sandboxed
 * preload script can only load `electron` — it must not pull in zod.
 */
import type { EventChannel, InvokeChannel } from './ipc'

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
