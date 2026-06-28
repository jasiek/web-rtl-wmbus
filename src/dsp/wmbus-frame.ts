/**
 * wM-Bus data-link-layer framing (EN 13757-4 Format A).
 *
 * The physical layer (mode N here) recovers a stream of bytes that form a
 * Format A frame: a first block of 10 user bytes + 2 CRC bytes, then 16-byte
 * blocks each followed by a 2-byte CRC (the last block may be shorter). The
 * CRC is the EN 13757 CRC-16.
 *
 * `deframeFormatA` verifies every block CRC and returns the "cooked" telegram
 * (all CRC bytes stripped, starting at the L-field) — the format wmbusmeters
 * expects, identical to what rtl-wmbus emits for the 868 modes.
 *
 * `frameFormatA` is the inverse, used by the round-trip test's modulator.
 */

const CRC_POLY = 0x3d65; // EN 13757 CRC-16 polynomial

/** EN 13757 CRC-16: poly 0x3D65, init 0x0000, MSB-first, final XOR 0xFFFF. */
export function crcEn13757(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0x0000;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ CRC_POLY) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return (~crc) & 0xffff;
}

/** Block layout of Format A: first block 10 user bytes, rest 16, each + 2 CRC. */
function blockUserSizes(userLen: number): number[] {
  const sizes: number[] = [];
  let remaining = userLen;
  const first = Math.min(10, remaining);
  sizes.push(first);
  remaining -= first;
  while (remaining > 0) {
    const n = Math.min(16, remaining);
    sizes.push(n);
    remaining -= n;
  }
  return sizes;
}

export type DeframeResult =
  | { ok: true; cooked: Uint8Array }
  | { ok: false; reason: string };

/**
 * Parses a Format A frame (user bytes interleaved with block CRCs) into the
 * cooked telegram. `raw` must begin at the L-field. Returns the stripped
 * telegram (L-field + payload, no CRCs) when all CRCs check out.
 */
export function deframeFormatA(raw: Uint8Array): DeframeResult {
  if (raw.length < 1) return { ok: false, reason: "empty" };
  const L = raw[0];
  const userLen = L + 1; // bytes including the L-field itself, excluding CRCs
  const sizes = blockUserSizes(userLen);

  const cooked = new Uint8Array(userLen);
  let rawPos = 0;
  let cookedPos = 0;
  for (const size of sizes) {
    if (rawPos + size + 2 > raw.length) {
      return { ok: false, reason: "truncated" };
    }
    const calc = crcEn13757(raw, rawPos, rawPos + size);
    const got = (raw[rawPos + size] << 8) | raw[rawPos + size + 1];
    if (calc !== got) {
      return { ok: false, reason: `crc mismatch in block (got ${hex16(got)}, want ${hex16(calc)})` };
    }
    cooked.set(raw.subarray(rawPos, rawPos + size), cookedPos);
    cookedPos += size;
    rawPos += size + 2;
  }
  return { ok: true, cooked };
}

/**
 * Builds a Format A frame (with block CRCs) from a cooked telegram. `cooked`
 * must start at the L-field. Inverse of `deframeFormatA`; used by tests.
 */
export function frameFormatA(cooked: Uint8Array): Uint8Array {
  const sizes = blockUserSizes(cooked.length);
  const out: number[] = [];
  let pos = 0;
  for (const size of sizes) {
    const block = cooked.subarray(pos, pos + size);
    const crc = crcEn13757(block);
    out.push(...block, (crc >> 8) & 0xff, crc & 0xff);
    pos += size;
  }
  return Uint8Array.from(out);
}

/** Extracts the 4-byte link-layer id (A-field, little-endian) as 8-hex. */
export function linkLayerId(cooked: Uint8Array): string {
  // Cooked layout: L(1) C(1) M(2) A(6 = id[4] ver[1] type[1]).
  if (cooked.length < 8) return "00000000";
  const id = cooked.subarray(4, 8); // little-endian id
  let s = "";
  for (let i = 3; i >= 0; i--) s += id[i].toString(16).padStart(2, "0");
  return s;
}

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function hex16(v: number): string {
  return "0x" + v.toString(16).padStart(4, "0");
}
