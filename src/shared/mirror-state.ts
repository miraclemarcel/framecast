import type { AppErrorInfo, MirrorState, Size } from './types'

/**
 * Events driving the mirroring lifecycle. Kept as a pure reducer so transitions
 * are unit-testable independently of processes and sockets.
 */
export type MirrorEvent =
  | { type: 'START'; serial: string }
  | { type: 'STEP'; step: string }
  | { type: 'STREAM_READY'; deviceName: string }
  | { type: 'VIDEO_SIZE'; size: Size }
  | { type: 'STOP' }
  | { type: 'STOPPED' }
  | { type: 'FAILED'; error: AppErrorInfo }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'RESET' }

export const INITIAL_MIRROR_STATE: MirrorState = { phase: 'idle', serial: null }

export function mirrorReducer(state: MirrorState, event: MirrorEvent): MirrorState {
  switch (event.type) {
    case 'START':
      if (state.phase === 'starting' || state.phase === 'streaming' || state.phase === 'stopping') return state
      return { phase: 'starting', serial: event.serial, step: 'Preparing', reconnectAttempt: state.reconnectAttempt }

    case 'STEP':
      if (state.phase !== 'starting' && state.phase !== 'reconnecting') return state
      return { ...state, step: event.step }

    case 'STREAM_READY':
      if (state.phase !== 'starting' && state.phase !== 'reconnecting') return state
      return { phase: 'streaming', serial: state.serial, deviceName: event.deviceName, videoSize: state.videoSize }

    case 'VIDEO_SIZE':
      if (state.phase !== 'starting' && state.phase !== 'streaming' && state.phase !== 'reconnecting') return state
      return { ...state, videoSize: event.size }

    case 'STOP':
      if (state.phase === 'idle' || state.phase === 'stopping') return state
      return { ...state, phase: 'stopping', step: undefined }

    case 'STOPPED':
    case 'RESET':
      // Keep the same object when nothing changes, so no redundant update is broadcast.
      return state.phase === 'idle' && state.serial === null && !state.error ? state : { ...INITIAL_MIRROR_STATE }

    case 'FAILED':
      // A stop requested by the user wins over late errors from tearing down sockets.
      if (state.phase === 'stopping' || state.phase === 'idle') return { ...INITIAL_MIRROR_STATE }
      return { phase: 'error', serial: state.serial, error: event.error }

    case 'RECONNECTING':
      if (state.serial === null) return state
      return {
        phase: 'reconnecting',
        serial: state.serial,
        reconnectAttempt: event.attempt,
        step: 'Waiting for device',
        error: state.error
      }
  }
}

export function isMirrorActive(state: MirrorState): boolean {
  return state.phase === 'starting' || state.phase === 'streaming' || state.phase === 'reconnecting'
}
