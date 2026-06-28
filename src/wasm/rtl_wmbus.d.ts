// Type declarations for the Emscripten-generated rtl_wmbus.js (SINGLE_FILE, ES6
// MODULARIZE). Built by native/build-rtl-wmbus.sh.

export interface RtlWmbusModule {
  /** Initializes options and resets the demodulator state. Call once. */
  _rtlwmbus_init(): void;
  /** Runs `len` bytes of interleaved cu8 samples through the demodulator. */
  _rtlwmbus_feed(ptr: number, len: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  /** Direct view of the WASM heap (bytes). */
  HEAPU8: Uint8Array;
  ccall: (...args: unknown[]) => unknown;
  cwrap: (...args: unknown[]) => (...args: unknown[]) => unknown;
}

export interface RtlWmbusModuleOptions {
  /** Called once per line written to stdout (one telegram per line). */
  print?: (line: string) => void;
  /** Called once per line written to stderr. */
  printErr?: (line: string) => void;
}

declare const createRtlWmbus: (
  options?: RtlWmbusModuleOptions,
) => Promise<RtlWmbusModule>;

export default createRtlWmbus;
