import type { VideoEvent } from '@shared/ipc'
import { concatBytes, parseConfigPacket } from '@shared/media/h264'
import type { StreamStats } from '@shared/types'

export interface VideoRendererCallbacks {
  /** First frame drawn after (re)start; the canvas now shows real content. */
  onFirstFrame(): void
  /** Ask the device for a fresh key frame (after a decoder reset). */
  requestKeyFrame(): void
  onStats(stats: StreamStats): void
  /** Unrecoverable decoding failure (repeated errors). */
  onFatal(message: string): void
}

const MAX_QUEUE = 8
const MAX_ERRORS_PER_MINUTE = 5

/**
 * Decodes the H.264 stream with WebCodecs and paints frames onto a canvas.
 * Runs entirely outside React: packets go straight from IPC to the decoder.
 */
export class VideoRenderer {
  private decoder: VideoDecoder | null = null
  private codec: string | null = null
  private pendingConfig: Uint8Array | null = null
  private waitingForKey = true
  private readonly ctx: CanvasRenderingContext2D
  private hasFrame = false
  private errors: number[] = []
  private frames = 0
  private bytes = 0
  private statsTimer: number
  private destroyed = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cb: VideoRendererCallbacks
  ) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
    this.statsTimer = window.setInterval(() => {
      this.cb.onStats({ fps: this.frames, kbps: Math.round((this.bytes * 8) / 1000) })
      this.frames = 0
      this.bytes = 0
    }, 1000)
  }

  static isSupported(): boolean {
    return typeof VideoDecoder !== 'undefined'
  }

  handle(ev: VideoEvent): void {
    if (this.destroyed) return
    switch (ev.kind) {
      case 'session':
        if (this.canvas.width !== ev.width || this.canvas.height !== ev.height) {
          this.canvas.width = ev.width
          this.canvas.height = ev.height
        }
        break
      case 'packet':
        this.bytes += ev.data.byteLength
        if (ev.config) this.onConfig(ev.data)
        else this.onMedia(ev.data, ev.key, ev.pts)
        break
      case 'end':
        this.reset()
        this.hasFrame = false
        break
    }
  }

  private onConfig(data: Uint8Array): void {
    const config = parseConfigPacket(data)
    if (!config) return
    if (!this.decoder || this.decoder.state === 'closed' || this.codec !== config.codec) {
      this.createDecoder(config.codec)
    }
    // Annex B mode: SPS/PPS are sent in-band, prepended to the next key frame.
    this.pendingConfig = data
    this.waitingForKey = true
  }

  private createDecoder(codec: string): void {
    this.closeDecoder()
    this.codec = codec
    const decoder = new VideoDecoder({
      output: (frame) => this.draw(frame),
      error: (e) => this.onDecoderError(e)
    })
    decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: 'no-preference' })
    this.decoder = decoder
  }

  private onMedia(data: Uint8Array, key: boolean, pts: number): void {
    const decoder = this.decoder
    if (!decoder || decoder.state !== 'configured') return
    if (this.waitingForKey && !key) return

    if (decoder.decodeQueueSize > MAX_QUEUE) {
      // The decoder fell behind: skip to the next key frame instead of building latency.
      this.waitingForKey = true
      this.cb.requestKeyFrame()
      if (!key) return
    }

    let payload = data
    if (key && this.pendingConfig) {
      payload = concatBytes(this.pendingConfig, data)
    }
    try {
      decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: pts, data: payload }))
      if (key) this.waitingForKey = false
    } catch (e) {
      this.onDecoderError(e as Error)
    }
  }

  private draw(frame: VideoFrame): void {
    try {
      if (this.destroyed) return
      const w = frame.displayWidth
      const h = frame.displayHeight
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w
        this.canvas.height = h
      }
      this.ctx.drawImage(frame, 0, 0, w, h)
      this.frames++
      if (!this.hasFrame) {
        this.hasFrame = true
        this.cb.onFirstFrame()
      }
    } finally {
      frame.close()
    }
  }

  private onDecoderError(e: Error): void {
    const now = Date.now()
    this.errors = this.errors.filter((t) => now - t < 60_000)
    this.errors.push(now)
    console.warn('Video decoder error', e)
    this.closeDecoder()
    if (this.errors.length >= MAX_ERRORS_PER_MINUTE) {
      this.cb.onFatal(e.message || 'Decoder error')
      return
    }
    // Recover: a fresh config + key frame recreates the decoder.
    this.waitingForKey = true
    this.cb.requestKeyFrame()
  }

  private closeDecoder(): void {
    if (this.decoder && this.decoder.state !== 'closed') {
      try {
        this.decoder.close()
      } catch {
        // already closed
      }
    }
    this.decoder = null
    this.codec = null
  }

  private reset(): void {
    this.closeDecoder()
    this.pendingConfig = null
    this.waitingForKey = true
  }

  /** The canvas currently shows a decoded frame. */
  get showingVideo(): boolean {
    return this.hasFrame
  }

  destroy(): void {
    this.destroyed = true
    window.clearInterval(this.statsTimer)
    this.reset()
  }
}
