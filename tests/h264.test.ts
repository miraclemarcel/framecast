import { describe, expect, it } from 'vitest'
import { annexBToAvcc, buildAvcC, codecStringFromSps, parseConfigPacket, splitAnnexB } from '@shared/media/h264'

const SPS = Uint8Array.from([0x67, 0x64, 0x00, 0x28, 0xac, 0xd9])
const PPS = Uint8Array.from([0x68, 0xeb, 0xe3, 0xcb])

describe('H.264 helpers', () => {
  it('splits Annex B with 3- and 4-byte start codes', () => {
    const data = Uint8Array.from([0, 0, 0, 1, ...SPS, 0, 0, 1, ...PPS, 0, 0, 0, 1, 0x65, 1, 2])
    const nals = splitAnnexB(data)
    expect(nals.map((n) => [...n])).toEqual([[...SPS], [...PPS], [0x65, 1, 2]])
  })

  it('derives the WebCodecs codec string', () => {
    expect(codecStringFromSps(SPS)).toBe('avc1.640028')
  })

  it('parses a config packet', () => {
    const cfg = parseConfigPacket(Uint8Array.from([0, 0, 0, 1, ...SPS, 0, 0, 0, 1, ...PPS]))
    expect(cfg?.codec).toBe('avc1.640028')
    expect([...cfg!.sps]).toEqual([...SPS])
    expect([...cfg!.pps]).toEqual([...PPS])
    expect(parseConfigPacket(Uint8Array.from([0, 0, 1, 0x65]))).toBeNull()
  })

  it('builds an avcC record', () => {
    const avcc = buildAvcC(SPS, PPS)
    expect([...avcc]).toEqual([1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, SPS.length, ...SPS, 1, 0, PPS.length, ...PPS])
  })

  it('converts to length-prefixed NALs, dropping parameter sets', () => {
    const data = Uint8Array.from([0, 0, 0, 1, ...SPS, 0, 0, 0, 1, 0x65, 0xaa, 0xbb])
    expect([...annexBToAvcc(data)]).toEqual([0, 0, 0, 3, 0x65, 0xaa, 0xbb])
    expect(annexBToAvcc(data, false).length).toBe(4 + SPS.length + 4 + 3)
  })
})
