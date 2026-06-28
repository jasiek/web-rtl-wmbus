// Type declarations for the Emscripten-generated wmbusmeters.js (ES6
// MODULARIZE, separate .wasm). Built by native/build-wmbusmeters.sh.

export interface WMBusMetersModule {
  /** Runs the wmbusmeters CLI with the given command line; returns exit code. */
  ccall(
    name: "wm_main",
    returnType: "number",
    argTypes: ["string"],
    args: [string],
  ): number;
  ccall(name: "wm_version", returnType: "string", argTypes: [], args: []): string;
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
}

export interface WMBusMetersOptions {
  /** Called once per stdout line (decoded telegram JSON). */
  print?: (line: string) => void;
  /** Called once per stderr line (warnings, errors). */
  printErr?: (line: string) => void;
  /** Reuse a pre-compiled WebAssembly.Module for a fresh, fast instance. */
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    successCallback: (instance: WebAssembly.Instance) => void,
  ) => Record<string, never>;
}

declare const createWMBusMeters: (
  options?: WMBusMetersOptions,
) => Promise<WMBusMetersModule>;

export default createWMBusMeters;
