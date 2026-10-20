import { useEffect } from 'react'
import { Toaster } from '@components/Toaster'
import { takeScreenshot, toggleRecording } from '@features/capture/capture-actions'
import { DeviceInfoPanel } from '@features/devices/DeviceInfoPanel'
import { SetupGuide } from '@features/devices/SetupGuide'
import { WirelessDialog } from '@features/devices/WirelessDialog'
import { DeviceStage } from '@features/mirroring/DeviceStage'
import { matchShortcut } from '@features/mirroring/shortcuts'
import { SettingsDialog } from '@features/settings/SettingsDialog'
import { BottomBar } from './BottomBar'
import { TopBar } from './TopBar'
import { actions, useApp } from './store'

export function useTheme(): void {
  const theme = useApp((s) => s.settings.theme)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.classList.toggle('light', !dark)
      document.documentElement.classList.toggle('compact', useApp.getState().windowMode === 'compact')
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

/** App-level shortcuts, handled before keys reach the phone input. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const state = useApp.getState()
      if (state.dialog) return
      const action = matchShortcut(e)
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat && action.kind !== 'control') return
      const streaming = state.mirror.phase === 'streaming'
      switch (action.kind) {
        case 'fullscreen':
          if (state.windowMode === 'full') void actions.toggleFullscreen()
          break
        case 'compact':
          actions.toggleCompact()
          break
        case 'control':
          if (streaming) window.framecast.control(action.command)
          break
        case 'screenshot':
          if (streaming) void takeScreenshot(action.framed)
          break
        case 'record':
          if (streaming || state.recording.active) void toggleRecording()
          break
      }
    }
    // Capture phase: runs before the phone input's own key handler.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

export function App() {
  useTheme()
  useShortcuts()
  const fullscreen = useApp((s) => s.fullscreen)
  const showInfo = useApp((s) => s.settings.display.showInfoPanel)

  return (
    <div className="flex h-full flex-col">
      {!fullscreen && <TopBar />}
      <main className="relative flex min-h-0 flex-1">
        <div className="group relative min-w-0 flex-1">
          <DeviceStage variant={fullscreen ? 'fullscreen' : 'workspace'} />
          {fullscreen && (
            // Floating controls appear when the pointer nears the bottom edge.
            <div className="absolute inset-x-0 bottom-0 flex h-28 items-end justify-center pb-4 opacity-0 transition-opacity hover:opacity-100">
              <BottomBar floating />
            </div>
          )}
        </div>
        {!fullscreen && showInfo && <DeviceInfoPanel />}
      </main>
      {!fullscreen && <BottomBar />}
      <Toaster />
      <SettingsDialog />
      <WirelessDialog />
      <SetupGuide />
    </div>
  )
}
