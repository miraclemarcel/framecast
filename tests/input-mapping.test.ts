import { describe, expect, it } from 'vitest'
import { clientToVideo, mirrorPoint, wheelToScroll } from '@features/mirroring/coordinates'
import { classifyKey, Meta, metaStateOf, type KeyLike } from '@features/mirroring/keyboard'

describe('clientToVideo', () => {
  const video = { width: 1080, height: 2400 }

  it('maps a scaled element 1:1 to video pixels', () => {
    const rect = { left: 100, top: 50, width: 270, height: 600 } // scale 0.25
    expect(clientToVideo(100, 50, rect, video)).toEqual({ x: 0, y: 0, clamped: false })
    expect(clientToVideo(100 + 135, 50 + 300, rect, video)).toEqual({ x: 540, y: 1200, clamped: false })
    expect(clientToVideo(100 + 269.9, 50 + 599.9, rect, video)).toEqual({ x: 1079, y: 2399, clamped: false })
  })

  it('accounts for letterboxing', () => {
    // Element is wider than the video aspect: 20px bars on each side.
    const rect = { left: 0, top: 0, width: 310, height: 600 }
    expect(clientToVideo(20, 0, rect, video)).toEqual({ x: 0, y: 0, clamped: false })
    expect(clientToVideo(10, 0, rect, video)?.clamped).toBe(true)
  })

  it('clamps points outside the screen (drag past the edge)', () => {
    const rect = { left: 0, top: 0, width: 540, height: 1200 }
    expect(clientToVideo(-50, 2000, rect, video)).toEqual({ x: 0, y: 2399, clamped: true })
  })

  it('handles landscape video after rotation', () => {
    const rect = { left: 0, top: 0, width: 1200, height: 540 }
    expect(clientToVideo(600, 270, rect, { width: 2400, height: 1080 })).toEqual({ x: 1200, y: 540, clamped: false })
  })

  it('returns null for degenerate sizes', () => {
    expect(clientToVideo(0, 0, { left: 0, top: 0, width: 0, height: 10 }, video)).toBeNull()
    expect(clientToVideo(0, 0, { left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toBeNull()
  })

  it('mirrors points through the center for pinch gestures', () => {
    expect(mirrorPoint({ x: 0, y: 0 }, video)).toEqual({ x: 1079, y: 2399 })
    expect(mirrorPoint({ x: 540, y: 1200 }, video)).toEqual({ x: 539, y: 1199 })
  })
})

describe('wheelToScroll', () => {
  it('converts pixel and line deltas and inverts direction', () => {
    expect(wheelToScroll(0, 100, 0)).toEqual({ h: -0, v: -1 })
    expect(wheelToScroll(0, -3, 1)).toEqual({ h: -0, v: 1 })
    expect(wheelToScroll(5000, 0, 0).h).toBe(-16)
  })
})

describe('keyboard mapping', () => {
  const key = (over: Partial<KeyLike>): KeyLike => ({
    code: '',
    key: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...over
  })

  it('maps editing and navigation keys to Android keycodes', () => {
    expect(classifyKey(key({ code: 'Enter', key: 'Enter' }))).toEqual({ kind: 'keycode', keycode: 66, metaState: 0 })
    expect(classifyKey(key({ code: 'Backspace', key: 'Backspace' }))).toMatchObject({ keycode: 67 })
    expect(classifyKey(key({ code: 'ArrowLeft', key: 'ArrowLeft', shiftKey: true }))).toEqual({
      kind: 'keycode',
      keycode: 21,
      metaState: Meta.SHIFT_ON | Meta.SHIFT_LEFT_ON
    })
  })

  it('sends printable characters as text, including non-Latin layouts', () => {
    expect(classifyKey(key({ code: 'KeyA', key: 'a' }))).toEqual({ kind: 'text' })
    expect(classifyKey(key({ code: 'KeyQ', key: 'й' }))).toEqual({ kind: 'text' })
    expect(classifyKey(key({ code: 'Digit2', key: '@', shiftKey: true }))).toEqual({ kind: 'text' })
  })

  it('handles Ctrl shortcuts and paste', () => {
    expect(classifyKey(key({ code: 'KeyV', key: 'v', ctrlKey: true }))).toEqual({ kind: 'paste' })
    expect(classifyKey(key({ code: 'KeyA', key: 'a', ctrlKey: true }))).toEqual({
      kind: 'keycode',
      keycode: 29,
      metaState: Meta.CTRL_ON | Meta.CTRL_LEFT_ON
    })
    expect(classifyKey(key({ code: 'Digit0', key: '0', ctrlKey: true }))).toMatchObject({ keycode: 7 })
  })

  it('ignores bare modifier keys and F11 (app full screen)', () => {
    expect(classifyKey(key({ code: 'ShiftLeft', key: 'Shift', shiftKey: true }))).toEqual({ kind: 'ignore' })
    expect(classifyKey(key({ code: 'F11', key: 'F11' }))).toEqual({ kind: 'ignore' })
  })

  it('includes caps lock in the meta state', () => {
    expect(metaStateOf(key({ getModifierState: (k) => k === 'CapsLock' }))).toBe(Meta.CAPS_LOCK_ON)
  })
})
