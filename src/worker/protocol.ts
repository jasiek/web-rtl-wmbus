import type { Telegram } from "../telegram.ts";
import type { MeterReading } from "../meter.ts";
import type { DecodeStatus } from "./decoder.ts";

/** rtl-wmbus demodulator parameters derived from the selected band preset. */
export type DemodParams = {
  /** rtl-wmbus -d (sample rate = decimation * 800 kHz). */
  decimation: number;
  /** rtl-wmbus -s (receive S1 + T1/C1 together at 868.625 MHz). */
  simultaneous: boolean;
};

/** Messages sent from the main thread to the DSP worker. */
export type ToWorker =
  | { type: "init"; params: DemodParams }
  | { type: "samples"; data: ArrayBuffer }
  | { type: "reset"; params: DemodParams };

/** A decoded meter result for one telegram. */
export type MeterResult = {
  serial: string;
  mode: string;
  status: DecodeStatus;
  reading: MeterReading | null;
};

/** Messages sent from the DSP worker back to the main thread. */
export type FromWorker =
  | { type: "ready" }
  | { type: "telegram"; telegram: Telegram }
  | { type: "meter"; result: MeterResult }
  | { type: "stderr"; line: string }
  | { type: "error"; message: string };
