// Offline test: feeds a bundled .cu8 sample file through the rtl-wmbus WASM
// module and prints the telegrams it demodulates. Deterministic, no hardware.
//
//   node native/test-rtl-wmbus.mjs [path-to.cu8]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const samplePath =
  process.argv[2] ??
  join(here, "rtl-wmbus", "samples", "rtlsdr_868.950M_1M6_samples2.cu8");

const { default: createRtlWmbus } = await import(
  join(here, "..", "src", "wasm", "rtl_wmbus.js")
);

const telegrams = [];
const Module = await createRtlWmbus({
  print: (line) => telegrams.push(line),
  printErr: (line) => console.error("[stderr]", line),
});

Module._rtlwmbus_init();

const samples = readFileSync(samplePath);
console.log(`Feeding ${samples.length} bytes from ${samplePath}`);

// Feed in blocks, like the streaming pipeline does.
const BLOCK = 1 << 17; // 128 KiB
const ptr = Module._malloc(BLOCK);
for (let off = 0; off < samples.length; off += BLOCK) {
  const chunk = samples.subarray(off, Math.min(off + BLOCK, samples.length));
  Module.HEAPU8.set(chunk, ptr);
  Module._rtlwmbus_feed(ptr, chunk.length);
}
Module._free(ptr);

console.log(`\n${telegrams.length} telegram line(s):`);
for (const t of telegrams) console.log("  " + t);

const crcOk = telegrams.filter((t) => t.split(";")[1] === "1").length;
console.log(`\nCRC OK: ${crcOk} / ${telegrams.length}`);
process.exit(telegrams.length > 0 ? 0 : 1);
