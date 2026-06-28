// Round-trip test for the mode-N (169 MHz) demodulator.
//
// There is no real 169 MHz capture available, so we validate the DSP chain by
// modulating a known wM-Bus telegram into mode-N GFSK IQ ourselves and feeding
// it through the demodulator. This proves the channelizer, discriminator, bit
// sync, sync-word search, Format A deframing and CRC all work together — and
// that a recovered telegram still decodes via wmbusmeters. It does NOT prove
// the PHY constants (sync word/polarity/bit order) match real meters; that
// needs a real capture.
//
// Run: npx tsx native/test-nmode.mjs
import { NModeReceiver, N_CHANNEL_OFFSETS_HZ } from "../src/dsp/nmode.ts";
import { buildBits, modulate, COOKED_HEX, cookedBytes } from "./nmode-tx.mjs";

const cooked = cookedBytes();

let failures = 0;
function check(label, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) {
    failures++;
    if (detail) console.log("      " + detail);
  }
}

// Modulate on one real channel and demodulate across all channels.
const offset = N_CHANNEL_OFFSETS_HZ[3]; // +6250 Hz
const iq = modulate(buildBits(cooked), offset);

const received = [];
const rx = new NModeReceiver((t) => received.push(t));
rx.feed(iq);

// A clean synthetic signal can lock on more than one channel; the worker
// dedupes by hex within a short window, so the real criterion is one unique,
// correct telegram with no garbage detections.
const unique = [...new Set(received.map((t) => t.hex))];
check("at least one telegram recovered", received.length >= 1, `got ${received.length}`);
check("exactly one unique telegram", unique.length === 1, `unique: ${unique.length}`);
if (unique.length > 0) {
  check("telegram hex matches", unique[0] === COOKED_HEX, unique[0]);
  check("mode is N", received[0].mode === "N");
  check("serial extracted", received[0].serial === "00010206", received[0].serial);
}

// Decode the recovered telegram with wmbusmeters (mode-independent).
if (received[0]?.hex) {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const WASM = join(here, "..", "src", "wasm");
  const { default: createWMBusMeters } = await import(join(WASM, "wmbusmeters.js"));
  const compiled = await WebAssembly.compile(readFileSync(join(WASM, "wmbusmeters.wasm")));
  const out = [];
  const M = await createWMBusMeters({
    print: (l) => out.push(l),
    printErr: () => {},
    instantiateWasm: (imports, ok) => {
      WebAssembly.instantiate(compiled, imports).then(ok);
      return {};
    },
  });
  M.ccall("wm_main", "number", ["string"], [`--format=json ${received[0].hex} scan auto * NOKEY`]);
  const json = out.find((l) => l.trimStart().startsWith("{"));
  check("wmbusmeters decodes recovered telegram", json?.includes('"a_counter":4711'), json ?? "(none)");
}

console.log(`\n${failures === 0 ? "All N-mode checks passed." : failures + " check(s) failed."}`);
process.exit(failures === 0 ? 0 : 1);
