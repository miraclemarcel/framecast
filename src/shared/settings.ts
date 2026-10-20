import { z } from 'zod'

export const FRAME_PROFILE_IDS = ['contour', 'slate', 'edge', 'notch', 'none'] as const
export const FRAME_FINISH_IDS = ['obsidian', 'porcelain', 'sage', 'titanium'] as const

export const settingsSchema = z.object({
  frame: z
    .object({
      profile: z.enum(FRAME_PROFILE_IDS).default('contour'),
      finish: z.enum(FRAME_FINISH_IDS).default('obsidian'),
      showButtons: z.boolean().default(true),
      showShadow: z.boolean().default(true),
      /** Show the device frame in full-screen mode (otherwise only the screen). */
      frameInFullscreen: z.boolean().default(false)
    })
    .prefault({}),
  video: z
    .object({
      /** Longest side in pixels; 0 = native resolution. */
      maxSize: z.number().int().min(0).max(4096).default(1600),
      /** Bits per second. */
      bitRate: z.number().int().min(500_000).max(64_000_000).default(8_000_000),
      /** 0 = unlimited (device decides). */
      maxFps: z.number().int().min(0).max(120).default(60),
      /** When the device encoder fails, retry with a lower resolution. */
      downsizeOnError: z.boolean().default(true)
    })
    .prefault({}),
  display: z
    .object({
      /** "fit" scales the device to the window; a number is a fixed zoom (1 = 100%). */
      scaling: z.union([z.literal('fit'), z.number().min(0.25).max(2)]).default('fit'),
      showInfoPanel: z.boolean().default(true)
    })
    .prefault({}),
  capture: z
    .object({
      screenshotDir: z.string().default(''),
      recordingDir: z.string().default(''),
      /** Ask for a location every time instead of saving straight to the default folder. */
      askForLocation: z.boolean().default(false)
    })
    .prefault({}),
  connection: z
    .object({
      autoReconnect: z.boolean().default(true),
      autoStartOnConnect: z.boolean().default(false),
      maxReconnectAttempts: z.number().int().min(0).max(20).default(5),
      wirelessPort: z.number().int().min(1).max(65535).default(5555),
      lastWirelessHost: z.string().default('')
    })
    .prefault({}),
  control: z
    .object({
      clipboardSync: z.boolean().default(true),
      stayAwake: z.boolean().default(false),
      showTouches: z.boolean().default(false),
      turnScreenOffOnStart: z.boolean().default(false),
      /** Lock the phone screen when mirroring stops. */
      powerOffOnClose: z.boolean().default(false)
    })
    .prefault({}),
  adb: z
    .object({
      source: z.enum(['auto', 'bundled', 'system', 'custom']).default('auto'),
      customPath: z.string().default(''),
      /** Run `adb kill-server` on exit, but only if FrameCast started the server. */
      stopServerOnExit: z.boolean().default(true)
    })
    .prefault({}),
  theme: z.enum(['system', 'dark', 'light']).default('dark')
})

export type Settings = z.infer<typeof settingsSchema>
export type FrameProfileId = (typeof FRAME_PROFILE_IDS)[number]
export type FrameFinishId = (typeof FRAME_FINISH_IDS)[number]

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})

/** Deep-partial for patch updates sent from the renderer. */
export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K]
}

/** Merge a patch into settings and re-validate. Throws a ZodError on invalid input. */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  const merged: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    const existing = (current as Record<string, unknown>)[key]
    merged[key] =
      value && typeof value === 'object' && existing && typeof existing === 'object'
        ? { ...existing, ...value }
        : value
  }
  return settingsSchema.parse(merged)
}

/** Parse persisted JSON leniently: invalid sections fall back to defaults instead of losing everything. */
export function parseStoredSettings(raw: unknown): Settings {
  const full = settingsSchema.safeParse(raw)
  if (full.success) return full.data
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const field = settingsSchema.shape[key]
    const parsed = field.safeParse((raw as Record<string, unknown>)[key])
    result[key] = parsed.success ? parsed.data : DEFAULT_SETTINGS[key]
  }
  return settingsSchema.parse(result)
}
