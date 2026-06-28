import { headlineValue } from "../meter.ts";
import type { MeterResult } from "../worker/protocol.ts";

type Row = {
  id: string;
  result: MeterResult;
  updates: number;
  lastSeen: number;
};

const STATUS_LABELS: Record<MeterResult["status"], { text: string; cls: string }> =
  {
    decoded: { text: "decoded", cls: "ok" },
    decoded_zero_key: { text: "decrypted (0x0)", cls: "ok" },
    recognized: { text: "recognized", cls: "warn" },
    encrypted: { text: "encrypted", cls: "err" },
    undecoded: { text: "undecoded", cls: "muted" },
  };

/**
 * Table of meters keyed by id (falling back to telegram serial for telegrams
 * that never decoded far enough to expose an id). Sorted most-recent first.
 */
export class MeterTable {
  private readonly rows = new Map<string, Row>();

  constructor(
    private readonly tbody: HTMLElement,
    private readonly counter: HTMLElement,
  ) {}

  add(result: MeterResult): void {
    const id = result.reading?.id ?? result.serial;
    const existing = this.rows.get(id);
    if (existing) {
      existing.result = result;
      existing.updates++;
      existing.lastSeen = Date.now();
    } else {
      this.rows.set(id, { id, result, updates: 1, lastSeen: Date.now() });
    }
    this.render();
  }

  reset(): void {
    this.rows.clear();
    this.render();
  }

  private render(): void {
    this.counter.textContent = `${this.rows.size} meter(s)`;
    if (this.rows.size === 0) {
      this.tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">No meters decoded yet…</td></tr>';
      return;
    }
    const sorted = [...this.rows.values()].sort(
      (a, b) => b.lastSeen - a.lastSeen,
    );
    this.tbody.replaceChildren(...sorted.map((r) => this.renderRow(r)));
  }

  private renderRow(row: Row): HTMLTableRowElement {
    const { result } = row;
    const reading = result.reading;
    const status = STATUS_LABELS[result.status];
    const value = reading ? headlineValue(reading) : "—";
    const tr = document.createElement("tr");
    if (reading) {
      tr.title = JSON.stringify(reading.raw, null, 2);
    }
    const seen = new Date(row.lastSeen).toLocaleTimeString();
    cell(tr, row.id, "mono");
    cell(tr, reading?.media ?? "—");
    cell(tr, reading?.meter ?? "—");
    cell(tr, formatFreq(result.frequencyHz), "mono");
    cell(tr, status.text, status.cls);
    cell(tr, value, "mono");
    cell(tr, String(row.updates));
    cell(tr, seen, "muted");
    return tr;
  }
}

/** Formats a reception frequency in MHz (e.g. "868.950 MHz"). */
function formatFreq(hz?: number): string {
  if (!hz) return "—";
  return `${(hz / 1e6).toFixed(3)} MHz`;
}

function cell(tr: HTMLTableRowElement, text: string, cls?: string): void {
  const td = document.createElement("td");
  td.textContent = text;
  if (cls) td.className = cls;
  tr.appendChild(td);
}
