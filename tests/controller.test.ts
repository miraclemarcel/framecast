import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MirrorController, type SessionLike } from '../src/main/mirror-controller'
import { DeviceMonitor, type DeviceSource } from '@services/adb/device-monitor'
import { Mp4Recorder } from '@services/capture/mp4-recorder'
import { AppError } from '@shared/errors'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { AdbDeviceEntry, DeviceInfo, MirrorState } from '@shared/types'

class FakeSession extends EventEmitter implements SessionLike {
  deviceName = 'Fake'
  sent: Buffer[] = []
  stopped = false
  constructor(
    readonly serial: string,
    private readonly startImpl: () => Promise<void> = async () => undefined
  ) {
    super()
  }
  async start(onStep: (s: string) => void): Promise<void> {
    onStep('Connecting')
    await this.startImpl()
  }
  async stop(): Promise<void> {
    this.stopped = true
  }
  sendControl(data: Buffer): boolean {
    this.sent.push(data)
    return true
  }
}

const silent = { debug() {}, info() {}, warn() {}, error() {} }

function setup(opts: { devices?: DeviceInfo[]; settings?: Partial<Settings['connection']>; startImpl?: () => Promise<void> } = {}) {
  let devices: DeviceInfo[] = opts.devices ?? [{ serial: 'A', state: 'device', kind: 'usb', details: { sdkInt: 34 } }]
  const sessions: FakeSession[] = []
  const settings: Settings = { ...DEFAULT_SETTINGS, connection: { ...DEFAULT_SETTINGS.connection, ...opts.settings } }
  const clipboard: string[] = []
  const controller = new MirrorController({
    createSession: (serial) => {
      const s = new FakeSession(serial, opts.startImpl)
      sessions.push(s)
      return s
    },
    getSettings: () => settings,
    findDevice: (serial) => devices.find((d) => d.serial === serial),
    onClipboard: (t) => clipboard.push(t),
    log: silent,
    backoffMs: () => 10
  })
  const states: MirrorState[] = []
  controller.on('state', (s) => states.push(s))
  return {
    controller,
    sessions,
    states,
    clipboard,
    setDevices: (d: DeviceInfo[]) => (devices = d)
  }
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('MirrorController', () => {
  it('starts, streams, forwards control and stops', async () => {
    const { controller, sessions, states } = setup()
    await controller.start('A')
    expect(controller.state).toMatchObject({ phase: 'streaming', serial: 'A', deviceName: 'Fake' })
    expect(states.map((s) => s.phase)).toEqual(['starting', 'starting', 'streaming'])

    controller.control({ type: 'nav', key: 'home' })
    expect(sessions[0].sent).toHaveLength(2)

    await controller.stop()
    expect(sessions[0].stopped).toBe(true)
    expect(controller.state.phase).toBe('idle')
    controller.control({ type: 'nav', key: 'home' })
    expect(sessions[0].sent).toHaveLength(2) // ignored when not streaming
  })

  it('refuses unauthorized, missing and too-old devices with specific errors', async () => {
    const unauthorized = setup({ devices: [{ serial: 'A', state: 'unauthorized', kind: 'usb' }] })
    await expect(unauthorized.controller.start('A')).rejects.toMatchObject({ code: 'DEVICE_UNAUTHORIZED' })
    expect(unauthorized.controller.state).toMatchObject({ phase: 'error', error: { code: 'DEVICE_UNAUTHORIZED' } })

    const missing = setup({ devices: [] })
    await expect(missing.controller.start('A')).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' })

    const old = setup({ devices: [{ serial: 'A', state: 'device', kind: 'usb', details: { sdkInt: 19 } }] })
    await expect(old.controller.start('A')).rejects.toMatchObject({ code: 'DEVICE_UNSUPPORTED' })
    expect(old.sessions).toHaveLength(0)
  })

  it('surfaces start failures without retrying', async () => {
    const { controller } = setup({ startImpl: async () => Promise.reject(new AppError('SERVER_START_FAILED')) })
    await expect(controller.start('A')).rejects.toMatchObject({ code: 'SERVER_START_FAILED' })
    expect(controller.state.phase).toBe('error')
  })

  it('auto-reconnects after an unexpected session end', async () => {
    const { controller, sessions, states } = setup()
    await controller.start('A')
    sessions[0].emit('closed', new AppError('DEVICE_DISCONNECTED'))
    expect(controller.state.phase).toBe('reconnecting')
    await tick()
    expect(sessions).toHaveLength(2)
    expect(controller.state.phase).toBe('streaming')
    expect(states.map((s) => s.phase)).toContain('reconnecting')
  })

  it('waits for the device to come back instead of burning attempts', async () => {
    const h = setup()
    await h.controller.start('A')
    h.setDevices([])
    h.sessions[0].emit('closed', new AppError('DEVICE_DISCONNECTED'))
    await tick()
    expect(h.controller.state).toMatchObject({ phase: 'reconnecting', step: 'Waiting for device' })
    expect(h.sessions).toHaveLength(1)
    h.setDevices([{ serial: 'A', state: 'device', kind: 'usb' }])
    h.controller.onDeviceReady('A')
    await tick()
    expect(h.sessions).toHaveLength(2)
    expect(h.controller.state.phase).toBe('streaming')
  })

  it('does not reconnect when disabled, and stops retrying after the limit', async () => {
    const off = setup({ settings: { autoReconnect: false } })
    await off.controller.start('A')
    off.sessions[0].emit('closed', new AppError('DEVICE_DISCONNECTED'))
    expect(off.controller.state).toMatchObject({ phase: 'error', error: { code: 'DEVICE_DISCONNECTED' } })

    let fail = false
    const limited = setup({
      settings: { maxReconnectAttempts: 2 },
      startImpl: async () => {
        if (fail) throw new AppError('SERVER_CONNECT_FAILED')
      }
    })
    await limited.controller.start('A')
    fail = true
    limited.sessions[0].emit('closed', new AppError('DEVICE_DISCONNECTED'))
    await tick(150)
    expect(limited.sessions.length).toBe(3) // initial + 2 retries
    expect(limited.controller.state).toMatchObject({ phase: 'error', error: { code: 'SERVER_CONNECT_FAILED' } })
  })

  it('a user stop cancels a pending reconnect', async () => {
    const { controller, sessions } = setup()
    await controller.start('A')
    sessions[0].emit('closed', new AppError('DEVICE_DISCONNECTED'))
    await controller.stop()
    await tick()
    expect(sessions).toHaveLength(1)
    expect(controller.state.phase).toBe('idle')
  })

  it('forwards device clipboard when sync is enabled', async () => {
    const { controller, sessions, clipboard } = setup()
    await controller.start('A')
    sessions[0].emit('deviceMessage', { type: 'clipboard', text: 'hi' })
    expect(clipboard).toEqual(['hi'])
  })
})

describe('recording through the controller', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  const SPS = [0x67, 0x42, 0xc0, 0x1f, 0xda, 0x01]
  const PPS = [0x68, 0xce, 0x3c, 0x80]
  const config = Buffer.from([0, 0, 0, 1, ...SPS, 0, 0, 0, 1, ...PPS])
  const frame = (key: boolean) => Buffer.from([0, 0, 0, 1, key ? 0x65 : 0x41, 0x88, 0x84, 0x00, 0x33])

  it('writes valid MP4 files and splits on rotation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'framecast-rec-'))
    dirs.push(dir)
    const { controller, sessions } = setup()
    await controller.start('A')
    const s = sessions[0]
    s.emit('video', { type: 'session', width: 1080, height: 2400, clientResize: false })
    s.emit('video', { type: 'packet', config: true, key: false, pts: 0, data: config })

    const recorder = new Mp4Recorder((part) => join(dir, `rec_${part}.mp4`))
    controller.startRecording(recorder)
    // RESET_VIDEO (0x11) was sent to request a key frame.
    expect(s.sent.at(-1)).toEqual(Buffer.from([0x11]))

    s.emit('video', { type: 'packet', config: false, key: false, pts: 500, data: frame(false) }) // dropped: no key yet
    s.emit('video', { type: 'packet', config: false, key: true, pts: 1000, data: frame(true) })
    s.emit('video', { type: 'packet', config: false, key: false, pts: 17_000, data: frame(false) })
    s.emit('video', { type: 'packet', config: false, key: false, pts: 34_000, data: frame(false) })
    expect(controller.recordingStatus.active).toBe(true)

    // Rotation: new session size + new config → second file.
    s.emit('video', { type: 'session', width: 2400, height: 1080, clientResize: false })
    s.emit('video', { type: 'packet', config: true, key: false, pts: 0, data: config })
    s.emit('video', { type: 'packet', config: false, key: true, pts: 60_000, data: frame(true) })

    const status = controller.stopRecording()
    expect(status.active).toBe(false)
    expect(status.parts).toEqual([join(dir, 'rec_1.mp4'), join(dir, 'rec_2.mp4')])
    for (const file of status.parts) {
      const data = readFileSync(file)
      expect(data.subarray(4, 8).toString()).toBe('ftyp')
      expect(data.includes(Buffer.from('moov'))).toBe(true)
      expect(data.includes(Buffer.from('avcC'))).toBe(true)
    }
    // The first file holds 3 samples (the pre-key-frame packet was dropped).
    const first = readFileSync(status.parts[0])
    const stsz = first.indexOf(Buffer.from('stsz'))
    expect(first.readUInt32BE(stsz + 12)).toBe(3)
    // Its track is portrait 1080x2400 (tkhd width/height are 16.16 fixed point at the end of the box).
    const tkhd = first.indexOf(Buffer.from('tkhd'))
    const tkhdSize = first.readUInt32BE(tkhd - 4)
    expect(first.readUInt32BE(tkhd - 4 + tkhdSize - 8) >>> 16).toBe(1080)
    expect(first.readUInt32BE(tkhd - 4 + tkhdSize - 4) >>> 16).toBe(2400)
  })

  it('recording stops (and is saved) when the session ends', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'framecast-rec-'))
    dirs.push(dir)
    const { controller, sessions } = setup({ settings: { autoReconnect: false } })
    await controller.start('A')
    const s = sessions[0]
    s.emit('video', { type: 'session', width: 720, height: 1600, clientResize: false })
    s.emit('video', { type: 'packet', config: true, key: false, pts: 0, data: config })
    const statuses: boolean[] = []
    controller.on('recording', (r) => statuses.push(r.active))
    controller.startRecording(new Mp4Recorder((p) => join(dir, `r${p}.mp4`)))
    s.emit('video', { type: 'packet', config: false, key: true, pts: 1, data: frame(true) })
    s.emit('closed', new AppError('DEVICE_DISCONNECTED'))
    expect(statuses).toEqual([true, false])
    expect(readFileSync(join(dir, 'r1.mp4')).includes(Buffer.from('moov'))).toBe(true)
  })

  it('refuses to record when not streaming', () => {
    const { controller } = setup()
    expect(() => controller.startRecording(new Mp4Recorder(() => 'x'))).toThrow(AppError)
  })
})

