import "./style.css";
import {
  WmbusSdr,
  averageSignalLevel,
  WMBUS_CENTER_HZ,
} from "./sdr/device.ts";
import { TelegramTable } from "./ui/telegram-table.ts";
import { MeterTable } from "./ui/meter-table.ts";
import type { FromWorker, ToWorker } from "./worker/protocol.ts";

type StatusState = "idle" | "connecting" | "running" | "error";

const els = {
  connectBtn: byId<HTMLButtonElement>("connect-btn"),
  stopBtn: byId<HTMLButtonElement>("stop-btn"),
  status: byId<HTMLSpanElement>("status"),
  statFreq: byId<HTMLSpanElement>("stat-freq"),
  statRate: byId<HTMLSpanElement>("stat-rate"),
  statThroughput: byId<HTMLSpanElement>("stat-throughput"),
  statSignal: byId<HTMLSpanElement>("stat-signal"),
  signalFill: byId<HTMLDivElement>("signal-fill"),
  telegramTbody: byId<HTMLElement>("telegram-tbody"),
  telegramCounter: byId<HTMLElement>("telegram-counter"),
  meterTbody: byId<HTMLElement>("meter-tbody"),
  meterCounter: byId<HTMLElement>("meter-counter"),
  log: byId<HTMLPreElement>("log"),
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function setStatus(state: StatusState, text: string): void {
  els.status.dataset.state = state;
  els.status.textContent = text;
}

function log(message: string): void {
  const ts = new Date().toLocaleTimeString();
  els.log.textContent += `[${ts}] ${message}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

const sdr = new WmbusSdr();
const telegramTable = new TelegramTable(els.telegramTbody, els.telegramCounter);
const meterTable = new MeterTable(els.meterTbody, els.meterCounter);

// DSP worker: runs the rtl-wmbus WASM demodulator off the main thread.
const worker = new Worker(new URL("./worker/dsp.ts", import.meta.url), {
  type: "module",
});
let workerReady = false;

// Dev-only: expose the worker so the headless smoke test can feed it sample IQ
// data directly (the WebUSB path needs real hardware).
if (import.meta.env.DEV) {
  (globalThis as unknown as { __dspWorker?: Worker }).__dspWorker = worker;
}

worker.addEventListener("message", (ev: MessageEvent<FromWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "ready":
      workerReady = true;
      log("Demodulator (rtl-wmbus WASM) ready.");
      break;
    case "telegram":
      telegramTable.add(msg.telegram);
      break;
    case "meter":
      meterTable.add(msg.result);
      if (msg.result.reading) {
        log(
          `Meter ${msg.result.reading.id} (${msg.result.reading.meter ?? "?"}) — ${msg.result.status}.`,
        );
      }
      break;
    case "stderr":
      log(`[demod] ${msg.line}`);
      break;
    case "error":
      log(`Demodulator error: ${msg.message}`);
      break;
  }
});

function toWorker(msg: ToWorker, transfer?: Transferable[]): void {
  worker.postMessage(msg, transfer ?? []);
}

// Initialize the demodulator up front so it is ready by the time we connect.
toWorker({ type: "init" });

// Throughput / signal accounting, sampled once a second.
let bytesSinceTick = 0;
let levelAccum = 0;
let levelCount = 0;

function onSamples(block: { data: ArrayBuffer; frequency: number }): void {
  bytesSinceTick += block.data.byteLength;
  // Read the signal level before transferring ownership of the buffer.
  levelAccum += averageSignalLevel(block.data);
  levelCount++;
  if (workerReady) {
    toWorker({ type: "samples", data: block.data }, [block.data]);
  }
}

setInterval(() => {
  if (!sdr.isRunning) return;
  const mbps = (bytesSinceTick * 8) / 1e6;
  els.statThroughput.textContent = `${mbps.toFixed(1)} Mbit/s`;
  bytesSinceTick = 0;

  if (levelCount > 0) {
    const level = levelAccum / levelCount;
    levelAccum = 0;
    levelCount = 0;
    els.statSignal.textContent = `${Math.round(level * 100)}%`;
    els.signalFill.style.width = `${Math.round(level * 100)}%`;
  }
}, 1000);

async function handleConnect(): Promise<void> {
  if (!("usb" in navigator)) {
    setStatus("error", "WebUSB unavailable");
    log("This browser does not support WebUSB. Use Chrome, Edge, or Opera.");
    return;
  }

  els.connectBtn.disabled = true;
  setStatus("connecting", "Connecting…");
  log("Requesting RTL-SDR device…");

  try {
    await sdr.connect();
    const rate = sdr.actualSampleRate;
    els.statRate.textContent = `${(rate / 1e6).toFixed(3)} Msps`;
    els.statFreq.textContent = `${(WMBUS_CENTER_HZ / 1e6).toFixed(3)} MHz`;
    log(`Connected. Tuned to 868.950 MHz at ${(rate / 1e6).toFixed(3)} Msps.`);

    toWorker({ type: "reset" });
    meterTable.reset();
    telegramTable.reset();
    sdr.start(onSamples);
    setStatus("running", "Receiving");
    els.stopBtn.disabled = false;
    log("Streaming IQ samples to the demodulator. Watching for meters…");
  } catch (err) {
    setStatus("error", "Error");
    els.connectBtn.disabled = false;
    const msg = err instanceof Error ? err.message : String(err);
    log(`Connection failed: ${msg}`);
  }
}

async function handleStop(): Promise<void> {
  els.stopBtn.disabled = true;
  log("Stopping…");
  try {
    await sdr.close();
  } catch (err) {
    log(`Error while closing: ${err instanceof Error ? err.message : err}`);
  }
  setStatus("idle", "Idle");
  els.connectBtn.disabled = false;
  els.statThroughput.textContent = "—";
  els.statSignal.textContent = "—";
  els.signalFill.style.width = "0%";
  log("Stopped.");
}

els.connectBtn.addEventListener("click", () => void handleConnect());
els.stopBtn.addEventListener("click", () => void handleStop());

window.addEventListener("beforeunload", () => void sdr.close());

log("Ready. Click “Connect RTL-SDR” to begin.");
