/**
 * Wire-level constants for scrcpy-server v5.0.1.
 *
 * The scrcpy client/server protocol is internal and changes between releases;
 * the server refuses to start unless the client passes the exact same version.
 * Sources: scrcpy v5.0.1 doc/develop.md, server/.../control/ControlMessage.java,
 * server/.../device/Streamer.java, server/.../device/DesktopConnection.java.
 */
export const SCRCPY_SERVER_VERSION = '5.0.1'
export const SERVER_DEVICE_PATH = '/data/local/tmp/framecast-server.jar'
export const SERVER_MAIN_CLASS = 'com.genymobile.scrcpy.Server'

export const DEVICE_NAME_FIELD_LENGTH = 64
export const PACKET_HEADER_LENGTH = 12

export const CODEC_ID_H264 = 0x68323634
export const CODEC_ID_H265 = 0x68323635
export const CODEC_ID_AV1 = 0x00617631

// Upper bits of the first u64 of each 12-byte packet header.
export const PACKET_FLAG_SESSION = 1n << 63n
export const PACKET_FLAG_CONFIG = 1n << 62n
export const PACKET_FLAG_KEY_FRAME = 1n << 61n
export const PACKET_PTS_MASK = PACKET_FLAG_KEY_FRAME - 1n

export const ControlType = {
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATION_PANEL: 5,
  EXPAND_SETTINGS_PANEL: 6,
  COLLAPSE_PANELS: 7,
  GET_CLIPBOARD: 8,
  SET_CLIPBOARD: 9,
  SET_DISPLAY_POWER: 10,
  ROTATE_DEVICE: 11,
  RESET_VIDEO: 17
} as const

export const DeviceMessageType = {
  CLIPBOARD: 0,
  ACK_CLIPBOARD: 1,
  UHID_OUTPUT: 2
} as const

/** Max UTF-8 bytes of an INJECT_TEXT message (ControlMessageReader.INJECT_TEXT_MAX_LENGTH). */
export const INJECT_TEXT_MAX_BYTES = 300
/** Max UTF-8 bytes of a SET_CLIPBOARD text (256 KiB minus header). */
export const CLIPBOARD_TEXT_MAX_BYTES = (1 << 18) - 14

export const POINTER_ID_MOUSE = -1n
export const POINTER_ID_GENERIC_FINGER = -2n

/** android.view.MotionEvent actions */
export const MotionAction = {
  DOWN: 0,
  UP: 1,
  MOVE: 2,
  HOVER_MOVE: 7
} as const

/** android.view.MotionEvent buttons */
export const MotionButton = {
  PRIMARY: 1 << 0,
  SECONDARY: 1 << 1,
  TERTIARY: 1 << 2,
  BACK: 1 << 3,
  FORWARD: 1 << 4
} as const

export const KeyAction = { DOWN: 0, UP: 1 } as const

/** android.view.KeyEvent key codes used for navigation buttons. */
export const NavKeycode = {
  home: 3,
  back: 4,
  power: 26,
  volumeUp: 24,
  volumeDown: 25,
  menu: 82,
  recents: 187 // KEYCODE_APP_SWITCH
} as const
