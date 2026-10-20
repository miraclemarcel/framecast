import { create } from 'zustand'
import type { AppInfo, ToastMessage } from '@shared/ipc'
import { INITIAL_MIRROR_STATE } from '@shared/mirror-state'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings'
import type { AdbStatus, AppErrorInfo, DeviceInfo, MirrorState, RecordingStatus, StreamStats } from '@shared/types'
import { chooseSelectedSerial } from '@features/devices/selection'
import { call, errorInfoOf } from './api'

export type DialogId = 'settings' | 'wireless' | 'setup' | null

export interface Toast extends ToastMessage {
  id: number
  hint?: string
  detail?: string
}

interface AppState {
  ready: boolean
  appInfo: AppInfo | null
  settings: Settings
  adb: AdbStatus
  devices: DeviceInfo[]
  selectedSerial: string | null
  mirror: MirrorState
  recording: RecordingStatus
  stats: StreamStats
  fullscreen: boolean
  /** Which window this renderer is: the full app or the compact emulator-style window. */
  windowMode: 'full' | 'compact'
  /** The phone screen has keyboard focus (typing goes to the device). */
  keyboardFocused: boolean
  dialog: DialogId
  toasts: Toast[]
}

const LAST_SERIAL_KEY = 'framecast.lastSerial'

function readLastSerial(): string | null {
  try {
    return localStorage.getItem(LAST_SERIAL_KEY)
  } catch {
    return null
  }
}

function writeLastSerial(serial: string): void {
  try {
    localStorage.setItem(LAST_SERIAL_KEY, serial)
  } catch {
    // storage unavailable; selection memory is a convenience only
  }
}

export const useApp = create<AppState>(() => ({
  ready: false,
  appInfo: null,
  settings: DEFAULT_SETTINGS,
  adb: { available: false },
  devices: [],
  selectedSerial: null,
  mirror: INITIAL_MIRROR_STATE,
  recording: { active: false, parts: [], bytesWritten: 0 },
  stats: { fps: 0, kbps: 0 },
  fullscreen: false,
  windowMode: window.location.hash === '#compact' ? 'compact' : 'full',
  keyboardFocused: false,
  dialog: null,
  toasts: []
}))

const set = useApp.setState
const get = useApp.getState
let toastSeq = 0

export const actions = {
  toast(t: ToastMessage & { hint?: string; detail?: string }): void {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    const ttl = t.level === 'error' ? 9000 : t.filePath ? 7000 : 4000
    setTimeout(() => actions.dismissToast(id), ttl)
  },

  dismissToast(id: number): void {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  errorToast(title: string, err: unknown): void {
    const info: AppErrorInfo = errorInfoOf(err)
    actions.toast({ level: 'error', title, message: info.message, hint: info.hint, detail: info.detail })
  },

  openDialog(dialog: DialogId): void {
    // The compact window has no room for dialogs: open them in the full window instead.
    if (dialog && get().windowMode === 'compact') {
      void call('window:setMode', { mode: 'full', dialog }).catch(() => undefined)
      return
    }
    set({ dialog })
  },

  async setWindowMode(mode: 'full' | 'compact'): Promise<void> {
    if (mode === 'compact' && get().fullscreen) await actions.toggleFullscreen(false)
    await call('window:setMode', { mode }).catch((err) => actions.errorToast('Could not switch window', err))
  },

  toggleCompact(): void {
    void actions.setWindowMode(get().windowMode === 'compact' ? 'full' : 'compact')
  },

  selectDevice(serial: string): void {
    set({ selectedSerial: serial })
  },

  setDevices(devices: DeviceInfo[]): void {
    const { selectedSerial, mirror } = get()
    const current = mirror.serial ?? selectedSerial
    set({ devices, selectedSerial: chooseSelectedSerial(devices, current, readLastSerial()) })
  },

  async startMirroring(serial = get().selectedSerial): Promise<void> {
    if (!serial) {
      actions.openDialog('setup')
      return
    }
    writeLastSerial(serial)
    set({ selectedSerial: serial })
    try {
      await call('mirror:start', { serial })
    } catch {
      // The failure is shown on the device screen through the mirror state.
    }
  },

  async stopMirroring(): Promise<void> {
    try {
      await call('mirror:stop')
    } catch (err) {
      actions.errorToast('Could not stop mirroring', err)
    }
  },

  async restartMirroring(): Promise<void> {
    const serial = get().mirror.serial
    if (!serial) return
    await actions.stopMirroring()
    await actions.startMirroring(serial)
  },

  async updateSettings(patch: SettingsPatch): Promise<void> {
    try {
      set({ settings: await call('settings:update', patch) })
    } catch (err) {
      actions.errorToast('Could not save settings', err)
    }
  },

  async toggleFullscreen(value = !get().fullscreen): Promise<void> {
    const result = await call('window:setFullScreen', { value }).catch(() => get().fullscreen)
    set({ fullscreen: result })
  },

  async refreshDevices(): Promise<void> {
    try {
      actions.setDevices(await call('devices:list'))
    } catch (err) {
      actions.errorToast('Could not list devices', err)
    }
  }
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

let initialized = false

/** Load initial state and subscribe to main-process events (once). */
export async function initStore(): Promise<void> {
  if (initialized) return
  initialized = true
  const api = window.framecast
  api.on('devices:changed', (devices) => actions.setDevices(devices))
  api.on('mirror:state', (mirror) => set({ mirror }))
  api.on('settings:changed', (settings) => set({ settings }))
  api.on('adb:status', (adb) => set({ adb }))
  api.on('window:fullscreen', (fullscreen) => set({ fullscreen }))
  api.on('toast', (t) => actions.toast(t))
  api.on('ui:openDialog', (dialog) => {
    if (get().windowMode === 'full') set({ dialog })
  })
  api.on('recording:status', (recording) => {
    const wasActive = get().recording.active
    set({ recording })
    if (!wasActive || recording.active) return
    // Every stop (button, shortcut, or mirroring ending) is reported here, once.
    if (recording.parts.length === 0) {
      actions.toast({ level: 'warning', title: 'Recording ended', message: 'No video was captured.' })
    } else {
      const n = recording.parts.length
      actions.toast({
        level: 'success',
        title: 'Recording saved',
        message: n > 1 ? `${n} files (a new file starts after each rotation)` : fileName(recording.filePath ?? ''),
        filePath: recording.filePath
      })
    }
  })

  const [appInfo, settings, adb, mirror, recording] = await Promise.all([
    call('app:info'),
    call('settings:get'),
    call('adb:status'),
    call('mirror:state'),
    call('capture:recordingStatus')
  ])
  set({ appInfo, settings, adb, mirror, recording, ready: true })
  await actions.refreshDevices()
}
