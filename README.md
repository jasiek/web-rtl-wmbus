# web-rtl-wmbus

A **static web app** that turns an RTL-SDR dongle into a wireless M-Bus (wM-Bus)
meter receiver — entirely in the browser. No server, no native install, nothing
leaves your machine.

It connects to an RTL-SDR over **WebUSB**, continuously tunes **868.95 MHz** (the
EU T1/C1 wM-Bus band), demodulates telegrams, and decodes/decrypts nearby utility
meters — trying an all-zero AES key (`0x0`) on encrypted ones.

```
RTL-SDR ──WebUSB──> webrtlsdr            [cu8 @ 1.6 Msps]
   └─> rtl-wmbus (WASM, Web Worker)  ──> telegram hex + RSSI/mode
        └─> wmbusmeters (WASM)        ──> decoded / decrypted meter (JSON)
             └─> live meter + telegram tables (UI)
```

The whole signal chain — software-defined radio, FSK demodulation and meter
decoding — runs client-side. The two C/C++ projects (`rtl-wmbus`, `wmbusmeters`)
are compiled to WebAssembly; the RTL-SDR USB driver is pure TypeScript.

## Quick start

```sh
npm install
npm run dev      # http://localhost:5173  (localhost satisfies WebUSB)
```

Open the URL in **Chrome / Edge / Opera**, pick a **band / mode** from the
dropdown (it shows the countries where each band is typical as flags), plug in
your RTL-SDR, and click **Connect RTL-SDR**. WebUSB will prompt you to choose the
device (this requires a user gesture, so it must be triggered by the button).
Once connected the app streams IQ samples and populates two live tables:

- **Meters** — one row per meter id, with media, driver, decoded reading, and a
  status badge (`decoded`, `decrypted (0x0)`, `recognized`, `encrypted`).
- **Telegrams** — the raw demodulated frames (mode, CRC, RSSI, hex).

### Bands / modes

| Preset | Tuning | Typical in |
|--------|--------|-----------|
| **868.950 MHz — T1 / C1** (default) | 1.6 Msps | most of Europe (DE, AT, NL, BE, CH, CZ, PL, DK, SE, NO, FI, UK) |
| **868.300 MHz — S1** | 1.6 Msps | Europe (stationary deployments) |
| **868.625 MHz — S1 + T1 + C1** | 2.4 Msps | Europe (catches all 868 modes at once, via rtl-wmbus `-s`) |
| 169.400 MHz — N / Wize | — | France, Italy (gas), Spain, Portugal — *demod not supported yet* |
| 433.820 MHz — F | — | markets where 868 MHz is unavailable — *demod not supported yet* |

Only the 868 MHz modes (S/T/C) are demodulated; the 169 MHz and 433 MHz presets
are listed for reference and are disabled in the UI.

## Requirements

- A **Chromium-based browser** (Chrome, Edge, Opera). WebUSB is **not** available
  in Firefox or Safari.
- The page must be served over **HTTPS or `localhost`** (a WebUSB requirement).
- An **RTL-SDR** dongle (RTL2832U + R820T/R828D, e.g. RTL-SDR Blog V3/V4).
- OS driver notes:
  - **Windows** — install the WinUSB driver for the dongle (e.g. via Zadig).
  - **Linux** — make sure the kernel `dvb_usb_rtl28xxu` module is not claiming
    the device (blacklist it, or unbind it before use).
  - **macOS** — works out of the box.

## How it works

