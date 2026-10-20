import { describe, expect, it } from 'vitest'
import { computeFrameGeometry, fitScale, rotateRectCcw } from '@features/device-frame/geometry'
import { FRAME_FINISHES, FRAME_PROFILES } from '@features/device-frame/profiles'
import { renderFrameSvg } from '@features/device-frame/frame-svg'

describe('computeFrameGeometry', () => {
  for (const profile of Object.values(FRAME_PROFILES)) {
    it(`${profile.id}: screen rect matches the video size exactly (portrait)`, () => {
      const g = computeFrameGeometry(profile, { width: 1080, height: 2400 })
      expect(g.landscape).toBe(false)
      expect(g.screen.width).toBeCloseTo(1080)
      expect(g.screen.height).toBeCloseTo(2400)
      // Screen lies inside the body, which lies inside the outer box.
      expect(g.screen.x).toBeGreaterThanOrEqual(g.body.x)
      expect(g.screen.y).toBeGreaterThanOrEqual(g.body.y)
      expect(g.screen.x + g.screen.width).toBeLessThanOrEqual(g.body.x + g.body.width + 1e-6)
      expect(g.screen.y + g.screen.height).toBeLessThanOrEqual(g.body.y + g.body.height + 1e-6)
      expect(g.body.x + g.body.width).toBeLessThanOrEqual(g.outer.width + 1e-6)
    })

    it(`${profile.id}: landscape swaps axes and keeps the aspect ratio`, () => {
      const g = computeFrameGeometry(profile, { width: 2400, height: 1080 })
      expect(g.landscape).toBe(true)
      expect(g.screen.width).toBeCloseTo(2400)
      expect(g.screen.height).toBeCloseTo(1080)
      expect(g.outer.width).toBeCloseTo(g.portrait.outer.height)
      expect(g.outer.height).toBeCloseTo(g.portrait.outer.width)
      expect(g.screen.x + g.screen.width).toBeLessThanOrEqual(g.outer.width + 1e-6)
      expect(g.screen.y + g.screen.height).toBeLessThanOrEqual(g.outer.height + 1e-6)
    })
  }

  it('the "none" profile has no bezel', () => {
    const g = computeFrameGeometry(FRAME_PROFILES.none, { width: 720, height: 1600 })
    expect(g.outer).toEqual({ width: 720, height: 1600 })
    expect(g.screen.x).toBe(0)
  })

  it('uneven bezels keep the larger bottom bezel on the right in landscape', () => {
    const p = FRAME_PROFILES.contour
    const g = computeFrameGeometry(p, { width: 2000, height: 1000 })
    const leftGap = g.screen.x
    const rightGap = g.outer.width - g.screen.x - g.screen.width
    expect(leftGap).toBeCloseTo(p.bezel.top * 1000)
    expect(rightGap).toBeCloseTo(p.bezel.bottom * 1000)
  })
})

describe('rotateRectCcw', () => {
  it('maps the top-right corner of a portrait box to the top-left of the landscape box', () => {
    // container 100 wide; rect hugging the right edge at the top
    expect(rotateRectCcw({ x: 90, y: 0, width: 10, height: 20 }, 100)).toEqual({ x: 0, y: 0, width: 20, height: 10 })
  })
})

describe('fitScale', () => {
  it('fits by the limiting dimension with padding', () => {
    expect(fitScale({ width: 100, height: 200 }, { width: 500, height: 500 }, 50)).toBeCloseTo(2)
    expect(fitScale({ width: 400, height: 100 }, { width: 500, height: 500 }, 50)).toBeCloseTo(1)
  })
  it('returns a fixed zoom unchanged', () => {
    expect(fitScale({ width: 100, height: 200 }, { width: 500, height: 500 }, 50, 0.5)).toBe(0.5)
  })
  it('never returns zero or negative for tiny containers', () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 10, height: 10 }, 50)).toBeGreaterThan(0)
  })
})

describe('renderFrameSvg', () => {
  it('produces well-formed SVG with the outer size as viewBox', () => {
    const g = computeFrameGeometry(FRAME_PROFILES.notch, { width: 2340, height: 1080 })
    const svg = renderFrameSvg(g, FRAME_PROFILES.notch, FRAME_FINISHES.porcelain, { showButtons: true })
    expect(svg.base.startsWith('<svg')).toBe(true)
    expect(svg.base).toContain(`viewBox="0 0 ${Math.round(g.outer.width * 100) / 100} `)
    expect(svg.base).toContain('rotate(-90)')
    expect(svg.overlay).toContain('<path')
    expect(svg.base).not.toMatch(/NaN|undefined/)
  })
  it('omits buttons when disabled', () => {
    const g = computeFrameGeometry(FRAME_PROFILES.contour, { width: 1080, height: 2400 })
    const withButtons = renderFrameSvg(g, FRAME_PROFILES.contour, FRAME_FINISHES.obsidian, { showButtons: true }).base
    const without = renderFrameSvg(g, FRAME_PROFILES.contour, FRAME_FINISHES.obsidian, { showButtons: false }).base
    expect(withButtons.length).toBeGreaterThan(without.length)
  })
})
