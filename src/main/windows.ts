import { app, BrowserWindow, nativeTheme, screen, shell, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { SettingsStore } from './settings-store'
import type { ScopedLogger } from './logger'

export type WindowMode = 'full' | 'compact'

const TITLE_BAR_HEIGHT = 44

/**
 * Owns the two app windows:
 *  - "full": the regular window with toolbars and panels;
 *  - "compact": a frameless, transparent window that shows only the device frame
 *    and a side toolbar, like a standalone emulator.
 * Only one is visible at a time. Transparency cannot be toggled on an existing
 * window, which is why compact mode is a separate window.
 */
export class WindowManager {
  private main: BrowserWindow | null = null
  private compact: BrowserWindow | null = null
  private _mode: WindowMode = 'full'
  /** Cursor offset from the window origin while the compact window is being dragged. */
  private drag: { dx: number; dy: number; width: number; height: number } | null = null
  /** Called after the visible window changes (e.g. to request a fresh key frame). */
  onActiveChanged: () => void = () => undefined

  constructor(
    private readonly settings: SettingsStore,
    private readonly log: ScopedLogger
  ) {}

  get mode(): WindowMode {
    return this._mode
  }

  /** The window the user is looking at; dialogs are parented to it and it receives video. */
  active(): BrowserWindow | null {
    const win = this._mode === 'compact' ? this.compact : this.main
    return win && !win.isDestroyed() ? win : null
  }

  all(): BrowserWindow[] {
    return [this.main, this.compact].filter((w): w is BrowserWindow => !!w && !w.isDestroyed())
  }

  /** Send to every open window (state events). */
  broadcast(channel: string, payload: unknown): void {
    for (const win of this.all()) if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }

  /** Send only to the visible window (video, so frames are decoded once). */
  sendActive(channel: string, payload: unknown): void {
    const win = this.active()
    if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }

  titleBarColors(): { color: string; symbolColor: string } {
    const theme = this.settings.get().theme
    const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
    return dark ? { color: '#0e1014', symbolColor: '#c3c8d0' } : { color: '#f4f5f7', symbolColor: '#3a3f47' }
  }

  updateTitleBar(): void {
    if (this.main && !this.main.isDestroyed()) this.main.setTitleBarOverlay({ ...this.titleBarColors(), height: TITLE_BAR_HEIGHT })
  }

  private secure(win: BrowserWindow, hash: string): void {
    // No popups and no navigation away from the app; https links open in the browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (url !== win.webContents.getURL()) event.preventDefault()
    })
    // No application menu: its accelerators (Ctrl+R, Ctrl+W…) would swallow keys meant for the phone.
    win.removeMenu()
    if (!app.isPackaged) {
      win.webContents.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
      })
    }
    win.webContents.on('render-process-gone', (_e, details) => this.log.error(`Renderer gone: ${details.reason}`))

    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
    else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }

  private webPreferences(): BrowserWindowConstructorOptions['webPreferences'] {
    return {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  }

  private icon(): string | undefined {
    // Packaged builds use the icon embedded in the .exe.
    return app.isPackaged ? undefined : join(__dirname, '../../build/icon.png')
  }

  createMain(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 760,
      minHeight: 560,
      show: false,
      title: 'FrameCast',
      backgroundColor: this.titleBarColors().color,
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...this.titleBarColors(), height: TITLE_BAR_HEIGHT },
      icon: this.icon(),
      webPreferences: this.webPreferences()
    })
    this.main = win
    win.once('ready-to-show', () => {
      if (this._mode === 'full') win.show()
    })
    win.on('closed', () => {
      this.main = null
      // Closing the full window quits, even if the compact window exists but is hidden.
      app.quit()
    })
    win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true))
    win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false))
    this.secure(win, 'full')
    return win
  }

  private createCompact(): BrowserWindow {
    const anchor = this.main?.getBounds()
    const win = new BrowserWindow({
      width: 420,
      height: 820,
      x: anchor ? anchor.x + Math.round(anchor.width / 2) - 210 : undefined,
      y: anchor ? anchor.y + 40 : undefined,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      title: 'FrameCast',
      alwaysOnTop: this.settings.get().display.compactAlwaysOnTop,
      icon: this.icon(),
      webPreferences: this.webPreferences()
    })
    this.compact = win
    win.once('ready-to-show', () => {
      if (this._mode === 'compact') {
        win.show()
        this.onActiveChanged()
      }
    })
    win.on('closed', () => {
      this.compact = null
      if (this._mode === 'compact') app.quit()
    })
    this.secure(win, 'compact')
    return win
  }

  setMode(mode: WindowMode): WindowMode {
    if (mode === this._mode) {
      this.active()?.focus()
      return mode
    }
    this._mode = mode
    if (mode === 'compact') {
      if (this.main?.isFullScreen()) this.main.setFullScreen(false)
      const compact = this.compact && !this.compact.isDestroyed() ? this.compact : this.createCompact()
      this.main?.hide()
      // A freshly created window shows itself once loaded (ready-to-show).
      if (compact.webContents.isLoading()) return mode
      compact.show()
      compact.focus()
    } else {
      const main = this.main
      if (main) {
        main.show()
        main.focus()
      }
      // Free the compact window's renderer and GPU resources.
      const compact = this.compact
      this.compact = null
      compact?.destroy()
    }
    this.onActiveChanged()
    this.log.info(`Window mode: ${mode}`)
    return mode
  }

  /** Resize the compact window to fit its content, keeping it on screen. */
  setCompactSize(width: number, height: number): void {
    const win = this.compact
    if (!win || win.isDestroyed()) return
    const bounds = win.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const w = Math.min(width, area.width)
    const h = Math.min(height, area.height)
    // Keep the window's center horizontally, its top vertically; clamp into the work area.
    const x = Math.min(Math.max(area.x, Math.round(bounds.x + (bounds.width - w) / 2)), area.x + area.width - w)
    const y = Math.min(Math.max(area.y, bounds.y), area.y + area.height - h)
    win.setBounds({ x, y, width: w, height: h })
  }

  /** The largest compact content height that fits the current display. */
  compactMaxHeight(): number {
    const win = this.compact ?? this.main
    const area = win ? screen.getDisplayMatching(win.getBounds()).workArea : screen.getPrimaryDisplay().workArea
    return area.height
  }

  /**
   * Manual window dragging for compact mode. CSS drag regions are not used there:
   * in a transparent window Windows ignores no-drag holes, which made the phone
   * screen move the window instead of receiving touches.
   * Positions come from the OS cursor, so this is correct at any display scaling.
   */
  beginDrag(): void {
    const win = this.compact
    if (!win || win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const b = win.getBounds()
    this.drag = { dx: cursor.x - b.x, dy: cursor.y - b.y, width: b.width, height: b.height }
  }

  dragTo(): void {
    const win = this.compact
    if (!this.drag || !win || win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    // setBounds with the original size: setPosition can drift the size on scaled displays.
    win.setBounds({ x: cursor.x - this.drag.dx, y: cursor.y - this.drag.dy, width: this.drag.width, height: this.drag.height })
  }

  endDrag(): void {
    this.drag = null
  }

  minimize(): void {
    this.active()?.minimize()
  }

  setAlwaysOnTop(value: boolean): void {
    this.compact?.setAlwaysOnTop(value)
  }

  focusActive(): void {
    const win = this.active()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}
