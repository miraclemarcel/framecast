import type { ControlCommand } from '@shared/ipc'
import {
  CLIPBOARD_TEXT_MAX_BYTES,
  ControlType,
  INJECT_TEXT_MAX_BYTES,
  KeyAction,
  MotionAction,
  NavKeycode,
  POINTER_ID_GENERIC_FINGER,
  POINTER_ID_MOUSE
} from './protocol'

export interface Position {
  x: number
  y: number
  width: number
  height: number
}

/** Low-level control messages, mirroring the scrcpy ControlMessage union. */
export type ControlMessage =
  | { type: 'injectKeycode'; action: number; keycode: number; repeat: number; metaState: number }
  | { type: 'injectText'; text: string }
  | {
      type: 'injectTouch'
      action: number
      pointerId: bigint
      position: Position
      pressure: number
      actionButton: number
      buttons: number
    }
  | { type: 'injectScroll'; position: Position; hScroll: number; vScroll: number; buttons: number }
  | { type: 'backOrScreenOn'; action: number }
  | { type: 'expandNotificationPanel' }
  | { type: 'expandSettingsPanel' }
  | { type: 'collapsePanels' }
  | { type: 'setClipboard'; sequence: bigint; paste: boolean; text: string }
  | { type: 'setDisplayPower'; on: boolean }
  | { type: 'rotateDevice' }
  | { type: 'resetVideo' }

/** Same as scrcpy's sc_float_to_u16fp: [0, 1] → u16 fixed point. */
export function floatToU16fp(f: number): number {
  const clamped = Math.min(1, Math.max(0, f))
  const u = Math.trunc(clamped * 0x10000)
  return u >= 0xffff ? 0xffff : u
}

/** Same as scrcpy's sc_float_to_i16fp: [-1, 1] → i16 fixed point. */
export function floatToI16fp(f: number): number {
  const clamped = Math.min(1, Math.max(-1, f))
  const i = Math.trunc(clamped * 0x8000)
  return i >= 0x7fff ? 0x7fff : i
}

/** Truncate a string so its UTF-8 encoding fits in `maxBytes`, without splitting a code point. */
export function utf8Truncate(text: string, maxBytes: number): Buffer {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return buf
  let end = maxBytes
  // Step back over UTF-8 continuation bytes (10xxxxxx).
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  return buf.subarray(0, end)
}

function writePosition(buf: Buffer, offset: number, p: Position): void {
  buf.writeInt32BE(p.x, offset)
  buf.writeInt32BE(p.y, offset + 4)
  buf.writeUInt16BE(p.width, offset + 8)
  buf.writeUInt16BE(p.height, offset + 10)
}

export function serializeControlMessage(msg: ControlMessage): Buffer {
  switch (msg.type) {
    case 'injectKeycode': {
      const buf = Buffer.alloc(14)
      buf.writeUInt8(ControlType.INJECT_KEYCODE, 0)
      buf.writeUInt8(msg.action, 1)
      buf.writeInt32BE(msg.keycode, 2)
      buf.writeInt32BE(msg.repeat, 6)
      buf.writeInt32BE(msg.metaState, 10)
      return buf
    }
    case 'injectText': {
      const text = utf8Truncate(msg.text, INJECT_TEXT_MAX_BYTES)
      const buf = Buffer.alloc(5 + text.length)
      buf.writeUInt8(ControlType.INJECT_TEXT, 0)
      buf.writeUInt32BE(text.length, 1)
      text.copy(buf, 5)
      return buf
    }
    case 'injectTouch': {
      const buf = Buffer.alloc(32)
      buf.writeUInt8(ControlType.INJECT_TOUCH_EVENT, 0)
      buf.writeUInt8(msg.action, 1)
      buf.writeBigInt64BE(msg.pointerId, 2)
      writePosition(buf, 10, msg.position)
      buf.writeUInt16BE(floatToU16fp(msg.pressure), 22)
      buf.writeUInt32BE(msg.actionButton, 24)
      buf.writeUInt32BE(msg.buttons, 28)
      return buf
    }
    case 'injectScroll': {
      const buf = Buffer.alloc(21)
      buf.writeUInt8(ControlType.INJECT_SCROLL_EVENT, 0)
      writePosition(buf, 1, msg.position)
      // Values are in [-16, 16], normalized to [-1, 1] before fixed-point encoding.
      buf.writeInt16BE(floatToI16fp(msg.hScroll / 16), 13)
      buf.writeInt16BE(floatToI16fp(msg.vScroll / 16), 15)
      buf.writeUInt32BE(msg.buttons, 17)
      return buf
    }
    case 'backOrScreenOn':
      return Buffer.from([ControlType.BACK_OR_SCREEN_ON, msg.action])
    case 'expandNotificationPanel':
      return Buffer.from([ControlType.EXPAND_NOTIFICATION_PANEL])
    case 'expandSettingsPanel':
      return Buffer.from([ControlType.EXPAND_SETTINGS_PANEL])
    case 'collapsePanels':
      return Buffer.from([ControlType.COLLAPSE_PANELS])
    case 'setClipboard': {
      const text = utf8Truncate(msg.text, CLIPBOARD_TEXT_MAX_BYTES)
      const buf = Buffer.alloc(14 + text.length)
      buf.writeUInt8(ControlType.SET_CLIPBOARD, 0)
      buf.writeBigUInt64BE(msg.sequence, 1)
      buf.writeUInt8(msg.paste ? 1 : 0, 9)
      buf.writeUInt32BE(text.length, 10)
      text.copy(buf, 14)
      return buf
    }
    case 'setDisplayPower':
      return Buffer.from([ControlType.SET_DISPLAY_POWER, msg.on ? 1 : 0])
    case 'rotateDevice':
      return Buffer.from([ControlType.ROTATE_DEVICE])
    case 'resetVideo':
      return Buffer.from([ControlType.RESET_VIDEO])
  }
}

