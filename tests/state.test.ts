import { describe, expect, it } from 'vitest'
import { INITIAL_MIRROR_STATE, isMirrorActive, mirrorReducer, type MirrorEvent } from '@shared/mirror-state'
import { chooseSelectedSerial, deviceDisplayName, deviceStatus } from '@features/devices/selection'
import { AppError, classifyAdbOutput, classifyServerOutput, errorInfo, toErrorInfo } from '@shared/errors'
import type { DeviceInfo, MirrorState } from '@shared/types'

const run = (events: MirrorEvent[], from: MirrorState = INITIAL_MIRROR_STATE): MirrorState =>
  events.reduce(mirrorReducer, from)

describe('mirror state machine', () => {
  it('goes idle → starting → streaming → stopping → idle', () => {
    let s = run([{ type: 'START', serial: 'A' }])
    expect(s).toMatchObject({ phase: 'starting', serial: 'A' })
    s = run([{ type: 'STEP', step: 'Connecting' }, { type: 'VIDEO_SIZE', size: { width: 1, height: 2 } }], s)
    expect(s).toMatchObject({ phase: 'starting', step: 'Connecting', videoSize: { width: 1, height: 2 } })
    s = run([{ type: 'STREAM_READY', deviceName: 'Pixel' }], s)
    expect(s).toMatchObject({ phase: 'streaming', deviceName: 'Pixel', videoSize: { width: 1, height: 2 } })
    expect(isMirrorActive(s)).toBe(true)
    s = run([{ type: 'STOP' }], s)
    expect(s.phase).toBe('stopping')
    s = run([{ type: 'STOPPED' }], s)
    expect(s).toEqual(INITIAL_MIRROR_STATE)
  })

  it('ignores START while already active', () => {
    const s = run([{ type: 'START', serial: 'A' }, { type: 'STREAM_READY', deviceName: 'x' }])
    expect(mirrorReducer(s, { type: 'START', serial: 'B' })).toBe(s)
  })

  it('records failures with the error', () => {
    const error = errorInfo('SERVER_START_FAILED')
    const s = run([{ type: 'START', serial: 'A' }, { type: 'FAILED', error }])
    expect(s).toEqual({ phase: 'error', serial: 'A', error })
    expect(isMirrorActive(s)).toBe(false)
  })

  it('a failure during a user stop does not surface as an error', () => {
    const s = run([
      { type: 'START', serial: 'A' },
      { type: 'STREAM_READY', deviceName: 'x' },
      { type: 'STOP' },
      { type: 'FAILED', error: errorInfo('DEVICE_DISCONNECTED') }
    ])
    expect(s.phase).toBe('idle')
  })

  it('reconnecting keeps the serial and the last error, then can restart', () => {
    const error = errorInfo('DEVICE_DISCONNECTED')
    let s = run([
      { type: 'START', serial: 'A' },
      { type: 'STREAM_READY', deviceName: 'x' },
      { type: 'FAILED', error },
      { type: 'RECONNECTING', attempt: 2 }
    ])
    expect(s).toMatchObject({ phase: 'reconnecting', serial: 'A', reconnectAttempt: 2, error })
    s = run([{ type: 'START', serial: 'A' }], s)
    expect(s).toMatchObject({ phase: 'starting', reconnectAttempt: 2 })
    s = run([{ type: 'STREAM_READY', deviceName: 'x' }], s)
    expect(s.reconnectAttempt).toBeUndefined()
  })

  it('STEP is ignored outside of starting', () => {
    expect(mirrorReducer(INITIAL_MIRROR_STATE, { type: 'STEP', step: 'x' })).toBe(INITIAL_MIRROR_STATE)
  })
})

const dev = (serial: string, state: DeviceInfo['state'], extra: Partial<DeviceInfo> = {}): DeviceInfo => ({
  serial,
  state,
  kind: 'usb',
  ...extra
})

describe('device selection', () => {
  it('keeps the current selection when still present', () => {
    expect(chooseSelectedSerial([dev('A', 'device'), dev('B', 'device')], 'B', 'A')).toBe('B')
  })
  it('falls back to the last used device, then the first ready one', () => {
    expect(chooseSelectedSerial([dev('A', 'device'), dev('B', 'device')], 'Z', 'B')).toBe('B')
    expect(chooseSelectedSerial([dev('A', 'unauthorized'), dev('B', 'device')], null, null)).toBe('B')
    expect(chooseSelectedSerial([dev('A', 'unauthorized')], null, null)).toBe('A')
    expect(chooseSelectedSerial([], 'A', 'B')).toBeNull()
  })
  it('builds display names and statuses', () => {
    expect(deviceDisplayName(dev('S', 'device', { details: { manufacturer: 'samsung', model: 'SM-S918B' } }))).toBe('Samsung SM-S918B')
    expect(deviceDisplayName(dev('S', 'device', { details: { manufacturer: 'Google', model: 'Google Pixel 8' } }))).toBe('Google Pixel 8')
    expect(deviceDisplayName(dev('S', 'unauthorized'))).toBe('S')
    expect(deviceStatus(dev('S', 'unauthorized')).tone).toBe('warning')
    expect(deviceStatus(dev('1.2.3.4:5555', 'device', { kind: 'wireless' })).label).toContain('Wi-Fi')
  })
})

describe('error handling', () => {
  it('classifies adb output', () => {
    expect(classifyAdbOutput("adb: device unauthorized.\nThis adb server's $ADB_VENDOR_KEYS is not set")).toBe('DEVICE_UNAUTHORIZED')
    expect(classifyAdbOutput('error: device offline')).toBe('DEVICE_OFFLINE')
    expect(classifyAdbOutput("error: device 'XYZ' not found")).toBe('DEVICE_NOT_FOUND')
    expect(classifyAdbOutput('adb: no devices/emulators found')).toBe('NO_DEVICE')
    expect(classifyAdbOutput('all good')).toBeNull()
  })
  it('classifies server output', () => {
    expect(
      classifyServerOutput('[server] ERROR: The server version (5.0) does not match the client (5.0.1)')
    ).toBe('SERVER_START_FAILED')
    expect(classifyServerOutput('java.lang.SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.')).toBe('SERVER_START_FAILED')
    expect(classifyServerOutput('INFO: Device: [Google] Pixel 7')).toBeNull()
  })
  it('converts errors to IPC-safe info with hints', () => {
    const info = new AppError('DEVICE_UNAUTHORIZED', { detail: 'x' }).toInfo()
    expect(info).toMatchObject({ code: 'DEVICE_UNAUTHORIZED', detail: 'x' })
    expect(info.hint).toMatch(/Allow/)
    expect(toErrorInfo(new Error('boom'))).toMatchObject({ code: 'UNKNOWN', detail: 'boom' })
  })
})
