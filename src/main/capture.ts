import { BrowserWindow, dialog } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, extname, basename, dirname } from 'node:path'
import { AppError } from '@shared/errors'
import { captureFileName } from '@shared/filenames'
import type { Settings } from '@shared/settings'
import { defaultRecordingDir, defaultScreenshotDir } from './paths'

/** Avoid overwriting: "name.png" → "name (2).png". */
export function uniquePath(path: string): string {
  if (!existsSync(path)) return path
  const ext = extname(path)
  const stem = basename(path, ext)
  for (let i = 2; i < 1000; i++) {
    const candidate = join(dirname(path), `${stem} (${i})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  return join(dirname(path), `${stem}-${Date.now()}${ext}`)
}

export function screenshotDir(settings: Settings): string {
  return settings.capture.screenshotDir || defaultScreenshotDir()
}

export function recordingDir(settings: Settings): string {
  return settings.capture.recordingDir || defaultRecordingDir()
}

/**
 * Resolve where to write a capture: straight into the configured folder,
 * or via a Save dialog when "ask for location" is enabled. Returns null if cancelled.
 */
export async function resolveCapturePath(
  win: BrowserWindow | null,
  settings: Settings,
  kind: 'screenshot' | 'recording',
  deviceName: string,
  suffix?: string
): Promise<string | null> {
  const dir = kind === 'screenshot' ? screenshotDir(settings) : recordingDir(settings)
  const ext = kind === 'screenshot' ? 'png' : 'mp4'
  const name = captureFileName(deviceName, new Date(), ext, suffix)

  if (settings.capture.askForLocation && win) {
    const result = await dialog.showSaveDialog(win, {
      title: kind === 'screenshot' ? 'Save screenshot' : 'Save recording',
      defaultPath: join(dir, name),
      filters: [kind === 'screenshot' ? { name: 'PNG image', extensions: ['png'] } : { name: 'MP4 video', extensions: ['mp4'] }]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  }

  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    throw new AppError(kind === 'screenshot' ? 'SCREENSHOT_FAILED' : 'RECORDING_FAILED', {
      message: `Cannot create the output folder ${dir}.`,
      hint: 'Choose another folder in Settings → Capture.',
      cause: err
    })
  }
  return uniquePath(join(dir, name))
}

export async function writeCapture(path: string, data: Uint8Array): Promise<void> {
  try {
    await writeFile(path, data)
  } catch (err) {
    throw new AppError('SCREENSHOT_FAILED', {
      message: `Could not save the file: ${(err as Error).message}`,
      hint: 'Check that the folder exists and is writable.',
      cause: err
    })
  }
}
