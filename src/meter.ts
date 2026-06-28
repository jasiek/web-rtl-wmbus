/**
 * A decoded meter reading produced by wmbusmeters from a single telegram.
 *
 * wmbusmeters emits one JSON object per telegram. A handful of fields are
 * stable across drivers; the rest are driver-specific (e.g. `total_m3`,
 * `target_kwh`, `status`). We keep the stable fields typed and retain the full
 * object for display.
 */
export type MeterReading = {
  id: string;
  media?: string;
  meter?: string; // driver name, e.g. "multical21" or "auto"
  name?: string;
  timestamp?: string;
  /** All fields as returned by wmbusmeters. */
  raw: Record<string, unknown>;
};

/** Whether a wmbusmeters JSON object represents a successfully decoded meter. */
export function isDecoded(obj: Record<string, unknown>): boolean {
  // wmbusmeters always includes an id for a recognized telegram; an unknown or
  // undecryptable telegram yields meter "unknown"/"auto" with no value fields.
  return typeof obj.id === "string" && obj.id.length > 0;
}

/** Parses a wmbusmeters JSON line into a MeterReading, or null if not valid. */
export function parseMeterJson(line: string): MeterReading | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  if (!isDecoded(rec)) return null;
  return {
    id: String(rec.id),
    media: typeof rec.media === "string" ? rec.media : undefined,
    meter: typeof rec.meter === "string" ? rec.meter : undefined,
    name: typeof rec.name === "string" ? rec.name : undefined,
    timestamp: typeof rec.timestamp === "string" ? rec.timestamp : undefined,
    raw: rec,
  };
}

/**
 * Picks a representative headline value from a reading for compact display:
 * the first field whose name looks like a primary measurement.
 */
export function headlineValue(r: MeterReading): string {
  const preferred = [
    "total_m3",
    "total_kwh",
    "total_energy_consumption_kwh",
    "total_water_m3",
    "current_power_consumption_kw",
    "temperature_c",
    "total",
  ];
  for (const key of preferred) {
    if (key in r.raw) return `${key} = ${formatVal(r.raw[key])}`;
  }
  // Fall back to the first numeric field that is not metadata.
  const skip = new Set([
    "id",
    "media",
    "meter",
    "name",
    "timestamp",
    "device",
    "rssi_dbm",
  ]);
  for (const [k, v] of Object.entries(r.raw)) {
    if (!skip.has(k) && typeof v === "number") return `${k} = ${formatVal(v)}`;
  }
  return "—";
}

function formatVal(v: unknown): string {
  if (typeof v === "number") return String(v);
  return String(v);
}