describe('DeviceMonitor', () => {
  function fakeSource(list: AdbDeviceEntry[]) {
    const source: DeviceSource & { list: AdbDeviceEntry[]; detailCalls: number } = {
      list,
      detailCalls: 0,
      devices: async () => source.list,
      details: async () => {
        source.detailCalls++
        return { model: 'Pixel 9', sdkInt: 35 }
      }
    }
    return source
  }

  it('emits ready/lost and enriches authorized devices once', async () => {
    const source = fakeSource([{ serial: 'A', state: 'unauthorized', kind: 'usb' }])
    const monitor = new DeviceMonitor(() => source)
    const ready = vi.fn()
    const lost = vi.fn()
    monitor.on('ready', ready)
    monitor.on('lost', lost)

    await monitor.refresh()
    expect(ready).not.toHaveBeenCalled()

    source.list = [{ serial: 'A', state: 'device', kind: 'usb', transportId: '1' }]
    await monitor.refresh()
    expect(ready).toHaveBeenCalledTimes(1)
    await tick()
    expect(monitor.find('A')?.details).toEqual({ model: 'Pixel 9', sdkInt: 35 })
    await monitor.refresh()
    expect(source.detailCalls).toBe(1)

    source.list = []
    await monitor.refresh()
    expect(lost).toHaveBeenCalledWith('A')
    expect(monitor.devices).toEqual([])
  })

  it('reports adb failures once and returns an empty list', async () => {
    const monitor = new DeviceMonitor(() => ({
      devices: async () => {
        throw new AppError('ADB_FAILED')
      },
      details: async () => ({})
    }))
    const errors = vi.fn()
    monitor.on('error', errors)
    expect(await monitor.refresh()).toEqual([])
    await monitor.refresh()
    expect(errors).toHaveBeenCalledTimes(1)
  })

  it('shares concurrent refreshes', async () => {
    const source = fakeSource([])
    const spy = vi.spyOn(source, 'devices')
    const monitor = new DeviceMonitor(() => source)
    await Promise.all([monitor.refresh(), monitor.refresh(), monitor.refresh()])
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
