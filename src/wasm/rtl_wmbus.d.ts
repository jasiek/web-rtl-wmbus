// Type declarations for the Emscripten-generated rtl_wmbus.js (SINGLE_FILE, ES6
// MODULARIZE). Built by native/build-rtl-wmbus.sh.

export interface RtlWmbusModule {
  /**
   * Initializes options and resets the demodulator state.
   * @param decimationRate rtl-wmbus -d; sample rate = decimationRate * 800 kHz
   *   (2 => 1.6 Msps, 3 => 2.4 Msps).
   * @param simultaneous rtl-wmbus -s; 1 to receive S1 + T1/C1 together with the
   *   SDR tuned to 868.625 MHz, 0 for a single band at its own center.
   */
  _rtlwmbus_init(decimationRate: number, simultaneous: number): void;
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
