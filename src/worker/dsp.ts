/// <reference lib="webworker" />
//
// DSP worker: owns the active demodulator (rtl-wmbus WASM for 868 MHz, or the
// TypeScript mode-N receiver for 169 MHz) and the telegram decode pipeline,
// off the main thread.
//
// WebUSB lives on the main thread (it is unavailable in workers), so the main
// thread captures cu8 sample blocks and transfers their ArrayBuffers here.

import { decodeTelegram } from "./decoder.ts";
import { createDemodulator, type Demodulator } from "./demodulator.ts";
import type { Telegram } from "../telegram.ts";
import type { DemodParams, FromWorker, ToWorker } from "./protocol.ts";

let demod: Demodulator | undefined;

function post(msg: FromWorker): void {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}

// Telegram decode queue. Demodulation is bursty (the same telegram is often
// reported more than once), while decoding is async and relatively heavy. We
// dedupe recent telegrams and decode them one at a time.
const decodeQueue: Telegram[] = [];
let decoding = false;
const recentHex = new Map<string, number>(); // hex -> timestamp
const DEDUPE_MS = 3000;

function handleTelegram(t: Telegram): void {
  post({ type: "telegram", telegram: t });
  if (t.crcOk) enqueueForDecode(t);
}

function enqueueForDecode(t: Telegram): void {
  const now = Date.now();
  for (const [hex, ts] of recentHex) {
    if (now - ts > DEDUPE_MS) recentHex.delete(hex);
  }
  if (recentHex.has(t.hex)) return;
  recentHex.set(t.hex, now);
  decodeQueue.push(t);
  void drainQueue();
}

async function drainQueue(): Promise<void> {
  if (decoding) return;
  decoding = true;
  try {
    while (decodeQueue.length > 0) {
      const t = decodeQueue.shift()!;
      try {
        const result = await decodeTelegram(t.hex);
        post({
          type: "meter",
          result: {
            serial: t.serial,
            mode: t.mode,
            frequencyHz: t.frequencyHz,
            status: result.status,
            reading: result.reading,
          },
        });
      } catch (err) {
        post({
          type: "error",
          message: `decode failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  } finally {
    decoding = false;
  }
}

async function setup(params: DemodParams): Promise<void> {
  demod = await createDemodulator(
    params,
    handleTelegram,
    (line) => post({ type: "stderr", line }),
  );
  post({ type: "ready" });
}

self.addEventListener("message", (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "init":
      case "reset":
        void setup(msg.params);
        break;
      case "samples":
        demod?.feed(msg.data);
        break;
    }
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
