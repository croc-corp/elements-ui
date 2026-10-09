/**
 * <hf-range> · Range filter
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/range
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-range.tsx.
 */
import {
  DISABLED_CSS,
  FormMixin,
  HF,
  bayer,
  clamp,
  define,
  drawThumb,
  fbm,
  fmtInt,
  lerp,
  localPoint,
  mix,
  reduced,
  rollText,
} from "@/lib/lumesec/pixel";

/** Detail of the `input` and `change` events: the selected range. */
export interface HRangeDetail {
  min: number;
  max: number;
}

/** Events fired by `<hf-range>`. */
export interface HRangeEventMap {
  /**
   * Fires on every value change by the user: while dragging, on key presses and when a Min or Max field is
   * committed.
   */
  input: CustomEvent<HRangeDetail>;
  /**
   * Fires when a drag ends, after an arrow, Page, Home or End key press that moved a thumb, and when a Min or Max
   * field is committed with a new value.
   */
  change: CustomEvent<HRangeDetail>;
}

/** Horizontal inset of the scale in pixels, so the thumbs fit at both ends. */
const PAD = 15;

/** Vertical centre of the track and thumbs in pixels. */
const TRACK_Y = 97;

/** The built-in histogram: two humps and some noise over 44 bars. */
function demoBins(): number[] {
  return Array.from({ length: 44 }, (_, k) => {
    const x = k / 43;
    return (
      6 + 120 * Math.exp(-((x - 0.28) ** 2) / 0.018) + 70 * Math.exp(-((x - 0.62) ** 2) / 0.03) + 40 * fbm(k * 0.4, 2.3)
    );
  });
}

/** Dual-thumb range filter over a dithered histogram; bars inside the range light up and a result count follows. */
class HRange extends FormMixin(HF) {
  static readonly observedAttributes = [
    "min",
    "max",
    "step",
    "low",
    "high",
    "data",
    "scale",
    "prefix",
    "label",
    "unit-label",
  ] as const;

  /** Lower and upper value. */
  private vals: [number, number] = [0, 0];
  /** Range on the first connect; form reset restores it. */
  private defaults: [number, number] = [0, 0];
  /** Histogram bar heights, from `data` or the demo distribution. */
  private binValues: number[] = [];
  /** Eased 0–1 "in range" amount per histogram bar. */
  private on: number[] = [];
  /** Thumb with keyboard focus; -1 for none. */
  private act = -1;
  /** Thumb being dragged; -1 for none. */
  private drag = -1;
  /** Eased 0–1 highlight per thumb. */
  private readonly glow: [number, number] = [0, 0];
  /** True until the first sync, which shows the count without rolling. */
  private first = false;

