/**
 * Minimal H.264 Annex B helpers: NAL splitting, codec string derivation for
 * WebCodecs, and conversion to the AVCC (length-prefixed) layout needed by MP4.
 */

export const NAL_TYPE_IDR = 5
export const NAL_TYPE_SPS = 7
export const NAL_TYPE_PPS = 8

/** Split an Annex B byte stream into NAL units (start codes removed). */
export function splitAnnexB(data: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = []
  const n = data.length
  let i = 0
  let start = -1

  while (i + 2 < n) {
    // Look for 0x000001 (a 4-byte 0x00000001 start code ends with the same 3 bytes).
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (start >= 0) {
        let end = i
        // Trailing zero belongs to a 4-byte start code, not the previous NAL.
        while (end > start && data[end - 1] === 0) end--
        if (end > start) nals.push(data.subarray(start, end))
      }
      i += 3
      start = i
    } else {
      i++
    }
  }
  if (start >= 0 && start < n) nals.push(data.subarray(start, n))
  return nals
}

export function nalType(nal: Uint8Array): number {
  return nal[0] & 0x1f
}

function hex2(v: number): string {
  return v.toString(16).padStart(2, '0')
}

/** RFC 6381 codec string ("avc1.PPCCLL") from an SPS NAL unit. */
export function codecStringFromSps(sps: Uint8Array): string {
  if (sps.length < 4) throw new Error('SPS too short')
  return `avc1.${hex2(sps[1])}${hex2(sps[2])}${hex2(sps[3])}`
}

export interface H264Config {
  sps: Uint8Array
  pps: Uint8Array
  codec: string
}

/** Extract SPS/PPS from a config packet (scrcpy sends them together, Annex B). */
export function parseConfigPacket(data: Uint8Array): H264Config | null {
  let sps: Uint8Array | undefined
  let pps: Uint8Array | undefined
  for (const nal of splitAnnexB(data)) {
    const t = nalType(nal)
    if (t === NAL_TYPE_SPS && !sps) sps = nal
    else if (t === NAL_TYPE_PPS && !pps) pps = nal
  }
  if (!sps || !pps) return null
  return { sps, pps, codec: codecStringFromSps(sps) }
}

/** Build an AVCDecoderConfigurationRecord (ISO/IEC 14496-15 "avcC"). */
export function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + sps.length + pps.length)
  let o = 0
  out[o++] = 1 // configurationVersion
  out[o++] = sps[1] // AVCProfileIndication
  out[o++] = sps[2] // profile_compatibility
  out[o++] = sps[3] // AVCLevelIndication
  out[o++] = 0xff // reserved (6 bits) + lengthSizeMinusOne = 3
  out[o++] = 0xe1 // reserved (3 bits) + numOfSequenceParameterSets = 1
  out[o++] = (sps.length >> 8) & 0xff
  out[o++] = sps.length & 0xff
  out.set(sps, o)
  o += sps.length
  out[o++] = 1 // numOfPictureParameterSets
  out[o++] = (pps.length >> 8) & 0xff
  out[o++] = pps.length & 0xff
  out.set(pps, o)
  return out
}

/** Convert Annex B to AVCC (4-byte big-endian length prefixes), optionally dropping SPS/PPS. */
export function annexBToAvcc(data: Uint8Array, dropParameterSets = true): Uint8Array {
  const nals = splitAnnexB(data).filter(
    (nal) => !dropParameterSets || (nalType(nal) !== NAL_TYPE_SPS && nalType(nal) !== NAL_TYPE_PPS)
  )
  const size = nals.reduce((sum, nal) => sum + 4 + nal.length, 0)
  const out = new Uint8Array(size)
  let o = 0
  for (const nal of nals) {
    out[o] = (nal.length >>> 24) & 0xff
    out[o + 1] = (nal.length >>> 16) & 0xff
    out[o + 2] = (nal.length >>> 8) & 0xff
    out[o + 3] = nal.length & 0xff
    out.set(nal, o + 4)
    o += 4 + nal.length
  }
  return out
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
