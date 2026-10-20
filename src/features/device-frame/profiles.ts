import type { FrameFinishId, FrameProfileId } from '@shared/settings'

/**
 * Device frame profiles. All artwork is original and generated procedurally
 * (see frame-svg.ts); "inspired" profiles approximate general proportions of
 * phone families and do not reproduce any manufacturer's design or trademarks.
 *
 * Lengths are fractions of the screen's short side, so a frame always fits the
 * mirrored display's real aspect ratio exactly.
 */
export type Cutout =
  | { type: 'none' }
  | { type: 'punch'; diameter: number; top: number; align: 'center' | 'left' }
  | { type: 'notch'; width: number; height: number; radius: number }

export interface SideButton {
  side: 'left' | 'right'
  /** Distance from the top of the body, fraction of body height. */
  top: number
  /** Length, fraction of body height. */
  length: number
}

export interface FrameProfile {
  id: FrameProfileId
  name: string
  description: string
  bezel: { side: number; top: number; bottom: number }
  /** Width of the outer metal/plastic rim (part of the bezel). */
  rim: number
  bodyRadius: number
  screenRadius: number
  cutout: Cutout
  buttons: SideButton[]
  /** How far buttons protrude from the body. */
  buttonDepth: number
  /** Earpiece slit in the top bezel: width as fraction of screen width. 0 = hidden. */
  speaker: number
}

export const FRAME_PROFILES: Record<FrameProfileId, FrameProfile> = {
  contour: {
    id: 'contour',
    name: 'Contour',
    description: 'Generic modern Android phone: slim even bezels and a centered punch-hole camera.',
    bezel: { side: 0.034, top: 0.04, bottom: 0.042 },
    rim: 0.012,
    bodyRadius: 0.13,
    screenRadius: 0.1,
    cutout: { type: 'punch', diameter: 0.04, top: 0.032, align: 'center' },
    buttons: [
      { side: 'right', top: 0.2, length: 0.11 },
      { side: 'right', top: 0.35, length: 0.065 }
    ],
    buttonDepth: 0.008,
    speaker: 0.14
  },
  slate: {
    id: 'slate',
    name: 'Slate',
    description: 'Flat-sided design with slightly thicker bezels, inspired by recent Pixel-style phones.',
    bezel: { side: 0.042, top: 0.052, bottom: 0.052 },
    rim: 0.016,
    bodyRadius: 0.15,
    screenRadius: 0.105,
    cutout: { type: 'punch', diameter: 0.045, top: 0.036, align: 'center' },
    buttons: [
      { side: 'right', top: 0.17, length: 0.07 },
      { side: 'right', top: 0.27, length: 0.13 }
    ],
    buttonDepth: 0.009,
    speaker: 0.16
  },
  edge: {
    id: 'edge',
    name: 'Edge',
    description: 'Near-borderless display with a tiny punch hole and tighter corners, inspired by Galaxy-style phones.',
    bezel: { side: 0.026, top: 0.03, bottom: 0.03 },
    rim: 0.01,
    bodyRadius: 0.1,
    screenRadius: 0.075,
    cutout: { type: 'punch', diameter: 0.034, top: 0.026, align: 'center' },
    buttons: [
      { side: 'right', top: 0.22, length: 0.12 },
      { side: 'right', top: 0.37, length: 0.06 }
    ],
    buttonDepth: 0.007,
    speaker: 0.12
  },
  notch: {
    id: 'notch',
    name: 'Notch',
    description: 'Classic wide-notch design with a camera housing in the top center.',
    bezel: { side: 0.036, top: 0.04, bottom: 0.044 },
    rim: 0.013,
    bodyRadius: 0.14,
    screenRadius: 0.11,
    cutout: { type: 'notch', width: 0.4, height: 0.07, radius: 0.03 },
    buttons: [
      { side: 'left', top: 0.17, length: 0.05 },
      { side: 'left', top: 0.25, length: 0.09 },
      { side: 'left', top: 0.36, length: 0.09 },
      { side: 'right', top: 0.26, length: 0.13 }
    ],
    buttonDepth: 0.008,
    speaker: 0
  },
  none: {
    id: 'none',
    name: 'Screen only',
    description: 'No device body: just the display with rounded corners.',
    bezel: { side: 0, top: 0, bottom: 0 },
    rim: 0,
    bodyRadius: 0.035,
    screenRadius: 0.035,
    cutout: { type: 'none' },
    buttons: [],
    buttonDepth: 0,
    speaker: 0
  }
}

export interface FrameFinish {
  id: FrameFinishId
  name: string
  /** Rim gradient (top → bottom). */
  rim: [string, string]
  /** Highlight line along the rim. */
  rimHighlight: string
  button: string
  /** Glass/bezel color around the screen. */
  bezel: string
}

export const FRAME_FINISHES: Record<FrameFinishId, FrameFinish> = {
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian',
    rim: ['#3a3d43', '#1b1d21'],
    rimHighlight: 'rgba(255,255,255,0.14)',
    button: '#2b2e33',
    bezel: '#050607'
  },
  porcelain: {
    id: 'porcelain',
    name: 'Porcelain',
    rim: ['#f1eee9', '#cfcac2'],
    rimHighlight: 'rgba(255,255,255,0.7)',
    button: '#d9d4cc',
    bezel: '#07080a'
  },
  sage: {
    id: 'sage',
    name: 'Sage',
    rim: ['#a9b5a2', '#77836f'],
    rimHighlight: 'rgba(255,255,255,0.35)',
    button: '#8c9885',
    bezel: '#060707'
  },
  titanium: {
    id: 'titanium',
    name: 'Titanium',
    rim: ['#a29d95', '#6c6862'],
    rimHighlight: 'rgba(255,255,255,0.4)',
    button: '#8a857e',
    bezel: '#060607'
  }
}

export function getProfile(id: FrameProfileId): FrameProfile {
  return FRAME_PROFILES[id] ?? FRAME_PROFILES.contour
}

export function getFinish(id: FrameFinishId): FrameFinish {
  return FRAME_FINISHES[id] ?? FRAME_FINISHES.obsidian
}
