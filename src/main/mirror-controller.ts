import { EventEmitter } from 'node:events'
import { AppError, errorInfo, toErrorInfo } from '@shared/errors'
import type { ControlCommand, VideoEvent } from '@shared/ipc'
import { INITIAL_MIRROR_STATE, mirrorReducer, type MirrorEvent } from '@shared/mirror-state'
import type { Settings } from '@shared/settings'
import type { DeviceInfo, MirrorState, RecordingStatus, Size } from '@shared/types'
import { commandToMessages, serializeControlMessage } from '@services/scrcpy/control'
import type { DeviceMessage, VideoStreamEvent } from '@services/scrcpy/demuxer'
import type { Mp4Recorder } from '@services/capture/mp4-recorder'
import type { ScopedLogger } from './logger'

/** The subset of ScrcpySession the controller depends on (faked in tests). */
export interface SessionLike {
  readonly serial: string
  deviceName: string
  start(onStep: (step: string) => void): Promise<void>
  stop(): Promise<void>
  sendControl(data: Buffer): boolean
  on(event: 'video', listener: (ev: VideoStreamEvent) => void): unknown
  on(event: 'deviceMessage', listener: (msg: DeviceMessage) => void): unknown
  on(event: 'closed', listener: (err: AppError | null) => void): unknown
  removeAllListeners(): unknown
}

export interface MirrorControllerDeps {
  createSession(serial: string, settings: Settings): SessionLike
  getSettings(): Settings
  findDevice(serial: string): DeviceInfo | undefined
  onClipboard(text: string): void
  log: ScopedLogger
  /** Delay before a reconnect attempt; injectable for tests. */
  backoffMs?: (attempt: number) => number
}

export interface MirrorControllerEvents {
  state: [MirrorState]
  video: [VideoEvent]
  recording: [RecordingStatus]
}

const MIN_SDK = 21

export class MirrorController extends EventEmitter<MirrorControllerEvents> {
  private _state: MirrorState = INITIAL_MIRROR_STATE
  private session: SessionLike | null = null
  /** Serial the user wants mirrored; survives disconnects while auto-reconnect is on. */
  private targetSerial: string | null = null
  private attempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private lastConfig: Buffer | null = null
  private lastSize: Size | null = null
  private clipboardSeq = 1n
  private recorder: Mp4Recorder | null = null
  private recordingStartedAt = 0
  private generation = 0

  constructor(private readonly deps: MirrorControllerDeps) {
    super()
  }

  get state(): MirrorState {
    return this._state
  }

  get currentSerial(): string | null {
    return this.session?.serial ?? null
  }

  get videoSize(): Size | null {
    return this.lastSize
  }

  private dispatch(event: MirrorEvent): void {
    const next = mirrorReducer(this._state, event)
    if (next !== this._state) {
      this._state = next
      this.emit('state', next)
    }
  }

  /** Validate the device before launching anything on it. */
  private preflight(serial: string): void {
    const device = this.deps.findDevice(serial)
    if (!device) throw new AppError('DEVICE_NOT_FOUND')
    if (device.state === 'unauthorized' || device.state === 'authorizing') throw new AppError('DEVICE_UNAUTHORIZED')
    if (device.state === 'offline') throw new AppError('DEVICE_OFFLINE')
    if (device.state === 'no permissions') throw new AppError('DEVICE_NO_PERMISSIONS')
    if (device.state !== 'device') throw new AppError('DEVICE_UNSUPPORTED', { detail: `Device is in "${device.state}" mode.` })
    const sdk = device.details?.sdkInt
    if (sdk !== undefined && sdk < MIN_SDK) {
      throw new AppError('DEVICE_UNSUPPORTED', { detail: `Android API ${sdk} detected; API ${MIN_SDK}+ is required.` })
    }
  }

  async start(serial: string): Promise<void> {
    if (this.session && this.session.serial === serial && this._state.phase === 'streaming') return
    await this.stop()
    this.targetSerial = serial
    this.attempts = 0
    this.dispatch({ type: 'RESET' })
    await this.launch(serial)
  }

