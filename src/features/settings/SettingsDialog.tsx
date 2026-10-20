import { useMemo, useState, type ReactNode } from 'react'
import { FolderOpen, RotateCcw } from 'lucide-react'
import { FRAME_FINISH_IDS, FRAME_PROFILE_IDS, type FrameProfileId, type Settings } from '@shared/settings'
import { Button, cx, Dialog, Select, Switch, TextInput } from '@components/ui'
import { call } from '../../renderer/api'
import { actions, useApp } from '../../renderer/store'
import { computeFrameGeometry } from '../device-frame/geometry'
import { renderFrameSvg, svgDataUrl } from '../device-frame/frame-svg'
import { FRAME_FINISHES, FRAME_PROFILES, getFinish } from '../device-frame/profiles'

type SectionId = 'frame' | 'video' | 'capture' | 'connection' | 'control' | 'about'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'frame', label: 'Device frame' },
  { id: 'video', label: 'Video & display' },
  { id: 'control', label: 'Control' },
  { id: 'capture', label: 'Capture' },
  { id: 'connection', label: 'Connection' },
  { id: 'about', label: 'About' }
]

function Row({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px]">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 mb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase first:mt-0">{children}</h3>
}

function FramePreview({ id, finish, selected, onSelect }: { id: FrameProfileId; finish: Settings['frame']['finish']; selected: boolean; onSelect: () => void }) {
  const profile = FRAME_PROFILES[id]
  const url = useMemo(() => {
    const geom = computeFrameGeometry(profile, { width: 90, height: 195 })
    return svgDataUrl(renderFrameSvg(geom, profile, getFinish(finish), { showButtons: true, screenFill: '#2a3342' }).base)
  }, [profile, finish])
  return (
    <button
      onClick={onSelect}
      title={profile.description}
      className={cx(
        'flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors',
        selected ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong hover:bg-raised'
      )}
    >
      <img src={url} alt="" className="h-24" draggable={false} />
      <span className="text-xs font-medium">{profile.name}</span>
    </button>
  )
}

const RESOLUTIONS = [
  { value: 0, label: 'Native' },
  { value: 2560, label: '2560 px' },
  { value: 1920, label: '1920 px' },
  { value: 1600, label: '1600 px' },
  { value: 1280, label: '1280 px' },
  { value: 1024, label: '1024 px' },
  { value: 800, label: '800 px' }
]
const BITRATES = [2, 4, 8, 12, 16, 24, 32].map((m) => ({ value: m * 1_000_000, label: `${m} Mbit/s` }))
const FPS = [
  { value: 0, label: 'Device default' },
  { value: 30, label: '30 fps' },
  { value: 60, label: '60 fps' },
  { value: 90, label: '90 fps' },
  { value: 120, label: '120 fps' }
]
const PRESETS: { label: string; video: Partial<Settings['video']> }[] = [
  { label: 'Performance', video: { maxSize: 1024, bitRate: 4_000_000, maxFps: 30 } },
  { label: 'Balanced', video: { maxSize: 1600, bitRate: 8_000_000, maxFps: 60 } },
  { label: 'Quality', video: { maxSize: 0, bitRate: 16_000_000, maxFps: 60 } }
]

