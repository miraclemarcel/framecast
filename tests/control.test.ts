import { describe, expect, it } from 'vitest'
import { commandToMessages, floatToI16fp, floatToU16fp, serializeControlMessage, utf8Truncate } from '@services/scrcpy/control'
import { POINTER_ID_GENERIC_FINGER, POINTER_ID_MOUSE } from '@services/scrcpy/protocol'

const bytes = (b: Buffer): number[] => [...b]

// Expected bytes are copied from scrcpy v5.0.1 app/tests/test_control_msg_serialize.c
describe('control message serialization (upstream vectors)', () => {
  it('inject keycode', () => {
    const buf = serializeControlMessage({ type: 'injectKeycode', action: 1, keycode: 66, repeat: 5, metaState: 0x41 })
    expect(bytes(buf)).toEqual([0x00, 0x01, 0, 0, 0, 0x42, 0, 0, 0, 0x05, 0, 0, 0, 0x41])
  })

  it('inject text', () => {
    const buf = serializeControlMessage({ type: 'injectText', text: 'hello, world!' })
    expect(buf.length).toBe(18)
    expect(bytes(buf.subarray(0, 5))).toEqual([0x01, 0, 0, 0, 0x0d])
    expect(buf.subarray(5).toString()).toBe('hello, world!')
  })

  it('inject text is truncated to 300 bytes', () => {
    const buf = serializeControlMessage({ type: 'injectText', text: 'a'.repeat(400) })
    expect(buf.length).toBe(5 + 300)
    expect(bytes(buf.subarray(1, 5))).toEqual([0, 0, 0x01, 0x2c])
  })

  it('inject touch event', () => {
    const buf = serializeControlMessage({
      type: 'injectTouch',
      action: 0,
      pointerId: 0x1234567887654321n,
      position: { x: 100, y: 200, width: 1080, height: 1920 },
      pressure: 1,
      actionButton: 1,
      buttons: 1
    })
    expect(bytes(buf)).toEqual([
      0x02, 0x00, 0x12, 0x34, 0x56, 0x78, 0x87, 0x65, 0x43, 0x21, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0xc8, 0x04,
      0x38, 0x07, 0x80, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
    ])
  })

  it('inject scroll event', () => {
    const buf = serializeControlMessage({
      type: 'injectScroll',
      position: { x: 260, y: 1026, width: 1080, height: 1920 },
      hScroll: 16,
      vScroll: -16,
      buttons: 1
    })
    expect(bytes(buf)).toEqual([
      0x03, 0x00, 0x00, 0x01, 0x04, 0x00, 0x00, 0x04, 0x02, 0x04, 0x38, 0x07, 0x80, 0x7f, 0xff, 0x80, 0x00, 0x00, 0x00, 0x00,
      0x01
    ])
  })

  it('set clipboard', () => {
    const buf = serializeControlMessage({ type: 'setClipboard', sequence: 0x0102030405060708n, paste: true, text: 'hello, world!' })
    expect(buf.length).toBe(27)
    expect(bytes(buf.subarray(0, 14))).toEqual([0x09, 1, 2, 3, 4, 5, 6, 7, 8, 1, 0, 0, 0, 0x0d])
  })

  it('single-byte and two-byte messages', () => {
    expect(bytes(serializeControlMessage({ type: 'backOrScreenOn', action: 1 }))).toEqual([0x04, 0x01])
    expect(bytes(serializeControlMessage({ type: 'expandNotificationPanel' }))).toEqual([0x05])
    expect(bytes(serializeControlMessage({ type: 'expandSettingsPanel' }))).toEqual([0x06])
    expect(bytes(serializeControlMessage({ type: 'collapsePanels' }))).toEqual([0x07])
    expect(bytes(serializeControlMessage({ type: 'setDisplayPower', on: true }))).toEqual([0x0a, 0x01])
    expect(bytes(serializeControlMessage({ type: 'rotateDevice' }))).toEqual([0x0b])
    expect(bytes(serializeControlMessage({ type: 'resetVideo' }))).toEqual([0x11])
  })
})

describe('fixed point helpers', () => {
  it('matches scrcpy semantics', () => {
    expect(floatToU16fp(1)).toBe(0xffff)
    expect(floatToU16fp(0)).toBe(0)
    expect(floatToU16fp(0.5)).toBe(0x8000)
    expect(floatToI16fp(1)).toBe(0x7fff)
    expect(floatToI16fp(-1)).toBe(-0x8000)
    expect(floatToI16fp(0.5)).toBe(0x4000)
  })

  it('truncates UTF-8 without splitting characters', () => {
    expect(utf8Truncate('héllo', 2).toString()).toBe('h') // é is 2 bytes
    expect(utf8Truncate('\u{1F600}\u{1F600}', 5).toString()).toBe('\u{1F600}')
  })
})

describe('commandToMessages', () => {
  const seq = (): bigint => 7n
  it('maps navigation keys to down+up key events', () => {
    const msgs = commandToMessages({ type: 'nav', key: 'recents' }, seq)
    expect(msgs).toEqual([
      { type: 'injectKeycode', action: 0, keycode: 187, repeat: 0, metaState: 0 },
      { type: 'injectKeycode', action: 1, keycode: 187, repeat: 0, metaState: 0 }
    ])
  })

  it('maps special pointer ids', () => {
    const base = { type: 'touch', action: 'down', x: 1, y: 2, width: 10, height: 20, pressure: 1, actionButton: 1, buttons: 1 } as const
    expect(commandToMessages({ ...base, pointerId: -1 }, seq)[0]).toMatchObject({ pointerId: POINTER_ID_MOUSE, action: 0 })
    expect(commandToMessages({ ...base, pointerId: -2 }, seq)[0]).toMatchObject({ pointerId: POINTER_ID_GENERIC_FINGER })
    expect(commandToMessages({ ...base, pointerId: 3, action: 'move' }, seq)[0]).toMatchObject({ pointerId: 3n, action: 2 })
  })

  it('paste requires text and uses the sequence', () => {
    expect(commandToMessages({ type: 'paste' }, seq)).toEqual([])
    expect(commandToMessages({ type: 'paste', text: 'x' }, seq)).toEqual([{ type: 'setClipboard', sequence: 7n, paste: true, text: 'x' }])
  })
})
