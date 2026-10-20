/** Make a device name safe for Windows file names. */
export function sanitizeFilePart(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return cleaned.slice(0, 60) || 'Android'
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function timestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  )
}

/** e.g. "Pixel-7_2026-10-20_13-45-12.png", "Pixel-7_2026-10-20_13-45-12_framed.png" */
export function captureFileName(deviceName: string, date: Date, ext: 'png' | 'mp4', suffix?: string): string {
  const tail = suffix ? `_${suffix}` : ''
  return `${sanitizeFilePart(deviceName)}_${timestamp(date)}${tail}.${ext}`
}

/** Insert "_partN" before the extension for N >= 2. */
export function partFileName(base: string, part: number): string {
  if (part <= 1) return base
  const dot = base.lastIndexOf('.')
  return dot < 0 ? `${base}_part${part}` : `${base.slice(0, dot)}_part${part}${base.slice(dot)}`
}