export function SettingsDialog() {
  const open = useApp((s) => s.dialog === 'settings')
  const settings = useApp((s) => s.settings)
  const appInfo = useApp((s) => s.appInfo)
  const adb = useApp((s) => s.adb)
  const streaming = useApp((s) => s.mirror.phase === 'streaming')
  const [section, setSection] = useState<SectionId>('frame')
  const [needsRestart, setNeedsRestart] = useState(false)
  const [customAdb, setCustomAdb] = useState(settings.adb.customPath)

  const update = actions.updateSettings
  /** For settings read by the server at launch. */
  const updateLive = (patch: Parameters<typeof update>[0]) => {
    void update(patch)
    if (streaming) setNeedsRestart(true)
  }
  const { frame, video, display, capture, connection, control, adb: adbPref } = settings

  return (
    <Dialog open={open} onClose={() => actions.openDialog(null)} title="Settings" width="max-w-3xl">
      <div className="flex h-[min(560px,70vh)]">
        <nav className="w-44 shrink-0 border-r border-line p-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cx(
                'block w-full rounded-md px-3 py-1.5 text-left text-[13px]',
                section === s.id ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {needsRestart && streaming && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md bg-accent-soft px-3 py-2 text-xs">
              <span>Some changes apply when mirroring restarts.</span>
              <Button size="sm" variant="primary" onClick={() => (setNeedsRestart(false), void actions.restartMirroring())}>
                <RotateCcw size={12} /> Restart now
              </Button>
            </div>
          )}

          {section === 'frame' && (
            <>
              <Heading>Frame</Heading>
              <div className="grid grid-cols-5 gap-2">
                {FRAME_PROFILE_IDS.map((id) => (
                  <FramePreview
                    key={id}
                    id={id}
                    finish={frame.finish}
                    selected={frame.profile === id}
                    onSelect={() => void update({ frame: { profile: id } })}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">{FRAME_PROFILES[frame.profile].description}</p>
              <Heading>Finish</Heading>
              <div className="flex gap-2 py-1">
                {FRAME_FINISH_IDS.map((id) => {
                  const f = FRAME_FINISHES[id]
                  return (
                    <button
                      key={id}
                      onClick={() => void update({ frame: { finish: id } })}
                      className={cx(
                        'flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-xs',
                        frame.finish === id ? 'border-accent' : 'border-line hover:border-line-strong'
                      )}
                    >
                      <span className="h-5 w-5 rounded-full border border-black/20" style={{ background: `linear-gradient(135deg, ${f.rim[0]}, ${f.rim[1]})` }} />
                      {f.name}
                    </button>
                  )
                })}
              </div>
              <Heading>Details</Heading>
              <Row label="Side buttons">
                <Switch label="Side buttons" checked={frame.showButtons} onChange={(v) => void update({ frame: { showButtons: v } })} />
              </Row>
              <Row label="Drop shadow">
                <Switch label="Drop shadow" checked={frame.showShadow} onChange={(v) => void update({ frame: { showShadow: v } })} />
              </Row>
              <Row label="Show frame in full screen" description="Otherwise full screen shows only the phone display.">
                <Switch
                  label="Show frame in full screen"
                  checked={frame.frameInFullscreen}
                  onChange={(v) => void update({ frame: { frameInFullscreen: v } })}
                />
              </Row>
              <Heading>Appearance</Heading>
              <Row label="App theme">
                <Select
                  label="App theme"
                  value={settings.theme}
                  onChange={(theme) => void update({ theme })}
                  options={[
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                    { value: 'system', label: 'System' }
                  ]}
                />
              </Row>
            </>
          )}

          {section === 'video' && (
            <>
              <Heading>Presets</Heading>
              <div className="flex gap-2 py-1">
                {PRESETS.map((p) => (
                  <Button key={p.label} size="sm" onClick={() => updateLive({ video: p.video })}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <Heading>Stream</Heading>
              <Row label="Maximum resolution" description="Longest side of the video. Lower values reduce CPU, GPU and USB/Wi-Fi load.">
                <Select label="Maximum resolution" value={video.maxSize} options={RESOLUTIONS} onChange={(maxSize) => updateLive({ video: { maxSize } })} />
              </Row>
              <Row label="Bitrate" description="Higher bitrates look sharper during motion. 4–8 Mbit/s suits Wi-Fi.">
                <Select label="Bitrate" value={video.bitRate} options={BITRATES} onChange={(bitRate) => updateLive({ video: { bitRate } })} />
              </Row>
              <Row label="Maximum frame rate" description="Supported on Android 10 and newer; older devices ignore it.">
                <Select label="Maximum frame rate" value={video.maxFps} options={FPS} onChange={(maxFps) => updateLive({ video: { maxFps } })} />
              </Row>
              <Row label="Lower resolution on encoder errors" description="Retry automatically with a smaller size if the phone cannot encode the requested one.">
                <Switch label="Downsize on error" checked={video.downsizeOnError} onChange={(v) => updateLive({ video: { downsizeOnError: v } })} />
              </Row>
              <p className="mt-1 text-xs text-subtle">The video codec is H.264, decoded by your GPU when available. Audio forwarding is not supported.</p>
              <Heading>Display</Heading>
              <Row label="Scaling" description="Fit keeps the whole device visible as the window resizes.">
                <Select
                  label="Scaling"
                  value={display.scaling}
                  onChange={(scaling) => void update({ display: { scaling } })}
                  options={[
                    { value: 'fit', label: 'Fit to window' },
                    { value: 0.5, label: '50%' },
                    { value: 0.75, label: '75%' },
                    { value: 1, label: '100% (1 video px)' }
                  ]}
                />
              </Row>
              <Row label="Device info panel">
                <Switch label="Device info panel" checked={display.showInfoPanel} onChange={(v) => void update({ display: { showInfoPanel: v } })} />
              </Row>
            </>
          )}

          {section === 'control' && (
            <>
              <Heading>Input</Heading>
              <Row label="Sync clipboard" description="Copying on the phone updates this computer’s clipboard. Ctrl+V always pastes into the phone.">
                <Switch label="Sync clipboard" checked={control.clipboardSync} onChange={(v) => updateLive({ control: { clipboardSync: v } })} />
              </Row>
              <Row label="Show touches" description="Display taps on the phone screen (restored when mirroring stops).">
                <Switch label="Show touches" checked={control.showTouches} onChange={(v) => updateLive({ control: { showTouches: v } })} />
              </Row>
              <Heading>Power</Heading>
              <Row label="Keep phone awake while plugged in">
                <Switch label="Stay awake" checked={control.stayAwake} onChange={(v) => updateLive({ control: { stayAwake: v } })} />
              </Row>
              <Row label="Turn phone screen off when mirroring starts" description="The mirror keeps working; saves battery. Alt+Shift+O turns it back on.">
                <Switch
                  label="Turn screen off"
                  checked={control.turnScreenOffOnStart}
                  onChange={(v) => void update({ control: { turnScreenOffOnStart: v } })}
                />
              </Row>
              <Row label="Lock phone when mirroring stops">
                <Switch label="Lock on stop" checked={control.powerOffOnClose} onChange={(v) => updateLive({ control: { powerOffOnClose: v } })} />
              </Row>
            </>
          )}

          {section === 'capture' && (
            <>
              <Heading>Screenshots</Heading>
              <FolderRow purpose="screenshot" value={capture.screenshotDir} fallback="Pictures\FrameCast" />
              <Heading>Recordings</Heading>
              <FolderRow purpose="recording" value={capture.recordingDir} fallback="Videos\FrameCast" />
              <p className="py-1 text-xs leading-relaxed text-muted">
                Recordings are saved as MP4 without re-encoding, at the mirroring resolution and bitrate. Rotating the phone starts a new
                file. Video only (no audio).
              </p>
              <Heading>Saving</Heading>
              <Row label="Ask where to save each file">
                <Switch label="Ask for location" checked={capture.askForLocation} onChange={(v) => void update({ capture: { askForLocation: v } })} />
              </Row>
            </>
          )}

          {section === 'connection' && (
            <>
              <Heading>Reconnection</Heading>
              <Row label="Reconnect automatically" description="Resume mirroring after an unplug, Wi-Fi drop or phone reboot.">
                <Switch label="Auto-reconnect" checked={connection.autoReconnect} onChange={(v) => void update({ connection: { autoReconnect: v } })} />
              </Row>
              <Row label="Retry attempts">
                <Select
                  label="Retry attempts"
                  value={connection.maxReconnectAttempts}
                  onChange={(maxReconnectAttempts) => void update({ connection: { maxReconnectAttempts } })}
                  options={[1, 3, 5, 10].map((n) => ({ value: n, label: String(n) }))}
                />
              </Row>
              <Row label="Start mirroring when a phone connects">
                <Switch
                  label="Auto-start"
                  checked={connection.autoStartOnConnect}
                  onChange={(v) => void update({ connection: { autoStartOnConnect: v } })}
                />
              </Row>
              <Heading>Wireless</Heading>
              <Row label="TCP/IP port" description="Used when switching a USB phone to Wi-Fi.">
                <TextInput
                  className="w-24"
                  inputMode="numeric"
                  defaultValue={connection.wirelessPort}
                  onBlur={(e) => {
                    const port = Number.parseInt(e.target.value, 10)
                    if (port >= 1 && port <= 65535) void update({ connection: { wirelessPort: port } })
                    else e.target.value = String(connection.wirelessPort)
                  }}
                />
              </Row>
              <Heading>ADB</Heading>
              <Row
                label="ADB executable"
                description="Automatic uses an installed Android SDK (so it shares Android Studio’s adb server), otherwise the bundled copy."
              >
                <Select
                  label="ADB executable"
                  value={adbPref.source}
                  onChange={(source) => void update({ adb: { source } })}
                  options={[
                    { value: 'auto', label: 'Automatic' },
                    { value: 'bundled', label: 'Bundled' },
                    { value: 'system', label: 'Android SDK / PATH' },
                    { value: 'custom', label: 'Custom path' }
                  ]}
                />
              </Row>
              {adbPref.source === 'custom' && (
                <div className="flex gap-2 py-1">
                  <TextInput
                    className="flex-1 font-mono text-xs"
                    placeholder="C:\path\to\adb.exe"
                    value={customAdb}
                    onChange={(e) => setCustomAdb(e.target.value)}
                  />
                  <Button size="sm" onClick={() => void update({ adb: { customPath: customAdb.trim() } })}>
                    Apply
                  </Button>
                </div>
              )}
              <p className={cx('py-1 font-mono text-[11px] break-all', adb.available ? 'text-subtle' : 'text-danger')}>
                {adb.available ? `${adb.path} (${adb.version})` : (adb.error?.message ?? 'ADB not available')}
              </p>
              <Row label="Stop the ADB server on exit" description="Only if FrameCast started it; a server used by Android Studio is left running.">
                <Switch
                  label="Stop ADB on exit"
                  checked={adbPref.stopServerOnExit}
                  onChange={(v) => void update({ adb: { stopServerOnExit: v } })}
                />
              </Row>
            </>
          )}

          {section === 'about' && appInfo && (
            <>
              <Heading>FrameCast {appInfo.version}</Heading>
              <p className="text-xs leading-relaxed text-muted">
                Mirrors and controls a real Android phone over ADB using the open-source scrcpy server (v{appInfo.scrcpyServerVersion},
                Apache-2.0) and a custom WebCodecs client. Device frames are original procedural artwork; profile names describe general
                styles and imply no affiliation with any manufacturer.
              </p>
              <div className="mt-3 space-y-1 font-mono text-[11px] text-subtle">
                <p>Electron {appInfo.electron} · Chromium {appInfo.chrome}</p>
                <p>scrcpy-server: {appInfo.serverAvailable ? 'present' : 'MISSING — run npm run fetch-deps'}</p>
                <p className="break-all">Log: {appInfo.logPath}</p>
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={() => void call('shell:openLogs').catch(() => undefined)}>
                  <FolderOpen size={13} /> Open log folder
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void call('settings:reset')
                      .then((s) => useApp.setState({ settings: s }))
                      .catch((e) => actions.errorToast('Reset failed', e))
                  }
                >
                  Reset all settings
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function FolderRow({ purpose, value, fallback }: { purpose: 'screenshot' | 'recording'; value: string; fallback: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <p className="min-w-0 flex-1 truncate rounded-md border border-line bg-raised px-2.5 py-1.5 font-mono text-xs text-muted select-text" title={value}>
        {value || `Default (${fallback})`}
      </p>
      <Button
        size="sm"
        onClick={() => void call('dialog:chooseDirectory', { purpose }).catch((e) => actions.errorToast('Could not choose folder', e))}
      >
        Change…
      </Button>
      {value && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void actions.updateSettings({ capture: purpose === 'screenshot' ? { screenshotDir: '' } : { recordingDir: '' } })}
        >
          Reset
        </Button>
      )}
    </div>
  )
}
