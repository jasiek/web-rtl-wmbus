/**
 * Wireless M-Bus mode N (169 MHz) physical-layer demodulator, in pure
 * TypeScript. Mode N is narrowband 2-GFSK with NRZ encoding at 2.4 kbps over
 * 12.5 kHz channels in 169.40–169.475 MHz — low enough rate to demodulate
 * comfortably in JavaScript inside the DSP worker.
 *
 * Pipeline, per channel:
 *   cu8 IQ ─NCO mix─> baseband ─decimating FIR─> ~25 kHz ─FM discriminator─>
 *   ─edge-triggered bit sync─> NRZ bits ─sync-word search─> Format A frame ─>
 *   CRC check + cook ─> telegram
 *
 * The decode/decrypt stage (wmbusmeters) is mode-independent, so a recovered
 * mode-N telegram flows through the existing pipeline unchanged.
 *
 * IMPORTANT — values marked "VERIFY" below (sync word, bit order, polarity)
 * are best-effort from the EN 13757-4 / Wize descriptions and have NOT been
 * confirmed against a real 169 MHz capture. They are centralized here and the
 * demodulator tries both polarities, so closing the gap is a one-place change
 * once a capture is available. The DSP chain itself is validated by the
 * synthetic round-trip test (native/test-nmode.mjs).
 */

import {
  deframeFormatA,
  linkLayerId,
  toHex,
} from "./wmbus-frame.ts";
import type { Telegram } from "../telegram.ts";

/** Default SDR sample rate for mode N (covers the 75 kHz band). */
export const N_SAMPLE_RATE = 300_000;
/** Center frequency to tune the SDR to (middle of 169.400–169.475 MHz). */
export const N_CENTER_HZ = 169_437_500;
/** Uplink channel offsets from the band center, in Hz (12.5 kHz spacing). */
export const N_CHANNEL_OFFSETS_HZ = [
  -31_250, -18_750, -6_250, 6_250, 18_750, 31_250,
];
/** Symbol/bit rate of the narrowband mode-N channels. */
export const N_BITRATE = 2_400;

/** Decimation from the SDR rate down to the per-channel processing rate. */
const DECIM = 12; // 300 kHz -> 25 kHz
/**
 * Channel low-pass cutoff before decimation (Hz). Must pass the ~±2.9 kHz
 * occupied bandwidth while rejecting the neighbouring channel 12.5 kHz away.
 */
const LPF_CUTOFF_HZ = 3_200;
/**
 * FIR length for the channel filter. Long enough for a narrow transition at
 * 300 kHz so adjacent 12.5 kHz channels are rejected. Cost is modest: a
 * decimating FIR only evaluates at the (decimated) output rate.
 */
const FIR_TAPS = 161;

// VERIFY: 16-bit synchronization word that follows the chip preamble. The
// demodulator searches for this (and its bit-inverse, for unknown polarity).
const SYNC_WORD = 0x7696;
const SYNC_BITS = 16;
// Require a short alternating preamble immediately before the sync word to
// reduce false locks (0b1010... over 8 bits).
const PREAMBLE_TAIL = 0xaa;
const PREAMBLE_TAIL_BITS = 8;

/** Builds a Hamming-windowed low-pass FIR. */
function lowpassTaps(cutoffHz: number, sampleRate: number, n: number): Float32Array {
  const taps = new Float32Array(n);
  const fc = cutoffHz / sampleRate; // normalized
  const mid = (n - 1) / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)); // Hamming
    taps[i] = sinc * w;
    sum += taps[i];
  }
  for (let i = 0; i < n; i++) taps[i] /= sum; // unity DC gain
  return taps;
}

/**
 * Assembles NRZ bits into Format A frames. Searches for the sync word, then
 * reads the L-field to size the frame, collects it, verifies CRCs and emits the
 * cooked telegram. Tracks both polarities via two instances.
 */
class BitFramer {
  private history = 0; // rolling bit window (>= PREAMBLE+SYNC bits)
  private historyLen = 0;
  private collecting = false;
  private bits: number[] = [];
  private rawBytes: number[] = [];
  private frameLen = -1; // total raw bytes (incl. CRCs) once known

