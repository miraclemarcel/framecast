import type { FramecastApi } from '../shared/ipc'

declare global {
  interface Window {
    framecast: FramecastApi
  }
}

export {}
