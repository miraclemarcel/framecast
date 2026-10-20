import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  CONTROL_CHANNEL,
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type FramecastApi,
  type InvokeChannel
} from '@shared/ipc'

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Channels are allow-listed; all arguments are validated again in the main process.
 */
const api: FramecastApi = {
  invoke: ((channel: InvokeChannel, args?: unknown) => {
    if (!INVOKE_CHANNELS.includes(channel)) return Promise.reject(new Error(`Blocked channel ${channel}`))
    return ipcRenderer.invoke(channel, args)
  }) as FramecastApi['invoke'],

  on: ((channel: EventChannel, listener: (payload: unknown) => void) => {
    if (!EVENT_CHANNELS.includes(channel)) throw new Error(`Blocked channel ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }) as FramecastApi['on'],

  control: (command) => ipcRenderer.send(CONTROL_CHANNEL, command)
}

contextBridge.exposeInMainWorld('framecast', api)
