import type { DeviceInfo } from '@shared/types'

/**
 * Keep the user's selection stable as the device list changes:
 * 1. the current selection, if still listed;
 * 2. otherwise the last mirrored device, if it came back;
 * 3. otherwise the first ready device, then any device.
 */
export function chooseSelectedSerial(
  devices: readonly DeviceInfo[],
  current: string | null,
  lastUsed: string | null
): string | null {
  if (current && devices.some((d) => d.serial === current)) return current
  if (lastUsed && devices.some((d) => d.serial === lastUsed)) return lastUsed
  return devices.find((d) => d.state === 'device')?.serial ?? devices[0]?.serial ?? null
}

export function deviceDisplayName(d: DeviceInfo): string {
  const model = d.details?.model ?? d.model
  if (model) {
    const maker = d.details?.manufacturer
    // Avoid "samsung SM-G973F" duplicates like "Google Google Pixel".
    return maker && !model.toLowerCase().startsWith(maker.toLowerCase()) ? `${capitalize(maker)} ${model}` : model
  }
  return d.serial
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export type DeviceStatusTone = 'ready' | 'warning' | 'error' | 'muted'

export function deviceStatus(d: DeviceInfo): { label: string; tone: DeviceStatusTone } {
  switch (d.state) {
    case 'device':
      return { label: d.kind === 'wireless' ? 'Ready · Wi-Fi' : 'Ready · USB', tone: 'ready' }
    case 'unauthorized':
      return { label: 'Waiting for authorization', tone: 'warning' }
    case 'authorizing':
      return { label: 'Authorizing…', tone: 'warning' }
    case 'connecting':
      return { label: 'Connecting…', tone: 'warning' }
    case 'offline':
      return { label: 'Offline', tone: 'error' }
    case 'no permissions':
      return { label: 'No permission (driver)', tone: 'error' }
    default:
      return { label: d.state, tone: 'muted' }
  }
}