  constructor() {
    super(
      `
      :host { display: block; }
      ${DISABLED_CSS}
      .hd { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 6px; }
      .t { font-size: 13.5px; font-weight: 600; }
      .n { font-size: 12.5px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      .w { position: relative; height: 118px; touch-action: none; cursor: pointer; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .th { position: absolute; top: 82px; width: 30px; height: 30px; margin-left: -15px; border-radius: 50%; }
      .io { display: flex; gap: 10px; margin-top: 8px; align-items: center; }
      .io label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 10px; border: 1px solid var(--_border); border-radius: 9px; background: var(--_surface); font-size: 12px; color: var(--_muted); }
      .io label:focus-within { border-color: color-mix(in srgb, var(--_accent) 60%, var(--_border)); }
      .io input { flex: 1; min-width: 0; border: 0; background: none; font-size: 13.5px; color: var(--_fg); font-variant-numeric: tabular-nums; outline: none; padding: 0; }
      .io i { color: var(--_muted); font-style: normal; }
      `,
      `<div class="hd"><span class="t"></span><span class="rollslot n" aria-live="polite"></span></div>
        <div class="w"><canvas class="px" aria-hidden="true"></canvas><span class="th" data-k="0" tabindex="0" role="slider" aria-label="Minimum"></span><span class="th" data-k="1" tabindex="0" role="slider" aria-label="Maximum"></span></div>
        <div class="io"><label>Min <input inputmode="numeric" data-k="0" aria-label="Minimum"></label><i>–</i><label>Max <input inputmode="numeric" data-k="1" aria-label="Maximum"></label></div>`,
      2,
      0.72,
    );
    const plot = this.$(".w");
    plot.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const v = this.toVal(localPoint(plot, e)[0]);
      // grab the nearer thumb; on a tie, the lower one when pressing below it
      const d0 = Math.abs(v - this.vals[0]);
      const d1 = Math.abs(v - this.vals[1]);
      this.drag = d0 < d1 || (d0 === d1 && v < this.vals[0]) ? 0 : 1;
      this.act = this.drag;
      try {
        plot.setPointerCapture(e.pointerId);
      } catch {
        // throws for a pointer that is no longer active; dragging works without capture
      }
      this.setV(this.drag, v);
      this.$$(".th")[this.drag].focus({ preventScroll: true });
      this.kick();
    });
    plot.addEventListener("pointermove", (e) => {
      if (this.drag < 0) return;
      this.setV(this.drag, this.toVal(localPoint(plot, e)[0]));
    });
    const up = (): void => {
      if (this.drag < 0) return;
      this.drag = -1;
      this.emit<HRangeDetail>("change", this.detail());
      this.kick();
    };
    plot.addEventListener("pointerup", up);
    plot.addEventListener("pointercancel", up);
    this.$$(".th").forEach((thumb) => {
      const k = Number(thumb.dataset.k);
      thumb.addEventListener("focus", () => {
        this.act = k;
        this.kick();
      });
      thumb.addEventListener("blur", () => {
        if (this.act === k) this.act = -1;
        this.kick();
      });
      thumb.addEventListener("keydown", (e) => this.onThumbKey(e, k));
    });
    this.$$<HTMLInputElement>(".io input").forEach((input) => {
      // the host fires its own `input` event with the range; keep the field's native one inside
      input.addEventListener("input", (e) => e.stopPropagation());
      input.addEventListener("change", () => {
        const k = Number(input.dataset.k);
        const v = parseFloat(input.value.replace(/[^\d.-]/g, ""));
        const changed = Number.isFinite(v) && this.setV(k, v);
        // the field always shows the value in use, also after an invalid or clamped entry
        this.sync();
        if (changed) this.emit<HRangeDetail>("change", this.detail());
      });
    });
  }

  private onThumbKey(e: KeyboardEvent, k: number): void {
    const step = this.step;
    const big = (this.max - this.min) / 10;
    const keySteps: Partial<Record<string, number>> = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: big,
      PageDown: -big,
    };
    let target: number;
    if (e.key === "Home") target = this.min;
    else if (e.key === "End") target = this.max;
    else {
      const d = keySteps[e.key];
      if (d == null) return;
      target = this.vals[k] + d;
    }
    e.preventDefault();
    if (this.setV(k, target)) this.emit<HRangeDetail>("change", this.detail());
  }

  /** The `min` attribute, or 0. */
  get min(): number {
    return this.num("min", 0);
  }

  /** The `max` attribute, or 500. */
  get max(): number {
    return this.num("max", 500);
  }

  /** The `step` attribute, or 5. Values at or below 0 fall back to 5. */
  get step(): number {
    const step = this.num("step", 5);
    return step > 0 ? step : 5;
  }

  /** Text before values; an empty attribute removes it. */
  private get pre(): string {
    return this.getAttribute("prefix") ?? "€";
  }

  /** The histogram bar heights in use, from `data` or the demo distribution. */
  get bins(): number[] {
    return [...this.binValues];
  }

  /** Value at `px` pixels from the left of the plot. */
  private toVal(px: number): number {
    const u = clamp((px - PAD) / (this.w - 2 * PAD), 0, 1);
    return this.min + u * (this.max - this.min);
  }

  /** Position in pixels of value `v`. */
  private toX(v: number): number {
    return PAD + ((v - this.min) / (this.max - this.min || 1)) * (this.w - 2 * PAD);
  }

  /** `v` snapped to `step` from `min` and kept inside the bounds. */
  private snap(v: number): number {
    const step = this.step;
    return +clamp(this.min + Math.round((v - this.min) / step) * step, this.min, this.max).toFixed(6);
  }

  /**
   * Set thumb `k` to `v`, snapped to `step`, inside the bounds and at least one step from the other thumb. Fires
   * `input` and returns true when the value changed.
   */
  private setV(k: number, v: number): boolean {
    const step = this.step;
    let next = this.snap(v);
    if (k === 0) next = Math.min(next, this.vals[1] - step);
    else next = Math.max(next, this.vals[0] + step);
    if (next === this.vals[k]) return false;
    this.vals[k] = next;
    this.sync();
    this.emit<HRangeDetail>("input", this.detail());
    this.kick();
    return true;
  }

  /** Set both values without events: snapped, ordered and at least one step apart. */
  private setRange(low: number, high: number): void {
    const hi = Math.max(this.snap(high), this.min + this.step);
    const lo = Math.min(this.snap(low), hi - this.step);
    this.vals = [lo, hi];
  }

  private detail(): HRangeDetail {
    return { min: this.vals[0], max: this.vals[1] };
  }

  protected override init(): void {
    this.readBins();
    const span = this.max - this.min;
    this.setRange(this.num("low", this.min + span * 0.2), this.num("high", this.min + span * 0.7));
    this.defaults = [...this.vals];
    this.first = true;
    this.sync();
  }

  attributeChangedCallback(name: string): void {
    if (!this.initialized) return;
    if (name === "data") this.readBins();
    if (name === "low" || name === "high") this.setRange(this.num("low", this.vals[0]), this.num("high", this.vals[1]));
    else this.setRange(this.vals[0], this.vals[1]);
    this.sync();
    this.kick();
  }

  /** Restores the range from the first connect, without events. */
  formResetCallback(): void {
    this.setRange(...this.defaults);
    this.sync();
    this.kick();
  }

  /** Takes the thumbs and fields out of use while the element or its fieldset is disabled. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    for (const thumb of this.$$(".th")) {
      thumb.tabIndex = disabled ? -1 : 0;
      thumb.setAttribute("aria-disabled", String(disabled));
    }
    for (const input of this.$$<HTMLInputElement>(".io input")) input.disabled = disabled;
  }

  /** Parse `data` (at least four numbers) or fall back to the demo histogram; keeps the eased state per bar. */
  private readBins(): void {
    const data = (this.getAttribute("data") || "").split(",").map(Number).filter(Number.isFinite);
    this.binValues = data.length > 3 ? data : demoBins();
    this.on = this.binValues.map((_, k) => this.on[k] ?? 0);
  }

  /** Update the count, the fields, the thumbs and the form value from the current range. */
  private sync(): void {
    const [lo, hi] = this.vals;
    const bins = this.binValues;
    const n = bins.length;
    let count = 0;
    bins.forEach((h, k) => {
      const c = this.min + ((k + 0.5) / n) * (this.max - this.min);
      if (c >= lo && c <= hi) count += h;
    });
    this.$(".t").textContent = this.getAttribute("label") || "Price";
    const unit = this.getAttribute("unit-label") || "results";
    rollText(this.$(".n"), `${fmtInt(count * this.num("scale", 3))} ${unit}`, 1, !this.first);
    this.first = false;
    this.$$<HTMLInputElement>(".io input").forEach((input, k) => {
      if (input !== this.root.activeElement) input.value = `${this.pre}${this.vals[k]}`;
    });
    this.$$(".th").forEach((thumb, k) => {
      thumb.setAttribute("aria-valuemin", String(this.min));
      thumb.setAttribute("aria-valuemax", String(this.max));
      thumb.setAttribute("aria-valuenow", String(this.vals[k]));
      thumb.setAttribute("aria-valuetext", `${this.pre}${this.vals[k]}`);
      if (this.w) thumb.style.left = `${this.toX(this.vals[k])}px`;
    });
    const name = this.getAttribute("name");
    if (name) {
      const data = new FormData();
      data.append(`${name}-min`, String(lo));
      data.append(`${name}-max`, String(hi));
      this.setFormValue(data);
    } else this.setFormValue(`${lo}-${hi}`);
  }

  protected override layout(): void {
    this.sync();
  }

  protected override render(_t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const pitch = F.pitch;
    const bins = this.binValues;
    const n = bins.length;
    const W = this.w;
    const mx = Math.max(...bins);
    const ty = TRACK_Y;
    // histogram top and baseline
    const top = 6;
    const base = 78;
    const [lo, hi] = this.vals;
    const xl = this.toX(lo);
    const xh = this.toX(hi);
    let busy = this.drag >= 0;
    F.clear();
    for (let k = 0; k < n; k++) {
      const c = this.min + ((k + 0.5) / n) * (this.max - this.min);
      const inRange = c >= lo && c <= hi;
      this.on[k] += ((inRange ? 1 : 0) - this.on[k]) * Math.min(1, reducedMotion ? 1 : dt * 12);
      if (Math.abs(this.on[k] - (inRange ? 1 : 0)) > 0.01) busy = true;
      const o = this.on[k];
      const x0 = PAD + (k / n) * (W - 2 * PAD);
      const x1 = PAD + ((k + 1) / n) * (W - 2 * PAD) - 1.5;
      const hgt = (bins[k] / mx) * (base - top);
      for (let j = Math.floor((base - hgt) / pitch); j < base / pitch; j++) {
        for (let i = Math.ceil(x0 / pitch); i < x1 / pitch; i++) {
          const [, y] = F.xy(i, j);
          const v = (y - (base - hgt)) / Math.max(1, hgt);
          const cap = y < base - hgt + 2.2;
          const dens = lerp(0.32, 0.6 + 0.4 * (1 - v), o);
          if (!cap && bayer(i, j) > dens) continue;
          F.put(
            i,
            j,
            mix(mix(P.muted, P.track, this.dark ? 0.2 : 0), mix(P.accent, P.shine, cap ? 0.35 : 0), o),
            cap ? lerp(0.6, 1, o) : lerp(0.45, 0.9, o),
            cap ? o * 0.5 : o * 0.06,
          );
        }
      }
    }
    // track
    for (let j = Math.floor((ty - 2) / pitch); j <= (ty + 2) / pitch; j++) {
      for (let i = Math.floor(PAD / pitch); i < (W - PAD) / pitch; i++) {
        const [x] = F.xy(i, j);
        const inRange = x >= xl && x <= xh;
        F.put(i, j, inRange ? mix(P.accent, P.shine, 0.2) : P.track, 1, inRange ? 0.12 : 0);
      }
    }
    // thumbs, each with a dotted stem up to the histogram
    [xl, xh].forEach((x, k) => {
      const target = this.act === k || this.drag === k ? 1 : 0;
      this.glow[k] += (target - this.glow[k]) * Math.min(1, dt * 10);
      if (Math.abs(target - this.glow[k]) > 0.01) busy = true;
      drawThumb(F, P, this.dark, x, ty, 11 + this.glow[k] * 1.5, this.glow[k], this.glow[k]);
      const i = Math.round(x / pitch - 0.5);
      for (let j = Math.floor((ty - 40) / pitch); j < (ty - 14) / pitch; j++) {
        if (j % 2 === 0) F.put(i, j, P.accent, 0.5 * (0.4 + 0.6 * this.glow[k]));
      }
    });
    this.flush(0.8, 4);
    return busy;
  }
}

define("hf-range", HRange);

declare global {
  interface HTMLElementTagNameMap {
    "hf-range": HRange;
  }
}

export { HRange };
