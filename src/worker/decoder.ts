// wmbusmeters decoder, used inside the DSP worker.
//
// wmbusmeters accumulates per-meter state (notably it *permanently ignores* a
// meter id after a failed decryption/parse). To keep every telegram decode
// independent we run each attempt in a *fresh* module instance. To make that
// cheap we compile the wasm exactly once and reuse the compiled module for each
// instance via Emscripten's `instantiateWasm` hook.

import createWMBusMeters, {
  type WMBusMetersModule,
} from "../wasm/wmbusmeters.js";
import { parseMeterJson, type MeterReading } from "../meter.ts";

/** All-zero AES key (the "0x0" key we try on encrypted telegrams). */
const ZERO_KEY = "00000000000000000000000000000000";

export type DecodeStatus =
  | "decoded" // unencrypted, decoded with NOKEY
  | "decoded_zero_key" // encrypted, decrypted with the 0x0 key
  | "recognized" // telegram parsed but no driver / no values
  | "encrypted" // encrypted and not decryptable with 0x0
  | "undecoded"; // nothing usable came back

export type DecodeResult = {
  status: DecodeStatus;
  reading: MeterReading | null;
  stderr: string[];
};

let compiledPromise: Promise<WebAssembly.Module> | undefined;

function compiledModule(): Promise<WebAssembly.Module> {
  if (!compiledPromise) {
    const url = new URL("../wasm/wmbusmeters.wasm", import.meta.url);
    compiledPromise = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => WebAssembly.compile(buf));
  }
  return compiledPromise;
}

async function freshInstance(
  onOut: (line: string) => void,
  onErr: (line: string) => void,
): Promise<WMBusMetersModule> {
  const compiled = await compiledModule();
  return createWMBusMeters({
    print: onOut,
    printErr: onErr,
    instantiateWasm: (imports, success) => {
      WebAssembly.instantiate(compiled, imports).then((instance) =>
        success(instance),
      );
      return {};
    },
  });
}

/** Runs one decode attempt in a fresh instance. Returns the JSON object + stderr. */
async function attempt(
  hex: string,
  key: string,
): Promise<{ json: Record<string, unknown> | null; stderr: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const mod = await freshInstance(
    (l) => out.push(l),
    (l) => err.push(l),
  );
  mod.ccall(
    "wm_main",
    "number",
    ["string"],
    [`--format=json ${hex} scan auto * ${key}`],
  );
  const jsonLine = out.find((l) => l.trimStart().startsWith("{"));
  let json: Record<string, unknown> | null = null;
  if (jsonLine) {
    try {
      json = JSON.parse(jsonLine);
    } catch {
      json = null;
    }
  }
  return { json, stderr: err };
}

/** Number of fields beyond the always-present metadata = decoded measurements. */
const META_KEYS = new Set(["_", "media", "meter", "name", "id", "timestamp"]);
function hasValues(json: Record<string, unknown>): boolean {
  return Object.keys(json).some((k) => !META_KEYS.has(k));
}

/**
 * Decodes a telegram: first as plaintext (NOKEY), then — if that yields no
 * values — retries with the all-zero key to attempt decryption.
 */
export async function decodeTelegram(hex: string): Promise<DecodeResult> {
  // 1. Plaintext attempt.
  const plain = await attempt(hex, "NOKEY");
  if (plain.json && hasValues(plain.json)) {
    return {
      status: "decoded",
      reading: parseMeterJson(JSON.stringify(plain.json)),
      stderr: plain.stderr,
    };
  }

  // 2. Zero-key decryption attempt.
  const zero = await attempt(hex, ZERO_KEY);
  if (zero.json && hasValues(zero.json)) {
    return {
      status: "decoded_zero_key",
      reading: parseMeterJson(JSON.stringify(zero.json)),
      stderr: zero.stderr,
    };
  }

  // Neither produced values. Classify what we did learn.
  const macFailed = [...plain.stderr, ...zero.stderr].some((l) =>
    /mac check failed|should have been encrypted/i.test(l),
  );
  if (plain.json) {
    // Telegram recognized (id/media present) but no driver/values.
    return {
      status: macFailed ? "encrypted" : "recognized",
      reading: parseMeterJson(JSON.stringify(plain.json)),
      stderr: [...plain.stderr, ...zero.stderr],
    };
  }
  return {
    status: macFailed ? "encrypted" : "undecoded",
    reading: null,
    stderr: [...plain.stderr, ...zero.stderr],
  };
}
