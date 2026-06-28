// Demodulator abstraction used by the DSP worker.
//
// Both bands turn a stream of cu8 IQ blocks into wM-Bus telegrams, but via very
// different paths: the 868 MHz S/T/C modes use the rtl-wmbus WASM module, while
// 169 MHz mode N uses the pure-TypeScript narrowband demodulator. This hides
// that behind one `feed()` so the worker can swap demodulators per band.

import createRtlWmbus from "../wasm/rtl_wmbus.js";
import { NModeReceiver } from "../dsp/nmode.ts";
import { parseTelegramLine, type Telegram } from "../telegram.ts";
import type { DemodParams } from "./protocol.ts";

export interface Demodulator {
  /** Process a block of interleaved cu8 IQ samples. */
  feed(data: ArrayBuffer): void;
}

/**
 * Creates the demodulator for the given band. Recovered telegrams are passed to
 * `onTelegram`; demodulator stderr (rtl-wmbus only) to `onStderr`.
 */
export async function createDemodulator(
  params: DemodParams,
  onTelegram: (t: Telegram) => void,
  onStderr: (line: string) => void,
): Promise<Demodulator> {
  if (params.kind === "nmode169") {
    const rx = new NModeReceiver(
      onTelegram,
      params.sampleRate,
      params.offsetsHz,
      params.centerHz,
    );
    return { feed: (data) => rx.feed(data) };
  }

  // 868 MHz: rtl-wmbus WASM. The reception frequency follows from the mode: in
  // simultaneous mode S1 sits at 868.30 MHz and T1/C1 at 868.95 MHz; otherwise
  // everything arrives at the single tuned center.
  const freqForMode = (mode: string): number => {
    if (!params.simultaneous) return params.centerHz;
    return mode === "S1" ? 868_300_000 : 868_950_000;
  };
  const mod = await createRtlWmbus({
    print: (line) => {
      const t = parseTelegramLine(line);
      if (t) {
        t.frequencyHz = freqForMode(t.mode);
        onTelegram(t);
      }
    },
    printErr: onStderr,
  });
  mod._rtlwmbus_init(params.decimation, params.simultaneous ? 1 : 0);

  let ptr = 0;
  let capacity = 0;
  return {
    feed: (data) => {
      const bytes = new Uint8Array(data);
      if (bytes.length > capacity) {
        if (ptr) mod._free(ptr);
        ptr = mod._malloc(bytes.length);
        capacity = bytes.length;
      }
      mod.HEAPU8.set(bytes, ptr);
      mod._rtlwmbus_feed(ptr, bytes.length);
    },
  };
}
