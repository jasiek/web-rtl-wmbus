import { RTL2832U_Provider, type RtlDevice } from "@jtarrio/webrtlsdr/rtlsdr";

/** Wireless M-Bus T1/C1 center frequency in the EU 868 MHz band. */
export const WMBUS_CENTER_HZ = 868_950_000;

/**
 * Sample rate fed to rtl-wmbus. It expects cu8 at 1.6 Msps (or a multiple of
 * 800 kHz). 1.6 Msps is the lightest rate the demodulator supports and keeps
 * WebUSB throughput modest.
 */
export const WMBUS_SAMPLE_RATE = 1_600_000;

/**
 * Number of complex samples (I/Q pairs) to pull per read. At 1.6 Msps a block
 * of 65536 pairs is ~41 ms of signal and 128 KiB on the wire.
 */
export const READ_BLOCK_SAMPLES = 65_536;

export type SamplesCallback = (block: {
  /** Interleaved cu8 bytes: I0, Q0, I1, Q1, ... (length = samples * 2). */
  data: ArrayBuffer;
  /** Center frequency the radio was tuned to for this block, in Hz. */
  frequency: number;
}) => void;

export type DeviceConfig = {
  centerFrequencyHz?: number;
  sampleRate?: number;
  /** Tuner gain in dB, or null for automatic gain control. */
  gain?: number | null;
  ppm?: number;
};

/**
 * Thin wrapper around the webrtlsdr RTL2832U driver that continuously streams
 * cu8 IQ blocks at the wM-Bus frequency.
 *
 * WebUSB requires a user gesture to open the device and only works on the main
 * thread, so `connect()` must be called from a click handler. The captured
 * blocks are handed to a callback (which forwards them to the DSP worker).
 */
export class WmbusSdr {
  private readonly provider = new RTL2832U_Provider();
  private device?: RtlDevice;
  private running = false;
  private loopPromise?: Promise<void>;

  /** Actual sample rate reported by the device after configuration. */
  actualSampleRate = 0;

  /** True once the device is open and configured. */
  get connected(): boolean {
    return this.device !== undefined;
  }

  /** True while the read loop is pulling samples. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Prompts the user to pick an RTL-SDR (WebUSB chooser), opens it, and applies
   * the wM-Bus configuration. Must be called from a user gesture.
   */
  async connect(config: DeviceConfig = {}): Promise<void> {
    if (this.device) return;

    const device = await this.provider.get();
    try {
      this.actualSampleRate = await device.setSampleRate(
        config.sampleRate ?? WMBUS_SAMPLE_RATE,
      );
      await device.setCenterFrequency(
        config.centerFrequencyHz ?? WMBUS_CENTER_HZ,
      );
      if (config.ppm !== undefined) {
        await device.setFrequencyCorrection(config.ppm);
      }
      await device.setGain(config.gain ?? null);
    } catch (err) {
      await device.close().catch(() => {});
      throw err;
    }
    this.device = device;
  }

  /**
   * Starts the continuous read loop. Each captured block is passed to
   * `onSamples`. Resolves immediately; the loop runs in the background until
   * `stop()` is called.
   */
  start(onSamples: SamplesCallback): void {
    if (!this.device) throw new Error("Device not connected");
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.readLoop(this.device, onSamples);
  }

  private async readLoop(
    device: RtlDevice,
    onSamples: SamplesCallback,
  ): Promise<void> {
    await device.resetBuffer();
    while (this.running) {
      let block;
      try {
        block = await device.readSamples(READ_BLOCK_SAMPLES);
      } catch (err) {
        if (this.running) throw err;
        return; // closed while reading; expected during stop()
      }
      onSamples({ data: block.data, frequency: block.frequency });
    }
  }

  /** Stops the read loop. Safe to call multiple times. */
  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise?.catch(() => {});
    this.loopPromise = undefined;
  }

  /** Stops the loop and closes the USB device. */
  async close(): Promise<void> {
    await this.stop();
    if (this.device) {
      await this.device.close();
      this.device = undefined;
    }
  }
}

/**
 * Computes a coarse average signal level (0..1) from a cu8 IQ block. cu8 is
 * centered on 127.5; we average the magnitude of the deviation from center,
 * normalized to the maximum possible (~127.5). This is a cheap "are samples
 * flowing and is there energy" indicator, not a calibrated power measurement.
 */
export function averageSignalLevel(data: ArrayBuffer): number {
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) return 0;
  let sum = 0;
  // Stride to keep this cheap on large blocks; every 8th sample is plenty.
  const stride = 8 * 2;
  let count = 0;
  for (let i = 0; i + 1 < bytes.length; i += stride) {
    const iVal = bytes[i] - 127.5;
    const qVal = bytes[i + 1] - 127.5;
    sum += Math.hypot(iVal, qVal);
    count++;
  }
  if (count === 0) return 0;
  const avgMag = sum / count;
  // Magnitude of pure noise floor hovers low; clamp the normalized value.
  return Math.min(1, avgMag / 127.5);
}
