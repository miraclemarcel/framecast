import { call } from '../../renderer/api'
import { actions, fileName, useApp } from '../../renderer/store'
import { composeFramedScreenshot } from '../device-frame/compose'

let busy = false

export async function takeScreenshot(framed = false): Promise<void> {
  if (busy) return
  busy = true
  try {
    let path: string | null
    if (framed) {
      const png = await call('capture:grab')
      const composed = await composeFramedScreenshot(png, useApp.getState().settings.frame)
      path = await call('capture:savePng', { data: composed, suffix: 'framed' })
    } else {
      path = await call('capture:screenshot')
    }
    if (path) actions.toast({ level: 'success', title: 'Screenshot saved', message: fileName(path), filePath: path })
  } catch (err) {
    actions.errorToast('Screenshot failed', err)
  } finally {
    busy = false
  }
}

export async function toggleRecording(): Promise<void> {
  try {
    if (useApp.getState().recording.active) {
      // The "Recording saved" toast comes from the recording:status event.
      await call('capture:stopRecording')
    } else {
      const status = await call('capture:startRecording')
      useApp.setState({ recording: status })
    }
  } catch (err) {
    actions.errorToast('Recording failed', err)
  }
}
