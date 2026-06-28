// Shared mode-N test modulator: turns a cooked wM-Bus telegram into mode-N
// GFSK IQ (cu8), matching the demodulator's PHY constants. Used by the node
// round-trip test and the in-browser worker test. Run under tsx (imports TS).
import { frameFormatA } from "../src/dsp/wmbus-frame.ts";
import { N_SAMPLE_RATE, N_BITRATE } from "../src/dsp/nmode.ts";

// Must match the (private) constants in nmode.ts.
export const SYNC_WORD = 0x7696;
export const DEVIATION = 1680;
const AMP = 0.9;

/** Build the on-air bit sequence: preamble + sync + framed bytes (MSB-first). */
export function buildBits(cooked) {
  const bits = [];
  for (let i = 0; i < 48; i++) bits.push(i % 2 === 0 ? 1 : 0); // alternating, ends 0xAA
  for (let b = 15; b >= 0; b--) bits.push((SYNC_WORD >> b) & 1); // sync, MSB-first
  for (const byte of frameFormatA(cooked)) {
    for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1);
  }
  return bits;
}

/** GFSK-modulate bits onto a channel offset, returning a cu8 ArrayBuffer. */
export function modulate(bits, offsetHz) {
  const fs = N_SAMPLE_RATE;
  const sps = fs / N_BITRATE;
  const settle = 400;
  const total = settle + Math.ceil(bits.length * sps) + settle;
  const out = new Uint8Array(total * 2);
  let phase = 0;
  let n = 0;
  const emit = (instFreq) => {
    phase += (2 * Math.PI * instFreq) / fs;
    out[n * 2] = clampU8(Math.cos(phase) * AMP * 127 + 127.5);
    out[n * 2 + 1] = clampU8(Math.sin(phase) * AMP * 127 + 127.5);
    n++;
  };
  for (let s = 0; s < settle; s++) emit(offsetHz);
  let acc = 0;
  for (const bit of bits) {
    const f = offsetHz + (bit ? DEVIATION : -DEVIATION);
    acc += sps;
    while (acc >= 1) {
      emit(f);
      acc -= 1;
    }
  }
  while (n < total) emit(offsetHz);
  return out.buffer;
}

function clampU8(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Cooked telegram used across tests (decodes to a Lansen counter). */
export const COOKED_HEX =
  "234433300602010014007a8e0000002f2f0efd3a1147000000008e40fd3a341200000000";
export const cookedBytes = () =>
  Uint8Array.from(COOKED_HEX.match(/../g).map((h) => parseInt(h, 16)));
