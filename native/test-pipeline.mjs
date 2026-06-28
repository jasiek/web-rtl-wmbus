// End-to-end offline test of the full pipeline, mirroring the DSP worker:
//   .cu8 samples -> rtl-wmbus (WASM) -> telegrams -> wmbusmeters (WASM) -> meters
// Deterministic, no hardware. Run: node native/test-pipeline.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const WASM = join(here, "..", "src", "wasm");

// 1. Demodulate the bundled sample into telegrams.
const { default: createRtlWmbus } = await import(join(WASM, "rtl_wmbus.js"));
const lines = [];
const rwm = await createRtlWmbus({ print: (l) => lines.push(l), printErr: () => {} });
rwm._rtlwmbus_init();
const samples = readFileSync(
  join(here, "rtl-wmbus", "samples", "rtlsdr_868.950M_1M6_samples2.cu8"),
);
const ptr = rwm._malloc(samples.length);
rwm.HEAPU8.set(samples, ptr);
rwm._rtlwmbus_feed(ptr, samples.length);
rwm._free(ptr);

const telegrams = lines
  .map((l) => l.split(";"))
  .filter((p) => p[1] === "1") // CRC OK
  .map((p) => ({ mode: p[0], serial: p[6], hex: p[7].replace(/^0x/, "") }));
const uniqueHex = [...new Set(telegrams.map((t) => t.hex))];
console.log(`Demodulated ${telegrams.length} CRC-OK telegrams (${uniqueHex.length} unique).`);

// 2. Decode each unique telegram (NOKEY, then zero key), like the worker does.
const { default: createWMBusMeters } = await import(join(WASM, "wmbusmeters.js"));
const wasmBytes = readFileSync(join(WASM, "wmbusmeters.wasm"));
const compiled = await WebAssembly.compile(wasmBytes);

async function decodeOnce(hex, key) {
  const out = [];
  const M = await createWMBusMeters({
    print: (l) => out.push(l),
    printErr: () => {},
    instantiateWasm: (imports, ok) => {
      WebAssembly.instantiate(compiled, imports).then(ok);
      return {};
    },
  });
  M.ccall("wm_main", "number", ["string"], [`--format=json ${hex} scan auto * ${key}`]);
  const j = out.find((l) => l.trimStart().startsWith("{"));
  return j ? JSON.parse(j) : null;
}

const META = new Set(["_", "media", "meter", "name", "id", "timestamp"]);
const hasValues = (o) => o && Object.keys(o).some((k) => !META.has(k));

for (const hex of uniqueHex) {
  let json = await decodeOnce(hex, "NOKEY");
  let status = hasValues(json) ? "decoded" : null;
  if (!status) {
    const z = await decodeOnce(hex, "0".repeat(32));
    if (hasValues(z)) { json = z; status = "decoded_zero_key"; }
  }
  if (!status) status = json ? "recognized" : "encrypted/undecoded";
  console.log(`\n[${status}] ${hex.slice(0, 24)}…`);
  if (json) console.log("  " + JSON.stringify(json));
}