  constructor(private readonly emit: (cooked: Uint8Array) => void) {}

  reset(): void {
    this.history = 0;
    this.historyLen = 0;
    this.collecting = false;
    this.bits = [];
    this.rawBytes = [];
    this.frameLen = -1;
  }

  pushBit(bit: number): void {
    if (!this.collecting) {
      // Slide bit into the rolling window and test for preamble+sync.
      this.history = ((this.history << 1) | (bit & 1)) >>> 0;
      if (this.historyLen < 32) this.historyLen++;
      const window = PREAMBLE_TAIL_BITS + SYNC_BITS;
      if (this.historyLen >= window) {
        const got = this.history & ((1 << window) - 1);
        const expected = (PREAMBLE_TAIL << SYNC_BITS) | SYNC_WORD;
        if (got === (expected >>> 0)) {
          this.startFrame();
        }
      }
      return;
    }

    // Collecting frame bits (MSB-first into bytes). VERIFY: bit order.
    this.bits.push(bit);
    if (this.bits.length === 8) {
      let byte = 0;
      for (const b of this.bits) byte = (byte << 1) | b;
      this.bits = [];
      this.rawBytes.push(byte);

      if (this.rawBytes.length === 1) {
        // L-field known: derive total Format A raw length (user + CRCs).
        this.frameLen = formatARawLength(this.rawBytes[0]);
      }
      if (this.frameLen > 0 && this.rawBytes.length >= this.frameLen) {
        const result = deframeFormatA(Uint8Array.from(this.rawBytes));
        if (result.ok) this.emit(result.cooked);
        this.reset();
      } else if (this.rawBytes.length > 600) {
        this.reset(); // runaway guard
      }
    }
  }

  private startFrame(): void {
    this.collecting = true;
    this.bits = [];
    this.rawBytes = [];
    this.frameLen = -1;
  }
}

/** Total Format A raw byte count (user bytes + 2 CRC per block) for L. */
function formatARawLength(L: number): number {
  const userLen = L + 1;
  let remaining = userLen;
  let raw = 0;
  const first = Math.min(10, remaining);
  raw += first + 2;
  remaining -= first;
  while (remaining > 0) {
    const n = Math.min(16, remaining);
    raw += n + 2;
    remaining -= n;
  }
  return raw;
}

/** One channel: NCO down-conversion, decimating FIR, discriminator, bit sync. */
class ChannelDemod {
  private readonly taps: Float32Array;
  // NCO phasor (incremental rotation by -2π·offset/Fs per input sample).
  private readonly dco: number;
  private readonly dsi: number;
  private co = 1;
  private si = 0;
  // Decimating FIR ring buffers (mixed I/Q).
  private readonly bufI: Float32Array;
  private readonly bufQ: Float32Array;
  private pos = 0;
  private decimCount = 0;
  // Discriminator memory.
  private prevI = 0;
  private prevQ = 0;
  private havePrev = false;
  // Edge-triggered bit sync state.
  private readonly sps: number;
  private phase: number;
  private lastSign = 0;
  // Two framers: one per polarity.
  private readonly framerNormal: BitFramer;
  private readonly framerInverted: BitFramer;

  constructor(
    offsetHz: number,
    sampleRate: number,
    onTelegram: (cooked: Uint8Array) => void,
  ) {
    this.taps = lowpassTaps(LPF_CUTOFF_HZ, sampleRate, FIR_TAPS);
    const w = (-2 * Math.PI * offsetHz) / sampleRate;
    this.dco = Math.cos(w);
    this.dsi = Math.sin(w);
    this.bufI = new Float32Array(FIR_TAPS);
    this.bufQ = new Float32Array(FIR_TAPS);
    const channelRate = sampleRate / DECIM;
    this.sps = channelRate / N_BITRATE;
    this.phase = this.sps / 2;
    this.framerNormal = new BitFramer(onTelegram);
    this.framerInverted = new BitFramer(onTelegram);
  }