  private async launch(serial: string): Promise<void> {
    const gen = ++this.generation
    this.dispatch({ type: 'START', serial })
    try {
      this.preflight(serial)
    } catch (err) {
      this.dispatch({ type: 'FAILED', error: toErrorInfo(err) })
      this.targetSerial = null
      throw err
    }

    const session = this.deps.createSession(serial, this.deps.getSettings())
    this.session = session
    this.lastConfig = null
    this.lastSize = null

    session.on('video', (ev) => this.onVideo(session, ev))
    session.on('deviceMessage', (msg) => {
      if (msg.type === 'clipboard' && this.deps.getSettings().control.clipboardSync) this.deps.onClipboard(msg.text)
    })
    session.on('closed', (err) => this.onSessionClosed(session, err))

    try {
      await session.start((step) => {
        if (gen === this.generation) this.dispatch({ type: 'STEP', step })
      })
    } catch (err) {
      session.removeAllListeners()
      if (this.session === session) this.session = null
      if (gen !== this.generation) return // superseded by stop()/start()
      const error = err instanceof AppError ? err : new AppError('SERVER_START_FAILED', { detail: String(err), cause: err })
      this.deps.log.error(`Mirroring start failed: ${error.code} ${error.detail ?? ''}`)
      if (this._state.reconnectAttempt !== undefined && this.shouldRetry(error)) {
        this.scheduleReconnect(error)
        return
      }
      this.dispatch({ type: 'FAILED', error: error.toInfo() })
      this.targetSerial = null
      throw error
    }

    if (gen !== this.generation) return
    this.attempts = 0
    this.dispatch({ type: 'STREAM_READY', deviceName: session.deviceName })
    this.deps.log.info(`Mirroring ${serial} (${session.deviceName})`)
    if (this.deps.getSettings().control.turnScreenOffOnStart) this.control({ type: 'displayPower', on: false })
  }

  private onVideo(session: SessionLike, ev: VideoStreamEvent): void {
    if (session !== this.session) return
    switch (ev.type) {
      case 'session': {
        const size = { width: ev.width, height: ev.height }
        this.lastSize = size
        this.recorder?.onSession(size)
        this.dispatch({ type: 'VIDEO_SIZE', size })
        this.emit('video', { kind: 'session', width: ev.width, height: ev.height })
        break
      }
      case 'packet':
        if (ev.config) this.lastConfig = ev.data
        this.recorder?.onPacket(ev)
        this.emit('video', { kind: 'packet', config: ev.config, key: ev.key, pts: ev.pts, data: ev.data })
        break
      default:
        break
    }
  }

  private shouldRetry(error: AppError): boolean {
    const settings = this.deps.getSettings().connection
    if (!settings.autoReconnect || !this.targetSerial) return false
    // Configuration problems will not fix themselves by retrying.
    if (['ENCODER_FAILED', 'SERVER_MISSING', 'DEVICE_UNSUPPORTED', 'ADB_NOT_FOUND', 'DEVICE_UNAUTHORIZED'].includes(error.code))
      return false
    return this.attempts < settings.maxReconnectAttempts
  }

  private onSessionClosed(session: SessionLike, err: AppError | null): void {
    if (session !== this.session) return
    session.removeAllListeners()
    this.session = null
    this.emit('video', { kind: 'end' })
    const error = err ?? new AppError('DEVICE_DISCONNECTED')
    this.deps.log.warn(`Session closed: ${error.code} ${error.detail ?? ''}`)
    this.stopRecordingInternal('Recording stopped because mirroring ended.')

    if (this.shouldRetry(error)) {
      this.scheduleReconnect(error)
    } else {
      this.dispatch({ type: 'FAILED', error: error.toInfo() })
      this.targetSerial = null
    }
  }

