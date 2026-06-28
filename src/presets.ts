/**
 * Wireless M-Bus band/mode presets.
 *
 * Each preset pairs an SDR tuning (center frequency + sample rate) with the
 * rtl-wmbus demodulator parameters (decimation rate, and the "simultaneous"
 * flag that receives S1 + T1/C1 together at 868.625 MHz). It also lists the
 * countries/regions where the band is typical, shown as flags in the UI.
 *
 * rtl-wmbus only demodulates the 868 MHz modes (S/T/C); 169 MHz (N/Wize) and
 * 433 MHz (F) are listed for reference but marked unsupported.
 */
export type Country = { flag: string; name: string };

export type WmbusPreset = {
  id: string;
  label: string;
  /** Short description of the mode(s) this preset receives. */
  mode: string;
  centerHz: number;
  sampleRate: number;
  /** rtl-wmbus -d (sample rate = decimation * 800 kHz). */
  decimation: number;
  /** rtl-wmbus -s (receive S1 + T1/C1 simultaneously at 868.625 MHz). */
  simultaneous: boolean;
  /** Whether the WASM demodulator can decode this band. */
  supported: boolean;
  countries: Country[];
  note?: string;
};

const EU_868: Country[] = [
  { flag: "🇩🇪", name: "Germany" },
  { flag: "🇦🇹", name: "Austria" },
  { flag: "🇳🇱", name: "Netherlands" },
  { flag: "🇧🇪", name: "Belgium" },
  { flag: "🇨🇭", name: "Switzerland" },
  { flag: "🇨🇿", name: "Czechia" },
  { flag: "🇵🇱", name: "Poland" },
  { flag: "🇩🇰", name: "Denmark" },
  { flag: "🇸🇪", name: "Sweden" },
  { flag: "🇳🇴", name: "Norway" },
  { flag: "🇫🇮", name: "Finland" },
  { flag: "🇬🇧", name: "United Kingdom" },
];

const BAND_169: Country[] = [
  { flag: "🇫🇷", name: "France (gas, water)" },
  { flag: "🇮🇹", name: "Italy (gas)" },
  { flag: "🇪🇸", name: "Spain (water)" },
  { flag: "🇵🇹", name: "Portugal (water)" },
];

export const PRESETS: WmbusPreset[] = [
  {
    id: "t1c1-868950",
    label: "868.950 MHz — T1 / C1",
    mode: "T1 / C1",
    centerHz: 868_950_000,
    sampleRate: 1_600_000,
    decimation: 2,
    simultaneous: false,
    supported: true,
    countries: EU_868,
  },
  {
    id: "s1-868300",
    label: "868.300 MHz — S1",
    mode: "S1 (stationary)",
    centerHz: 868_300_000,
    sampleRate: 1_600_000,
    decimation: 2,
    simultaneous: false,
    supported: true,
    countries: EU_868,
  },
  {
    id: "all868-868625",
    label: "868.625 MHz — S1 + T1 + C1",
    mode: "S1 + T1 + C1 (all 868)",
    centerHz: 868_625_000,
    sampleRate: 2_400_000,
    decimation: 3,
    simultaneous: true,
    supported: true,
    countries: EU_868,
  },
  {
    id: "n-169400",
    label: "169.400 MHz — N / Wize",
    mode: "N-mode (narrowband)",
    centerHz: 169_400_000,
    sampleRate: 1_600_000,
    decimation: 2,
    simultaneous: false,
    supported: false,
    countries: BAND_169,
    note: "N-mode (169 MHz) demodulation is not supported yet.",
  },
  {
    id: "f-433820",
    label: "433.820 MHz — F",
    mode: "F-mode",
    centerHz: 433_820_000,
    sampleRate: 1_600_000,
    decimation: 2,
    simultaneous: false,
    supported: false,
    countries: [{ flag: "🌍", name: "Markets where 868 MHz is unavailable" }],
    note: "F-mode (433 MHz) demodulation is not supported yet.",
  },
];

export const DEFAULT_PRESET = PRESETS[0];

export function presetById(id: string): WmbusPreset {
  return PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET;
}