  reset(): void {
    this.co = 1;
    this.si = 0;
    this.pos = 0;
    this.decimCount = 0;
    this.havePrev = false;
    this.phase = this.sps / 2;
    this.lastSign = 0;
    this.framerNormal.reset();
    this.framerInverted.reset();
  }

  /** Push one raw IQ sample (already normalized to roughly [-1, 1]). */
  push(i: number, q: number): void {
    // NCO mix: (i + jq) * (co + jsi)
    const mi = i * this.co - q * this.si;
    const mq = i * this.si + q * this.co;
    // Advance phasor.
    const nco = this.co * this.dco - this.si * this.dsi;
    this.si = this.co * this.dsi + this.si * this.dco;
    this.co = nco;

    // Store into ring buffer.
    this.bufI[this.pos] = mi;
    this.bufQ[this.pos] = mq;
    this.pos = (this.pos + 1) % FIR_TAPS;

    if (++this.decimCount < DECIM) return;
    this.decimCount = 0;

    // Decimating FIR at this output instant.
    let accI = 0;
    let accQ = 0;
    let idx = this.pos;
    for (let k = 0; k < FIR_TAPS; k++) {
      idx = idx === 0 ? FIR_TAPS - 1 : idx - 1;
      const t = this.taps[k];
      accI += this.bufI[idx] * t;
      accQ += this.bufQ[idx] * t;
    }

    // FM discriminator: angle of conj(prev) * cur.
    if (!this.havePrev) {
      this.prevI = accI;
      this.prevQ = accQ;
      this.havePrev = true;
      return;
    }
    const dr = accI * this.prevI + accQ * this.prevQ;
    const di = accQ * this.prevI - accI * this.prevQ;
    this.prevI = accI;
    this.prevQ = accQ;
    const d = Math.atan2(di, dr);

    this.clockRecover(d);
  }

  /** Edge-triggered bit synchronizer: sample at mid-symbol, resync on edges. */
  private clockRecover(d: number): void {
    const sign = d >= 0 ? 1 : 0;
    if (this.lastSign !== (sign ? 1 : -1)) {
      // Transition: the ideal sampling instant is half a symbol later.
      if (this.lastSign !== 0) this.phase = this.sps / 2;
      this.lastSign = sign ? 1 : -1;
    }
    this.phase -= 1;
    if (this.phase <= 0) {
      this.phase += this.sps;
      this.framerNormal.pushBit(sign);
      this.framerInverted.pushBit(sign ^ 1);
    }
  }
}

/**
 * Mode-N receiver: runs one ChannelDemod per channel offset over the same IQ
 * stream and reports recovered telegrams.
 */
export class NModeReceiver {
  private readonly channels: ChannelDemod[];

  constructor(
    onTelegram: (telegram: Telegram) => void,
    sampleRate = N_SAMPLE_RATE,
    offsets = N_CHANNEL_OFFSETS_HZ,
    centerHz = N_CENTER_HZ,
  ) {
    // Each channel reports the frequency it actually demodulated on.
    const emitFor = (frequencyHz: number) => (cooked: Uint8Array) => {
      onTelegram({
        mode: "N",
        crcOk: true, // only emitted after all block CRCs pass
        threeOutOfSixOk: true,
        timestamp: new Date().toISOString(),
        packetRssi: 0,
        currentRssi: 0,
        serial: linkLayerId(cooked),
        hex: toHex(cooked),
        frequencyHz,
      });
    };
    this.channels = offsets.map(
      (off) => new ChannelDemod(off, sampleRate, emitFor(centerHz + off)),
    );
  }

  reset(): void {
    for (const c of this.channels) c.reset();
  }

  /** Feed a block of interleaved cu8 IQ samples. */
  feed(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    for (let k = 0; k + 1 < bytes.length; k += 2) {
      const i = (bytes[k] - 127.5) / 127.5;
      const q = (bytes[k + 1] - 127.5) / 127.5;
      for (const ch of this.channels) ch.push(i, q);
    }
  }
}
