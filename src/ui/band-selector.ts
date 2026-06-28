import {
  PRESETS,
  DEFAULT_PRESET,
  presetById,
  type WmbusPreset,
} from "../presets.ts";

/**
 * Drives the band/mode dropdown and the country-flag row. Calls `onChange`
 * whenever the selection changes (and once on init for the default).
 */
export class BandSelector {
  private current: WmbusPreset = DEFAULT_PRESET;

  constructor(
    private readonly select: HTMLSelectElement,
    private readonly flags: HTMLElement,
    private readonly note: HTMLElement,
    private readonly onChange: (preset: WmbusPreset) => void,
  ) {
    for (const preset of PRESETS) {
      const opt = document.createElement("option");
      opt.value = preset.id;
      opt.textContent = preset.supported
        ? preset.label
        : `${preset.label} (unsupported)`;
      this.select.appendChild(opt);
    }
    this.select.value = DEFAULT_PRESET.id;
    this.select.addEventListener("change", () => {
      this.current = presetById(this.select.value);
      this.render();
      this.onChange(this.current);
    });
    this.render();
  }

  get preset(): WmbusPreset {
    return this.current;
  }

  /** Disable selection while receiving (changing band needs a reconnect). */
  setEnabled(enabled: boolean): void {
    this.select.disabled = !enabled;
  }

  private render(): void {
    const p = this.current;
    this.flags.replaceChildren(
      ...p.countries.map((c) => {
        const span = document.createElement("span");
        span.className = "flag";
        span.textContent = c.flag;
        span.title = c.name;
        return span;
      }),
    );
    if (p.note) {
      this.note.textContent = p.note;
      this.note.hidden = false;
    } else {
      this.note.hidden = true;
    }
  }
}
