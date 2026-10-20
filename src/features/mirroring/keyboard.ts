/** android.view.KeyEvent meta state flags. */
export const Meta = {
  SHIFT_ON: 0x1,
  ALT_ON: 0x2,
  ALT_LEFT_ON: 0x10,
  SHIFT_LEFT_ON: 0x40,
  CTRL_ON: 0x1000,
  CTRL_LEFT_ON: 0x2000,
  META_ON: 0x10000,
  META_LEFT_ON: 0x20000,
  CAPS_LOCK_ON: 0x100000
} as const

/** Keys that are always injected as key events (not text). Keyed by KeyboardEvent.code. */
const SPECIAL_KEYS: Record<string, number> = {
  Enter: 66,
  NumpadEnter: 160,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
  Insert: 124,
  F1: 131,
  F2: 132,
  F3: 133,
  F4: 134,
  F5: 135,
  F6: 136,
  F7: 137,
  F8: 138,
  F9: 139,
  F10: 140,
  F12: 142
}

/** Physical keys used for shortcuts with Ctrl (e.g. Ctrl+A, Ctrl+C on the device). */
function letterOrDigitKeycode(code: string): number | undefined {
  if (/^Key[A-Z]$/.test(code)) return 29 + (code.charCodeAt(3) - 65) // KEYCODE_A = 29
  if (/^Digit[0-9]$/.test(code)) return 7 + (code.charCodeAt(5) - 48) // KEYCODE_0 = 7
  if (code === 'Space') return 62
  return undefined
}

export interface KeyLike {
  code: string
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  getModifierState?: (key: string) => boolean
}

export function metaStateOf(e: KeyLike): number {
  let meta = 0
  if (e.shiftKey) meta |= Meta.SHIFT_ON | Meta.SHIFT_LEFT_ON
  if (e.altKey) meta |= Meta.ALT_ON | Meta.ALT_LEFT_ON
  if (e.ctrlKey) meta |= Meta.CTRL_ON | Meta.CTRL_LEFT_ON
  if (e.metaKey) meta |= Meta.META_ON | Meta.META_LEFT_ON
  if (e.getModifierState?.('CapsLock')) meta |= Meta.CAPS_LOCK_ON
  return meta
}

export type KeyAction =
  | { kind: 'keycode'; keycode: number; metaState: number }
  | { kind: 'paste' }
  /** Let the browser produce text (delivered by the input event). */
  | { kind: 'text' }
  | { kind: 'ignore' }

/**
 * Decide how a keydown should reach the device:
 *  - navigation/editing keys → Android key events,
 *  - Ctrl+V → paste the computer clipboard,
 *  - Ctrl/Meta + letter → key event with modifiers (select all, copy, …),
 *  - plain printable characters → text injection (supports any keyboard layout).
 */
export function classifyKey(e: KeyLike): KeyAction {
  const special = SPECIAL_KEYS[e.code]
  if (special !== undefined) return { kind: 'keycode', keycode: special, metaState: metaStateOf(e) }

  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (e.code === 'KeyV' && !e.shiftKey) return { kind: 'paste' }
    const keycode = letterOrDigitKeycode(e.code)
    if (keycode !== undefined) return { kind: 'keycode', keycode, metaState: metaStateOf(e) }
    return { kind: 'ignore' }
  }

  // AltGr produces ctrl+alt on Windows; treat as text.
  if (e.key.length === 1 || [...e.key].length === 1) return { kind: 'text' }
  return { kind: 'ignore' }
}
