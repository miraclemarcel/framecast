import type { AdbDeviceEntry, AdbDeviceState, DeviceDetails } from '@shared/types'

const KNOWN_STATES: readonly AdbDeviceState[] = [
  'device',
  'unauthorized',
  'offline',
  'authorizing',
  'connecting',
  'no permissions',
  'recovery',
  'sideload',
  'bootloader',
  'host'
]

/** A wireless serial is "host:port" or an mDNS name like "adb-XXXX._adb-tls-connect._tcp". */
export function isWirelessSerial(serial: string): boolean {
  return /^[^\s]+:\d{1,5}$/.test(serial) || serial.includes('._adb-tls-connect.')
}

/**
 * Parse `adb devices -l` output.
 *
 * Example lines:
 *   R58M12ABCDE            device usb:1-1 product:beyond1 model:SM_G973F device:beyond1 transport_id:3
 *   192.168.1.20:5555      device product:sunfish model:Pixel_4a device:sunfish transport_id:4
 *   0123456789ABCDEF       unauthorized usb:1-2 transport_id:5
 *   ZY22X                  no permissions (missing udev rules?); see [http://...] usb:1-3 transport_id:6
 */
export function parseAdbDevices(output: string): AdbDeviceEntry[] {
  const devices: AdbDeviceEntry[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*') || line.startsWith('adb server')) continue

    const match = /^(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    const [, serial, rest] = match

    let state: AdbDeviceState = 'unknown'
    let props = rest
    for (const s of KNOWN_STATES) {
      if (rest === s || rest.startsWith(s + ' ')) {
        state = s
        props = rest.slice(s.length)
        break
      }
    }
    if (state === 'unknown') {
      // Unknown state word: take the first token.
      const [first, ...others] = rest.split(/\s+/)
      if (!first) continue
      props = others.join(' ')
    }

    const entry: AdbDeviceEntry = { serial, state, kind: isWirelessSerial(serial) ? 'wireless' : 'usb' }
    for (const token of props.split(/\s+/)) {
      const idx = token.indexOf(':')
      if (idx <= 0) continue
      const key = token.slice(0, idx)
      const value = token.slice(idx + 1)
      if (key === 'product') entry.product = value
      else if (key === 'model') entry.model = value.replace(/_/g, ' ')
      else if (key === 'device') entry.device = value
      else if (key === 'transport_id') entry.transportId = value
    }
    devices.push(entry)
  }
  return devices
}

export const DETAILS_MARKER = '__FRAMECAST__'

/** Device-side command (constant, no user input) whose output `parseDeviceDetails` understands. */
export const DETAILS_COMMAND = [
  'getprop ro.product.manufacturer',
  `echo ${DETAILS_MARKER}`,
  'getprop ro.product.model',
  `echo ${DETAILS_MARKER}`,
  'getprop ro.build.version.release',
  `echo ${DETAILS_MARKER}`,
  'getprop ro.build.version.sdk',
  `echo ${DETAILS_MARKER}`,
  'wm size',
  `echo ${DETAILS_MARKER}`,
  'wm density'
].join(';')

/** Parse "Physical size: 1080x2400\nOverride size: 720x1600" — the override wins when present. */
export function parseWmSize(text: string): { width: number; height: number } | undefined {
  const override = /Override size:\s*(\d+)x(\d+)/.exec(text)
  const physical = /Physical size:\s*(\d+)x(\d+)/.exec(text)
  const m = override ?? physical
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined
}

export function parseWmDensity(text: string): number | undefined {
  const m = /Override density:\s*(\d+)/.exec(text) ?? /Physical density:\s*(\d+)/.exec(text)
  return m ? Number(m[1]) : undefined
}

export function parseDeviceDetails(output: string): DeviceDetails {
  const parts = output.split(DETAILS_MARKER).map((p) => p.trim())
  const [manufacturer, model, release, sdk, wmSize, wmDensity] = parts
  const size = parseWmSize(wmSize ?? '')
  const sdkInt = Number.parseInt(sdk ?? '', 10)
  return {
    manufacturer: manufacturer || undefined,
    model: model || undefined,
    androidVersion: release || undefined,
    sdkInt: Number.isFinite(sdkInt) ? sdkInt : undefined,
    screenWidth: size?.width,
    screenHeight: size?.height,
    density: parseWmDensity(wmDensity ?? '')
  }
}

/** Parse the IPv4 address of the Wi-Fi interface from `ip -f inet addr show wlan0`. */
export function parseWlanIp(output: string): string | undefined {
  const m = /inet (\d{1,3}(?:\.\d{1,3}){3})\//.exec(output)
  return m?.[1]
}

/** Parse `adb version` output. */
export function parseAdbVersion(output: string): string | undefined {
  const m = /Version ([\w.\-]+)/.exec(output) ?? /Android Debug Bridge version ([\d.]+)/.exec(output)
  return m?.[1]
}
