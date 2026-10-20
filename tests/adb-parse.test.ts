import { describe, expect, it } from 'vitest'
import {
  isWirelessSerial,
  parseAdbDevices,
  parseAdbVersion,
  parseDeviceDetails,
  parseWlanIp,
  parseWmSize,
  DETAILS_MARKER
} from '@services/adb/parse'

describe('parseAdbDevices', () => {
  it('parses usb, wireless, unauthorized and no-permission rows', () => {
    const out = [
      '* daemon not running; starting now at tcp:5037',
      '* daemon started successfully',
      'List of devices attached',
      'R58M12ABCDE            device usb:1-1 product:beyond1 model:SM_G973F device:beyond1 transport_id:3',
      '192.168.1.20:5555      device product:sunfish model:Pixel_4a device:sunfish transport_id:4',
      '0123456789ABCDEF       unauthorized usb:1-2 transport_id:5',
      'ZY22X                  no permissions (missing udev rules?); see [http://developer.android.com/tools/device.html] usb:1-3 transport_id:6',
      'emulator-5554          offline transport_id:7',
      ''
    ].join('\r\n')
    const devices = parseAdbDevices(out)
    expect(devices).toHaveLength(5)
    expect(devices[0]).toEqual({
      serial: 'R58M12ABCDE',
      state: 'device',
      kind: 'usb',
      product: 'beyond1',
      model: 'SM G973F',
      device: 'beyond1',
      transportId: '3'
    })
    expect(devices[1]).toMatchObject({ serial: '192.168.1.20:5555', state: 'device', kind: 'wireless', model: 'Pixel 4a' })
    expect(devices[2]).toMatchObject({ serial: '0123456789ABCDEF', state: 'unauthorized', kind: 'usb', transportId: '5' })
    expect(devices[3]).toMatchObject({ serial: 'ZY22X', state: 'no permissions', transportId: '6' })
    expect(devices[4]).toMatchObject({ serial: 'emulator-5554', state: 'offline' })
  })

  it('returns an empty list when no devices are attached', () => {
    expect(parseAdbDevices('List of devices attached\n\n')).toEqual([])
  })

  it('keeps unknown states as "unknown"', () => {
    expect(parseAdbDevices('ABC weird-state transport_id:1')[0]).toMatchObject({ serial: 'ABC', state: 'unknown' })
  })
})

describe('device details', () => {
  it('detects wireless serials, including mDNS names', () => {
    expect(isWirelessSerial('10.0.0.5:37099')).toBe(true)
    expect(isWirelessSerial('adb-R58M12-AbCdEf._adb-tls-connect._tcp')).toBe(true)
    expect(isWirelessSerial('R58M12ABCDE')).toBe(false)
  })

  it('parses getprop / wm output', () => {
    const out = [
      'samsung',
      'SM-G973F',
      '14',
      '34',
      'Physical size: 1080x2280\nOverride size: 720x1520',
      'Physical density: 420'
    ].join(`\n${DETAILS_MARKER}\n`)
    expect(parseDeviceDetails(out)).toEqual({
      manufacturer: 'samsung',
      model: 'SM-G973F',
      androidVersion: '14',
      sdkInt: 34,
      screenWidth: 720,
      screenHeight: 1520,
      density: 420
    })
  })

  it('handles missing values', () => {
    expect(parseDeviceDetails('')).toMatchObject({ model: undefined, sdkInt: undefined, screenWidth: undefined })
    expect(parseWmSize('Physical size: 1440x3120')).toEqual({ width: 1440, height: 3120 })
  })

  it('parses wlan IP and adb version', () => {
    const ip = '30: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet 192.168.1.42/24 brd 192.168.1.255 scope global wlan0'
    expect(parseWlanIp(ip)).toBe('192.168.1.42')
    expect(parseWlanIp('')).toBeUndefined()
    expect(parseAdbVersion('Android Debug Bridge version 1.0.41\nVersion 37.0.1-15733141\n')).toBe('37.0.1-15733141')
  })
})
