import type { ControlCommand } from '@shared/ipc'

export type ShortcutAction =
  | { kind: 'control'; command: ControlCommand }
  | { kind: 'fullscreen' }
  | { kind: 'screenshot'; framed: boolean }
  | { kind: 'record' }
  | { kind: 'compact' }

export interface ShortcutInfo {
  keys: string
  label: string
}

/** Shortcuts use Alt (like scrcpy's MOD key), so plain typing always reaches the phone. */
export const SHORTCUTS: ShortcutInfo[] = [
  { keys: 'Alt+B', label: 'Back' },
  { keys: 'Alt+H', label: 'Home' },
  { keys: 'Alt+S', label: 'Recent apps' },
  { keys: 'Alt+R', label: 'Rotate' },
  { keys: 'Alt+N', label: 'Notifications' },
  { keys: 'Alt+P', label: 'Power' },
  { keys: 'Alt+↑ / ↓', label: 'Volume' },
  { keys: 'Alt+O', label: 'Screen off (keep mirroring)' },
  { keys: 'Alt+Shift+O', label: 'Screen on' },
  { keys: 'Alt+C', label: 'Screenshot' },
  { keys: 'Alt+Shift+C', label: 'Framed screenshot' },
  { keys: 'Alt+V', label: 'Start/stop recording' },
  { keys: 'F11 / Alt+F', label: 'Full screen' },
  { keys: 'Alt+M', label: 'Compact mode (frame only)' },
  { keys: 'Ctrl+V', label: 'Paste computer clipboard' },
  { keys: 'Right click', label: 'Back' },
  { keys: 'Middle click', label: 'Home' },
  { keys: 'Ctrl+drag', label: 'Pinch to zoom' }
]

interface KeyLike {
  code: string
  key: string
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export function matchShortcut(e: KeyLike): ShortcutAction | null {
  if (e.key === 'F11') return { kind: 'fullscreen' }
  if (!e.altKey || e.ctrlKey || e.metaKey) return null
  const nav = (key: Extract<ControlCommand, { type: 'nav' }>['key']): ShortcutAction => ({
    kind: 'control',
    command: { type: 'nav', key }
  })
  switch (e.code) {
    case 'KeyB':
      return nav('back')
    case 'KeyH':
      return nav('home')
    case 'KeyS':
      return nav('recents')
    case 'KeyP':
      return nav('power')
    case 'ArrowUp':
      return nav('volumeUp')
    case 'ArrowDown':
      return nav('volumeDown')
    case 'KeyR':
      return { kind: 'control', command: { type: 'rotate' } }
    case 'KeyN':
      return { kind: 'control', command: { type: 'panel', panel: e.shiftKey ? 'collapse' : 'notifications' } }
    case 'KeyO':
      return { kind: 'control', command: { type: 'displayPower', on: e.shiftKey } }
    case 'KeyC':
      return { kind: 'screenshot', framed: e.shiftKey }
    case 'KeyV':
      return { kind: 'record' }
    case 'KeyF':
      return { kind: 'fullscreen' }
    case 'KeyM':
      return { kind: 'compact' }
    default:
      return null
  }
}
