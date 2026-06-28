/// <reference lib="webworker" />
//
// DSP worker: loads the rtl-wmbus WASM demodulator and runs the continuous
// sample stream through it, off the main thread. Each demodulated telegram line
// is parsed and posted back to the main thread.
//
// WebUSB lives on the main thread (it is unavailable in workers), so the main
// thread captures cu8 sample blocks and transfers their ArrayBuffers here.

import createRtlWmbus, {
  type RtlWmbusModule,
} from "../wasm/rtl_wmbus.js";
import { parseTelegramLine, type Telegram } from "../telegram.ts";
import { decodeTelegram } from "./decoder.ts";
import type { DemodParams, FromWorker, ToWorker } from "./protocol.ts";

let mod: RtlWmbusModule | undefined;
let heapPtr = 0;
let heapCapacity = 0;

function post(msg: FromWorker): void {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}

// Telegram decode queue. Demodulation is synchronous and bursty (the same
// telegram is often reported twice by two algorithms), while decoding is async
// and relatively heavy. We dedupe recent telegrams and decode them one at a
// time so the wmbusmeters instances don't pile up.
const decodeQueue: Telegram[] = [];
let decoding = false;
const recentHex = new Map<string, number>(); // hex -> timestamp
const DEDUPE_MS = 3000;

function enqueueForDecode(t: Telegram): void {
  const now = Date.now();
  // Drop telegrams we decoded very recently (duplicate algorithm output).
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

async function init(params: DemodParams): Promise<void> {
  mod = await createRtlWmbus({
    print: (line) => {
      const telegram = parseTelegramLine(line);
      if (telegram) {
        post({ type: "telegram", telegram });
        // Only attempt to decode telegrams that passed the CRC check.
        if (telegram.crcOk) enqueueForDecode(telegram);
      }
    },
    printErr: (line) => post({ type: "stderr", line }),
  });
  mod._rtlwmbus_init(params.decimation, params.simultaneous ? 1 : 0);
  post({ type: "ready" });
}

/** Ensures the scratch buffer in WASM memory is at least `size` bytes. */
function ensureHeap(size: number): number {
  if (!mod) throw new Error("WASM module not initialized");
  if (size > heapCapacity) {
    if (heapPtr) mod._free(heapPtr);
    heapPtr = mod._malloc(size);
    heapCapacity = size;
  }
  return heapPtr;
}

function feed(data: ArrayBuffer): void {
  if (!mod) return;
  const bytes = new Uint8Array(data);
  const ptr = ensureHeap(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  mod._rtlwmbus_feed(ptr, bytes.length);
}

self.addEventListener("message", (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "init":
        void init(msg.params);
        break;
      case "samples":
        feed(msg.data);
        break;
      case "reset":
        mod?._rtlwmbus_init(msg.params.decimation, msg.params.simultaneous ? 1 : 0);
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
