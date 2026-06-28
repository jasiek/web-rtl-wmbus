import type { Telegram } from "../telegram.ts";
import type { DecodeStatus } from "../worker/decoder.ts";
import { lockBadge } from "./lock-badge.ts";

/** Aggregated view of all telegrams seen from one meter serial. */
type MeterRow = {
  serial: string;
  mode: string;
  count: number;
  crcOkCount: number;
  lastRssi: number;
  lastSeen: number;
  lastHex: string;
  /** Latest decode/decrypt outcome for this serial, once known. */
  status?: DecodeStatus;
};

/**
 * Maintains a table of meters keyed by serial, aggregating the telegrams seen
 * from each. Rows are sorted most-recently-seen first.
 */
export class TelegramTable {
  private readonly rows = new Map<string, MeterRow>();
  private total = 0;

  constructor(
    private readonly tbody: HTMLElement,
    private readonly counter: HTMLElement,
  ) {}

  add(t: Telegram): void {
    this.total++;
    const existing = this.rows.get(t.serial);
    if (existing) {
      existing.count++;
      if (t.crcOk) existing.crcOkCount++;
      existing.mode = t.mode;
      existing.lastRssi = t.currentRssi;
      existing.lastSeen = Date.now();
      existing.lastHex = t.hex;
    } else {
      this.rows.set(t.serial, {
        serial: t.serial,
        mode: t.mode,
        count: 1,
        crcOkCount: t.crcOk ? 1 : 0,
        lastRssi: t.currentRssi,
        lastSeen: Date.now(),
        lastHex: t.hex,
      });
    }
    this.render();
  }

  /** Records the decode/decrypt outcome for a serial (drives the padlock). */
  setStatus(serial: string, status: DecodeStatus): void {
    const row = this.rows.get(serial);
    if (row) {
      row.status = status;
      this.render();
    }
  }

  reset(): void {
    this.rows.clear();
    this.total = 0;
    this.render();
  }

  private render(): void {
    this.counter.textContent = `${this.total} received · ${this.rows.size} meter(s)`;

    if (this.rows.size === 0) {
      this.tbody.innerHTML =
        '<tr class="empty-row"><td colspan="8">No telegrams yet. Connect and wait for nearby meters…</td></tr>';
      return;
    }

    const sorted = [...this.rows.values()].sort(
      (a, b) => b.lastSeen - a.lastSeen,
    );
    this.tbody.replaceChildren(...sorted.map((r) => this.renderRow(r)));
  }

  private renderRow(r: MeterRow): HTMLTableRowElement {
    const tr = document.createElement("tr");
    const seen = new Date(r.lastSeen).toLocaleTimeString();
    const crc = `${r.crcOkCount}/${r.count}`;
    const hexShort =
      r.lastHex.length > 48 ? r.lastHex.slice(0, 48) + "…" : r.lastHex;
    const lock =
      r.status === undefined && r.crcOkCount === 0
        ? { emoji: "🚫", title: "CRC failed — cannot read" }
        : lockBadge(r.status);
    cells(tr, [
      { text: r.serial, cls: "mono" },
      { text: lock.emoji, cls: "lock", title: lock.title },
      { text: r.mode },
      { text: String(r.count) },
      { text: crc, cls: r.crcOkCount > 0 ? "ok" : "warn" },
      { text: `${r.lastRssi}`, cls: "mono" },
      { text: seen, cls: "muted" },
      { text: hexShort, cls: "mono hex", title: r.lastHex },
    ]);
    return tr;
  }
}

function cells(
  tr: HTMLTableRowElement,
  defs: { text: string; cls?: string; title?: string }[],
): void {
  for (const d of defs) {
    const td = document.createElement("td");
    td.textContent = d.text;
    if (d.cls) td.className = d.cls;
    if (d.title) td.title = d.title;
    tr.appendChild(td);
  }
}
