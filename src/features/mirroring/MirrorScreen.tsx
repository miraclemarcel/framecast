import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { ControlCommand } from '@shared/ipc'
import type { Size } from '@shared/types'
import { clientToVideo, mirrorPoint, wheelToScroll } from './coordinates'
import { classifyKey } from './keyboard'
import { VideoRenderer } from './video-renderer'

const BUTTON_PRIMARY = 1

interface ActivePointer {
  /** scrcpy pointer id: -1 mouse, 0..9 fingers. */
  id: number
  pinch: boolean
}

export interface MirrorScreenProps {
  /** Current encoded video size; coordinates are sent in this space. */
  videoSize: Size | null
  streaming: boolean
  onVideoVisible(visible: boolean): void
  onStats(stats: { fps: number; kbps: number }): void
  onFatal(message: string): void
  onKeyboardFocus(focused: boolean): void
}

function send(command: ControlCommand): void {
  window.framecast.control(command)
}

/** Split text so each INJECT_TEXT message stays under the server's 300-byte limit. */
function textChunks(text: string): string[] {
  const chunks: string[] = []
  let current = ''
  for (const ch of text) {
    if (new TextEncoder().encode(current + ch).length > 300) {
      chunks.push(current)
      current = ''
    }
    current += ch
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * The live phone screen: a canvas fed by the WebCodecs renderer, plus input
 * capture. Pointer coordinates are mapped from the canvas element (which covers
 * exactly the device screen, never the frame) into video pixels.
 */
export function MirrorScreen(props: MirrorScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pointers = useRef(new Map<number, ActivePointer>())
  const keyRepeat = useRef(new Map<string, number>())
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const canvas = canvasRef.current!
    if (!VideoRenderer.isSupported()) {
      latest.current.onFatal('This system does not support hardware video decoding (WebCodecs).')
      return
    }
    const renderer = new VideoRenderer(canvas, {
      onFirstFrame: () => latest.current.onVideoVisible(true),
      requestKeyFrame: () => send({ type: 'resetVideo' }),
      onStats: (s) => latest.current.onStats(s),
      onFatal: (m) => latest.current.onFatal(m)
    })
    const off = window.framecast.on('mirror:video', (ev) => {
      renderer.handle(ev)
      if (ev.kind === 'end') latest.current.onVideoVisible(false)
    })
    return () => {
      off()
      renderer.destroy()
    }
  }, [])

  const toVideo = (clientX: number, clientY: number) => {
    const video = latest.current.videoSize
    const canvas = canvasRef.current
    if (!video || !canvas) return null
    const p = clientToVideo(clientX, clientY, canvas.getBoundingClientRect(), video)
    return p ? { ...p, width: video.width, height: video.height } : null
  }

  const touch = (
    action: 'down' | 'move' | 'up',
    pointerId: number,
    p: { x: number; y: number; width: number; height: number },
    pressure: number,
    isMouse: boolean
  ): void => {
    send({
      type: 'touch',
      action,
      pointerId,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      pressure: action === 'up' ? 0 : pressure,
      actionButton: isMouse ? BUTTON_PRIMARY : 0,
      buttons: isMouse && action !== 'up' ? BUTTON_PRIMARY : 0
    })
  }

  const nextFingerId = (): number => {
    const used = new Set([...pointers.current.values()].map((p) => p.id))
    for (let i = 0; i < 10; i++) if (!used.has(i)) return i
    return -1
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    // preventDefault keeps the browser from moving focus away from the phone input on mousedown.
    e.preventDefault()
    inputRef.current?.focus({ preventScroll: true })
    if (!latest.current.streaming) return
    const p = toVideo(e.clientX, e.clientY)
    if (!p) return

    if (e.pointerType === 'mouse') {
      // Extra buttons follow scrcpy's defaults.
      if (e.button === 2) return send({ type: 'backOrScreenOn', action: 'down' })
      if (e.button === 1) return send({ type: 'nav', key: 'home' })
      if (e.button === 3) return send({ type: 'nav', key: 'recents' })
      if (e.button === 4) return send({ type: 'panel', panel: 'notifications' })
      if (e.button !== 0) return
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    const isMouse = e.pointerType === 'mouse'
    if (isMouse && e.ctrlKey) {
      // Pinch: a generic finger under the cursor plus a virtual finger mirrored around the center.
      pointers.current.set(e.pointerId, { id: -2, pinch: true })
      touch('down', -2, p, 1, false)
      touch('down', -3, { ...p, ...mirrorPoint(p, p) }, 1, false)
      return
    }
    const id = isMouse ? -1 : nextFingerId()
    if (id === -1 && !isMouse) return // more than 10 fingers
    pointers.current.set(e.pointerId, { id, pinch: false })
    touch('down', id, p, e.pressure || 1, isMouse)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const active = pointers.current.get(e.pointerId)
    if (!active) return
    const p = toVideo(e.clientX, e.clientY)
    if (!p) return
    if (active.pinch) {
      touch('move', -2, p, 1, false)
      touch('move', -3, { ...p, ...mirrorPoint(p, p) }, 1, false)
    } else {
      touch('move', active.id, p, e.pressure || 1, e.pointerType === 'mouse')
    }
  }

  const endPointer = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.pointerType === 'mouse' && e.button === 2) {
      send({ type: 'backOrScreenOn', action: 'up' })
      return
    }
    const active = pointers.current.get(e.pointerId)
    if (!active) return
    pointers.current.delete(e.pointerId)
    const p = toVideo(e.clientX, e.clientY)
    if (!p) return
    if (active.pinch) {
      touch('up', -2, p, 0, false)
      touch('up', -3, { ...p, ...mirrorPoint(p, p) }, 0, false)
    } else {
      touch('up', active.id, p, 0, e.pointerType === 'mouse')
    }
  }

  // Wheel needs a non-passive listener to prevent page scrolling.
  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent): void => {
      if (!latest.current.streaming) return
      e.preventDefault()
      const p = toVideo(e.clientX, e.clientY)
      if (!p) return
      const { h, v } = wheelToScroll(e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX, e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY, e.deltaMode)
      if (h === 0 && v === 0) return
      send({ type: 'scroll', x: p.x, y: p.y, width: p.width, height: p.height, hScroll: h, vScroll: v, buttons: 0 })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!latest.current.streaming || e.nativeEvent.isComposing || e.key === 'Process') return
    const action = classifyKey(e.nativeEvent)
    if (action.kind === 'paste') {
      e.preventDefault()
      send({ type: 'paste' })
    } else if (action.kind === 'keycode') {
      e.preventDefault()
      const repeat = e.repeat ? (keyRepeat.current.get(e.code) ?? 0) + 1 : 0
      keyRepeat.current.set(e.code, repeat)
      send({ type: 'key', action: 'down', keycode: action.keycode, repeat, metaState: action.metaState })
    } else if (action.kind === 'ignore' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
    }
    // 'text' falls through to the input event.
  }

  const onKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!latest.current.streaming) return
    const action = classifyKey(e.nativeEvent)
    if (action.kind === 'keycode') {
      e.preventDefault()
      keyRepeat.current.delete(e.code)
      send({ type: 'key', action: 'up', keycode: action.keycode, repeat: 0, metaState: action.metaState })
    }
  }

  const flushText = (text: string): void => {
    if (!text || !latest.current.streaming) return
    for (const chunk of textChunks(text)) send({ type: 'text', text: chunk })
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ touchAction: 'none', cursor: props.streaming ? 'default' : 'auto' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* Off-screen text sink: receives keyboard and IME input destined for the phone. */}
      <textarea
        ref={inputRef}
        aria-label="Phone keyboard input"
        className="pointer-events-none absolute top-0 left-0 h-px w-px opacity-0"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onFocus={() => props.onKeyboardFocus(true)}
        onBlur={() => props.onKeyboardFocus(false)}
        onInput={(e) => {
          const el = e.currentTarget
          if ((e.nativeEvent as InputEvent).isComposing) return
          flushText(el.value)
          el.value = ''
        }}
        onCompositionEnd={(e) => {
          flushText(e.data)
          e.currentTarget.value = ''
        }}
      />
    </>
  )
}
