// Offline test of the wmbusmeters WASM decoder (the committed ES6 artifact).
// Validates plaintext decode, AES decryption with a real key, and that the
// all-zero "0x0" key attempt fails gracefully. Run: node native/test-wmbusmeters.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const WASM = join(here, "..", "src", "wasm");
const { default: createWMBusMeters } = await import(join(WASM, "wmbusmeters.js"));
const compiled = await WebAssembly.compile(readFileSync(join(WASM, "wmbusmeters.wasm")));

async function decode(hex, key) {
  const out = [];
  const err = [];
  const M = await createWMBusMeters({
    print: (l) => out.push(l),
    printErr: (l) => err.push(l),
    instantiateWasm: (imports, ok) => {
      WebAssembly.instantiate(compiled, imports).then(ok);
      return {};
    },
  });
  M.ccall("wm_main", "number", ["string"], [`--format=json ${hex} scan auto * ${key}`]);
  return { json: out.find((l) => l.trimStart().startsWith("{")) ?? null, err };
}

const UNENC =
  "234433300602010014007a8e0000002f2f0efd3a1147000000008e40fd3a341200000000";
const ENC =
  "C244C5140443054300048C200E900F002C25895E02003B0877D31DA840B17A0E009007100F8FAD4C4E61400DA4F3B1F7E273CC4C5C07F93CD20B237345DB39F9A98F8415E1C4B7A25C86E4C22D05C3352FA7E2E5627031F14643063F1DC8FE2C32459B6F02E4234B447B18E4BFDA8C4DA9B1EDE6CF29D0B2122A3E8B9DEEBEE3E6DBE6617B4E709EC6B595179CB01C2C0BDE6723A345B708652880C114A58DA07C73AD9EB8ACB17FA0A88F19BC84CB1FC56672DE8A9603FD0C05010002FD0B2111F60B";
const REAL = "622b9656991ff0c1574c0950cf9278d1";
const ZERO = "0".repeat(32);

let failures = 0;
function check(label, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) {
    failures++;
    if (detail) console.log("      " + detail);
  }
}

const unenc = await decode(UNENC, "NOKEY");
check("unencrypted decodes with NOKEY", unenc.json?.includes('"a_counter":4711'), unenc.json ?? "(no json)");

const real = await decode(ENC, REAL);
check("encrypted decrypts with real key", real.json?.includes('"total_kwh":9341'), real.json ?? "(no json)");

const zero = await decode(ENC, ZERO);
check(
  "encrypted + 0x0 key fails gracefully",
  zero.json === null && zero.err.some((l) => /mac check failed/i.test(l)),
  zero.json ?? zero.err.join(" | "),
);

console.log(`\n${failures === 0 ? "All checks passed." : failures + " check(s) failed."}`);
process.exit(failures === 0 ? 0 : 1);