const TOUCH_ACTIONS = {
  down: MotionAction.DOWN,
  up: MotionAction.UP,
  move: MotionAction.MOVE,
  hover: MotionAction.HOVER_MOVE
} as const

/**
 * Translate a validated renderer command into one or more wire messages.
 * `nextSequence` supplies clipboard sequence numbers.
 */
export function commandToMessages(cmd: ControlCommand, nextSequence: () => bigint): ControlMessage[] {
  switch (cmd.type) {
    case 'touch': {
      const pointerId =
        cmd.pointerId === -1 ? POINTER_ID_MOUSE : cmd.pointerId === -2 ? POINTER_ID_GENERIC_FINGER : BigInt(cmd.pointerId)
      return [
        {
          type: 'injectTouch',
          action: TOUCH_ACTIONS[cmd.action],
          pointerId,
          position: { x: cmd.x, y: cmd.y, width: cmd.width, height: cmd.height },
          pressure: cmd.pressure,
          actionButton: cmd.actionButton,
          buttons: cmd.buttons
        }
      ]
    }
    case 'scroll':
      return [
        {
          type: 'injectScroll',
          position: { x: cmd.x, y: cmd.y, width: cmd.width, height: cmd.height },
          hScroll: cmd.hScroll,
          vScroll: cmd.vScroll,
          buttons: cmd.buttons
        }
      ]
    case 'key':
      return [
        {
          type: 'injectKeycode',
          action: cmd.action === 'down' ? KeyAction.DOWN : KeyAction.UP,
          keycode: cmd.keycode,
          repeat: cmd.repeat,
          metaState: cmd.metaState
        }
      ]
    case 'text':
      return [{ type: 'injectText', text: cmd.text }]
    case 'nav': {
      const keycode = NavKeycode[cmd.key]
      return [
        { type: 'injectKeycode', action: KeyAction.DOWN, keycode, repeat: 0, metaState: 0 },
        { type: 'injectKeycode', action: KeyAction.UP, keycode, repeat: 0, metaState: 0 }
      ]
    }
    case 'backOrScreenOn':
      return [{ type: 'backOrScreenOn', action: cmd.action === 'down' ? KeyAction.DOWN : KeyAction.UP }]
    case 'rotate':
      return [{ type: 'rotateDevice' }]
    case 'panel':
      return [
        cmd.panel === 'notifications'
          ? { type: 'expandNotificationPanel' }
          : cmd.panel === 'settings'
            ? { type: 'expandSettingsPanel' }
            : { type: 'collapsePanels' }
      ]
    case 'paste':
      return cmd.text ? [{ type: 'setClipboard', sequence: nextSequence(), paste: true, text: cmd.text }] : []
    case 'displayPower':
      return [{ type: 'setDisplayPower', on: cmd.on }]
    case 'resetVideo':
      return [{ type: 'resetVideo' }]
  }
}
