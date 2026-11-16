// Emule — WebCodecs codec strings from Annex-B parameter sets (owner: B). Pure, no DOM.
//   H.264: avc1.PPCCLL from the SPS (profile_idc, constraint flags, level_idc).
//   H.265: hev1.<space><profile>.<compat>.<tier><level>.<constraints> from the SPS (or VPS)
//          general profile_tier_level (ISO/IEC 14496-15 Annex E).

export const DEFAULT_H264 = 'avc1.640033';      // High@5.1
export const DEFAULT_H265 = 'hev1.1.6.L153.B0'; // Main, tier Main, level 5.1
export const DEFAULT_AV1 = 'av01.0.08M.08';

/** Split an Annex-B byte stream into NAL unit payloads (without start codes). */
export function splitAnnexB(data) {
  const nals = [];
  const n = data.length;
  let i = 0;
  let start = -1;
  while (i + 2 < n) {
    if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && i + 3 < n && data[i + 3] === 1))) {
      const scLen = data[i + 2] === 1 ? 3 : 4;
      if (start >= 0) {
        let end = i;
        nals.push(data.subarray(start, end));
      }
      i += scLen;
      start = i;
    } else {
      i++;
    }
  }
  if (start >= 0 && start < n) nals.push(data.subarray(start, n));
  // trailing zero bytes belong to the next start code / are padding
  return nals.map((nal) => {
    let e = nal.length;
    while (e > 0 && nal[e - 1] === 0) e--;
    return nal.subarray(0, e);
  }).filter((nal) => nal.length > 0);
}

/** Remove emulation-prevention bytes (00 00 03 → 00 00) from the first `max` bytes of a NAL. */
export function unescapeRbsp(nal, max = nal.length) {
  const out = [];
  let zeros = 0;
  for (let i = 0; i < nal.length && out.length < max; i++) {
    const b = nal[i];
    if (zeros >= 2 && b === 3) { zeros = 0; continue; }
    out.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

const hex2 = (b) => b.toString(16).padStart(2, '0');

/** NAL type of an H.264 NAL. */
export const h264NalType = (nal) => nal[0] & 0x1f;
/** NAL type of an H.265 NAL. */
export const h265NalType = (nal) => (nal[0] >> 1) & 0x3f;

/** 'avc1.PPCCLL' from an H.264 SPS NAL (with header byte), or null. */
export function avcCodecFromSps(sps) {
  if (!sps || sps.length < 4 || h264NalType(sps) !== 7) return null;
  const r = unescapeRbsp(sps, 8);
  if (r.length < 4) return null;
  return 'avc1.' + hex2(r[1]) + hex2(r[2]) + hex2(r[3]);
}

/** Reverse the bit order of a 32-bit value. */
function reverseBits32(v) {
  let r = 0;
  for (let i = 0; i < 32; i++) { r = (r << 1) | (v & 1); v >>>= 1; }
  return r >>> 0;
}

/** Codec string from the 12-byte general_profile_tier_level structure. */
export function hevcCodecFromPtl(ptl) {
  if (!ptl || ptl.length < 12) return null;
  const profileSpace = ptl[0] >> 6;
  const tier = (ptl[0] >> 5) & 1;
  const profileIdc = ptl[0] & 0x1f;
  const compat = ((ptl[1] << 24) | (ptl[2] << 16) | (ptl[3] << 8) | ptl[4]) >>> 0;
  const constraints = Array.from(ptl.subarray(5, 11));
  const level = ptl[11];
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  let s = 'hev1.' + ['', 'A', 'B', 'C'][profileSpace] + profileIdc;
  s += '.' + reverseBits32(compat).toString(16).toUpperCase();
  s += '.' + (tier ? 'H' : 'L') + level;
  // ISO/IEC 14496-15: at least one constraint byte must be present (use 'B0'-style default 0)
  s += constraints.length ? '.' + constraints.map((b) => b.toString(16).toUpperCase()).join('.') : '.0';
  return s;
}

/** 'hev1...' from an H.265 SPS NAL (type 33) or VPS NAL (type 32), or null. */
export function hevcCodecFromParamSet(nal) {
  if (!nal || nal.length < 3) return null;
  const t = h265NalType(nal);
  const r = unescapeRbsp(nal, 32);
  // 2-byte NAL header
  if (t === 33) return hevcCodecFromPtl(r.subarray(3, 15));      // + 1 byte (vps_id, max_sub_layers, nesting)
  if (t === 32) return hevcCodecFromPtl(r.subarray(6, 18));      // + 4 bytes (vps fields + 0xffff)
  return null;
}

/**
 * Derive the codec string from an Annex-B config packet.
 * @param {'h264'|'h265'|'av1'} family
 * @param {Uint8Array} config
 * @returns {string} codec string (falls back to a safe default)
 */
export function codecStringFromConfig(family, config) {
  if (family === 'h264') {
    for (const nal of splitAnnexB(config)) {
      if (h264NalType(nal) === 7) return avcCodecFromSps(nal) || DEFAULT_H264;
    }
    return DEFAULT_H264;
  }
  if (family === 'h265') {
    const nals = splitAnnexB(config);
    const sps = nals.find((n) => h265NalType(n) === 33);
    const vps = nals.find((n) => h265NalType(n) === 32);
    return (sps && hevcCodecFromParamSet(sps)) || (vps && hevcCodecFromParamSet(vps)) || DEFAULT_H265;
  }
  if (family === 'av1') return DEFAULT_AV1;
  return DEFAULT_H264;
}

/** Guess the codec family from an Annex-B config packet (used if the session info is missing). */
export function guessFamily(config) {
  const nals = splitAnnexB(config);
  if (nals.some((n) => h264NalType(n) === 7)) return 'h264';
  if (nals.some((n) => { const t = h265NalType(n); return t === 32 || t === 33; })) return 'h265';
  return null;
}
