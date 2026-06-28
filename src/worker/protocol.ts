import type { Telegram } from "../telegram.ts";
import type { MeterReading } from "../meter.ts";
import type { DecodeStatus } from "./decoder.ts";

/** Messages sent from the main thread to the DSP worker. */
export type ToWorker =
  | { type: "init" }
  | { type: "samples"; data: ArrayBuffer }
  | { type: "reset" };

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