| Stage | Component | Notes |
|-------|-----------|-------|
| USB + tuning | [`@jtarrio/webrtlsdr`](https://github.com/jtarrio/webrtlsdr) | TypeScript RTL2832U/R820T driver. `readSamples()` returns raw **cu8** — exactly what the demodulator wants, no conversion. |
| Demodulation | [`rtl-wmbus`](https://github.com/xaelsouth/rtl-wmbus) → WASM | A thin C shim (`native/shim.c`) reuses rtl-wmbus's DSP chain as `rtlwmbus_init()` / `rtlwmbus_feed()`. Emits telegram lines. |
| Decode + decrypt | [`wmbusmeters`](https://github.com/wmbusmeters/wmbusmeters) → WASM | Reuses wmbusmeters' upstream `browser/` Emscripten binding (`wm_main`), re-linked as an ES module. AES decryption runs in WASM. |

WebUSB only works on the main thread, so the SDR read loop lives there and
transfers IQ buffers to a **Web Worker** that runs both WASM modules. This keeps
the UI responsive while demodulation and decoding happen off-thread.

### Decryption strategy (key `0x0`)

wmbusmeters rejects an *unencrypted* telegram if you hand it a key, and it
permanently blacklists a meter id within a module instance after a failed
decrypt. To keep each decode independent, the worker runs every telegram in a
**fresh module instance** (reusing one compiled wasm for speed) and tries, in
order:

1. `NOKEY` — reads every unencrypted meter.
2. the all-zero key `00…00` — the "try to decrypt with `0x0`" attempt, used only
   if the plaintext attempt produced no values.

## Project structure

```
index.html              app shell + panels
src/
  main.ts               UI wiring, SDR ↔ worker glue
  sdr/device.ts         WebUSB RTL-SDR wrapper (tune 868.95 MHz @ 1.6 Msps)
  worker/dsp.ts         Web Worker: demod + decode queue
  worker/decoder.ts     wmbusmeters decode (NOKEY → 0x0 strategy)
  telegram.ts, meter.ts parsing of rtl-wmbus lines / wmbusmeters JSON
  ui/                   live meter + telegram tables
  wasm/                 committed WASM artifacts (.js + .wasm + .d.ts)
native/
  shim.c                rtl-wmbus → WASM shim
  build-*.sh, setup.sh  Emscripten build scripts
  test-*.mjs            offline tests
```

## Scripts

```sh
npm run dev          # Vite dev server (localhost)
npm run build        # typecheck + static bundle in dist/
npm run preview      # serve the built bundle
npm run test:wasm    # offline tests (no hardware needed)
npm run setup:wasm   # clone rtl-wmbus, wmbusmeters, emsdk into native/
npm run build:wasm   # recompile both WASM modules into src/wasm/
```

## Tests (offline, no hardware)

```sh
npm run test:wasm
```

- `native/test-rtl-wmbus.mjs` — demodulates a bundled `.cu8` sample to telegrams.
- `native/test-wmbusmeters.mjs` — asserts plaintext decode, AES decrypt with a
  real key, and graceful failure of the `0x0` attempt.
- `native/test-pipeline.mjs` — full chain: samples → telegrams → meters.

## Rebuilding the WASM modules

The compiled `.wasm` artifacts are **committed** under `src/wasm/`, so normal app
development does not need a C/C++ toolchain. To regenerate them you need
[Emscripten](https://emscripten.org/):

```sh
npm run setup:wasm   # clones rtl-wmbus, wmbusmeters, emsdk into native/
npm run build:wasm   # compiles both to src/wasm/
```

The wmbusmeters build reuses its upstream `browser/` Emscripten build (which also
compiles libxml2). On **macOS** that upstream script needs two GNU tools on
`PATH` that aren't present by default — provide shims before `build:wasm`:

```sh
# nproc (GNU) and libtoolize (GNU libtool)
printf '#!/bin/sh\nsysctl -n hw.ncpu\n' > /usr/local/bin/nproc && chmod +x /usr/local/bin/nproc
ln -s "$(which glibtoolize)" /usr/local/bin/libtoolize   # from `brew install libtool` / MacPorts
```

## Licenses & credits

- [`@jtarrio/webrtlsdr`](https://github.com/jtarrio/webrtlsdr) — Apache-2.0.
- [`rtl-wmbus`](https://github.com/xaelsouth/rtl-wmbus) — GPL.
- [`wmbusmeters`](https://github.com/wmbusmeters/wmbusmeters) — GPL.

Because the bundled WASM is built from GPL sources, distributions of this app
that include those modules are derived works under the GPL. Keep the upstream
license notices and provide the corresponding sources. See each upstream project
for its exact terms.