  private scheduleReconnect(error: AppError): void {
    const serial = this.targetSerial
    if (!serial) return
    // error → reconnecting keeps the last error visible while waiting.
    this.dispatch({ type: 'FAILED', error: error.toInfo() })
    this.dispatch({ type: 'RECONNECTING', attempt: this.attempts + 1 })
    this.clearReconnectTimer()
    const device = this.deps.findDevice(serial)
    // If the device is gone, wait for `onDeviceReady` instead of burning attempts.
    if (!device || device.state !== 'device') return
    this.attempts++
    const delay = this.deps.backoffMs?.(this.attempts) ?? Math.min(1000 * this.attempts, 5000)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.targetSerial === serial && this._state.phase === 'reconnecting') {
        this.launch(serial).catch(() => undefined)
      }
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  /** Called by the device monitor when a device enters the `device` state. */
  onDeviceReady(serial: string): void {
    if (this._state.phase === 'reconnecting' && this.targetSerial === serial && !this.reconnectTimer && !this.session) {
      this.deps.log.info(`Device ${serial} is back; reconnecting`)
      this.attempts++
      this.launch(serial).catch(() => undefined)
    }
  }

  /** Called by the device monitor when a device disappears. */
  onDeviceLost(serial: string): void {
    if (this.session?.serial === serial) {
      // The sockets will close on their own; make sure we do not hang if they don't.
      const session = this.session
      setTimeout(() => {
        if (this.session === session) this.onSessionClosed(session, new AppError('DEVICE_DISCONNECTED'))
      }, 3000).unref?.()
    }
  }

  async stop(): Promise<void> {
    this.generation++
    this.targetSerial = null
    this.clearReconnectTimer()
    const session = this.session
    this.session = null
    if (!session) {
      if (this._state.phase !== 'idle') this.dispatch({ type: 'STOPPED' })
      return
    }
    this.dispatch({ type: 'STOP' })
    this.stopRecordingInternal()
    session.removeAllListeners()
    try {
      await session.stop()
    } finally {
      this.emit('video', { kind: 'end' })
      this.dispatch({ type: 'STOPPED' })
    }
  }

  control(cmd: ControlCommand): void {
    const session = this.session
    if (!session || this._state.phase !== 'streaming') return
    for (const msg of commandToMessages(cmd, () => this.clipboardSeq++)) session.sendControl(serializeControlMessage(msg))
  }

  // --- Recording ---------------------------------------------------------

  get recordingStatus(): RecordingStatus {
    return {
      active: this.recorder !== null,
      filePath: this.recorder?.files.at(-1),
      startedAt: this.recorder ? this.recordingStartedAt : undefined,
      parts: this.recorder?.files ?? [],
      bytesWritten: this.recorder?.bytesWritten ?? 0
    }
  }

  startRecording(recorder: Mp4Recorder): RecordingStatus {
    if (this._state.phase !== 'streaming') throw new AppError('RECORDING_FAILED', { detail: 'Start mirroring before recording.' })
    if (this.recorder) return this.recordingStatus
    recorder.prime(this.lastConfig, this.lastSize)
    this.recorder = recorder
    this.recordingStartedAt = Date.now()
    // Ask the device for a fresh key frame so the file starts immediately.
    this.control({ type: 'resetVideo' })
    this.emit('recording', this.recordingStatus)
    return this.recordingStatus
  }

  stopRecording(): RecordingStatus {
    const recorder = this.recorder
    if (!recorder) return this.recordingStatus
    this.recorder = null
    let status: RecordingStatus
    try {
      const files = recorder.stop()
      status = { active: false, parts: files, filePath: files.at(-1), bytesWritten: recorder.bytesWritten }
    } catch (err) {
      this.deps.log.error(`Finalizing recording failed: ${(err as Error).message}`)
      this.emit('recording', { active: false, parts: recorder.files, bytesWritten: recorder.bytesWritten })
      throw new AppError('RECORDING_FAILED', { detail: (err as Error).message, cause: err })
    }
    this.emit('recording', status)
    return status
  }

  private stopRecordingInternal(reason?: string): void {
    if (!this.recorder) return
    try {
      this.stopRecording()
      if (reason) this.deps.log.info(reason)
    } catch {
      // already logged
    }
  }

  /** Current error info for an inactive controller, used by IPC callers needing a reason. */
  notStreamingError() {
    return errorInfo(this.targetSerial ? 'DEVICE_DISCONNECTED' : 'NO_DEVICE')
  }
}
