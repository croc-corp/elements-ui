/**
 * <hf-slider> · Slider
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/slider
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-slider.tsx.
 */
import {
  DISABLED_CSS,
  FormMixin,
  HF,
  bayer,
  clamp,
  define,
  localPoint,
  mix,
  reduced,
  rollText,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-slider>`. */
export interface HSliderEventMap {
  /** Fires on every value change from a drag or key press. Not fired when `value` is set from code. */
  input: CustomEvent<{ value: number }>;
  /** Fires on pointer release and after each key press that changed the value. */
  change: CustomEvent<{ value: number }>;
}

/** A lit cell of the track: colour, opacity and glow. */
interface TrackCell {
  col: RGB;
  alpha: number;
  glow: number;
}

/** Horizontal inset of the track ends in px, so the lens fits at both ends. */
const INSET = 18;
/** Half height of the track bar in px. */
const BAR_HALF = 7;
/** Radius of the lens thumb in px. */
const LENS_R = 16;
/** Magnification of the dots under the lens. */
const LENS_ZOOM = 1.9;

/** Decimal places of a step size (`0.05` → 2). */
const decimalsOf = (step: number): number => {
  const text = String(step);
  return text.includes(".") ? text.split(".")[1].length : 0;
};

/** Form-associated range slider with a dithered fill and a lens for a thumb that magnifies the dots beneath it. */
class HSlider extends FormMixin(HF) {
  static readonly observedAttributes = ["value", "min", "max", "step", "label", "prefix", "unit"] as const;

  /** Current value; null until the first {@link HSlider.setValue}. */
  private v: number | null = null;
  /** Sprung thumb position as a fraction of the range. */
  private p = 0;
  /** Thumb velocity. */
  private vp = 0;
  private dragging = false;
  /** True while the element writes its own `value` attribute, so the change is not handled again. */
  private reflecting = false;
  /** Value on the first connect; form reset restores it. */
  private defaultValue = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      ${DISABLED_CSS}
      .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; gap: 10px; }
      .lab { font-size: 12.5px; font-weight: 500; }
      .val { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .val .rollslot { justify-items: end; }
      .track { position: relative; height: 44px; touch-action: none; cursor: pointer; border-radius: 12px; }
      .track:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .ends { display: flex; justify-content: space-between; font-family: var(--_mono); font-size: 11px; color: var(--_muted); }
      `,
      `<div class="head"><span class="lab" id="lab"></span><span class="val"><span class="rollslot v"></span></span></div><div class="track" tabindex="0" role="slider" aria-labelledby="lab"><canvas class="px" aria-hidden="true"></canvas></div><div class="ends"><span class="lo"></span><span class="hi"></span></div>`,
      2,
      0.72,
    );
    const track = this.$(".track");
    const valueAt = (e: PointerEvent): number => {
      const [x] = localPoint(track, e);
      return this.min + clamp((x - INSET) / (track.offsetWidth - 2 * INSET), 0, 1) * (this.max - this.min);
    };
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      track.setPointerCapture(e.pointerId);
      track.focus({ preventScroll: true });
      this.dragging = true;
      this.setValue(valueAt(e), true);
    });
    track.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.setValue(valueAt(e), true);
      // the thumb follows the pointer directly while dragging
      this.p = this.frac;
      this.vp = 0;
    });
    const release = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.emitChange();
    };
    track.addEventListener("pointerup", release);
    track.addEventListener("pointercancel", release);
    track.addEventListener("keydown", (e) => {
      let target: number;
      if (e.key === "Home") target = this.min;
      else if (e.key === "End") target = this.max;
      else {
        const d = this.keyStep(e.key);
        if (d == null) return;
        target = this.value + d;
      }
      e.preventDefault();
      if (this.setValue(target, true)) this.emitChange();
    });
  }

  /** Parsed `min`. */
  get min(): number {
    return this.num("min", 0);
  }

  /** Parsed `max`. */
  get max(): number {
    return this.num("max", 100);
  }

  /** Parsed `step`; values at or below 0 fall back to 1. */
  get step(): number {
    const step = this.num("step", 1);
    return step > 0 ? step : 1;
  }

  /** Position of the value in the range, 0 to 1. */
  get frac(): number {
    return (this.value - this.min) / (this.max - this.min || 1);
  }

  /**
   * Current value. Setting it clamps, snaps and reflects to the attribute without firing events. `NaN` until the
   * element first connects.
   */
  get value(): number {
    return this.v ?? NaN;
  }

  set value(value: number) {
    this.setValue(+value, false);
  }

  protected override init(): void {
    this.syncLabels();
    this.v = null;
    this.setValue(this.num("value", this.min), false, true);
    this.defaultValue = this.value;
    this.p = this.frac;
  }

  attributeChangedCallback(name: string): void {
    if (!this.initialized || this.reflecting) return;
    if (name === "value") {
      this.setValue(this.num("value", this.value), false);
      return;
    }
    // new bounds, step or format: refresh the labels, then re-clamp and re-format the value
    this.syncLabels();
    const value = this.value;
    this.v = null;
    this.setValue(value, false, true);
  }

  /** Restores the value from the first connect, without events. */
  formResetCallback(): void {
    this.setValue(this.defaultValue, false);
  }

  /** Takes the slider out of the tab order while the element or its fieldset is disabled. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    const track = this.$(".track");
    track.tabIndex = disabled ? -1 : 0;
    track.setAttribute("aria-disabled", String(disabled));
  }

  /** The visible label and the formatted bounds under the track. */
  private syncLabels(): void {
    this.$(".lab").textContent = this.getAttribute("label") || "";
    this.$(".lo").textContent = this.format(this.min);
    this.$(".hi").textContent = this.format(this.max);
  }

  /** Value change for an arrow or page key, or undefined for other keys. */
  private keyStep(key: string): number | undefined {
    const big = (this.max - this.min) / 10;
    switch (key) {
      case "ArrowRight":
      case "ArrowUp":
        return this.step;
      case "ArrowLeft":
      case "ArrowDown":
        return -this.step;
      case "PageUp":
        return big;
      case "PageDown":
        return -big;
      default:
        return undefined;
    }
  }

  private format(value: number): string {
    const digits = decimalsOf(this.step);
    const formatted = value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `${this.getAttribute("prefix") || ""}${formatted}${this.getAttribute("unit") || ""}`;
  }

  private emitChange(): void {
    this.emit<{ value: number }>("change", { value: this.value });
  }

  /**
   * Clamp and snap `raw`, then update the label, ARIA, form value and attribute. `emit` fires `input`. Returns
   * whether the value changed; a value that is not a number is ignored.
   */
  private setValue(raw: number, emit: boolean, first = false): boolean {
    if (!Number.isFinite(raw)) return false;
    const snapped = Math.round((raw - this.min) / this.step) * this.step + this.min;
    const v = +clamp(snapped, this.min, this.max).toFixed(6);
    if (v === this.v) return false;
    const dir = this.v == null || v >= this.v ? 1 : -1;
    this.v = v;
    const text = this.format(v);
    rollText(this.$(".v"), text, dir, !first);
    const track = this.$(".track");
    track.setAttribute("aria-valuenow", String(v));
    track.setAttribute("aria-valuemin", String(this.min));
    track.setAttribute("aria-valuemax", String(this.max));
    track.setAttribute("aria-valuetext", text);
    this.setFormValue(String(v));
    this.reflecting = true;
    this.setAttribute("value", String(v));
    this.reflecting = false;
    if (emit) this.emit<{ value: number }>("input", { value: v });
    this.kick();
    return true;
  }

  protected override render(_t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const target = this.frac;
    if (!this.dragging) {
      if (reducedMotion) {
        this.p = target;
      } else {
        const stiffness = 280;
        const damping = 2 * Math.sqrt(stiffness) * 0.68;
        this.vp += (stiffness * (target - this.p) - damping * this.vp) * dt;
        this.p += this.vp * dt;
      }
    }
    const x0 = INSET;
    const span = this.w - 2 * INSET;
    const tx = x0 + clamp(this.p, 0, 1) * span;
    const cy = this.h / 2;

    /** The track at `(x, y)` for cell `(ii, jj)`: dithered fill left of the thumb, faint dots right of it. */
    const trackCell = (x: number, y: number, ii: number, jj: number): TrackCell | null => {
      if (Math.abs(y - cy) > BAR_HALF || x < x0 - 4 || x > x0 + span + 4) return null;
      if (x <= tx) {
        const g = clamp((x - x0) / Math.max(1, tx - x0), 0, 1);
        if (Math.pow(g, 1.25) > bayer(ii, jj) * 0.92 + 0.03) {
          return { col: mix(P.accent, P.shine, Math.pow(g, 3) * 0.5), alpha: 0.95, glow: Math.pow(g, 4) * 0.5 };
        }
        return { col: P.accent, alpha: 0.16, glow: 0 };
      }
      return { col: P.fg, alpha: 0.12, glow: 0 };
    };

    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const lensD = Math.hypot(x - tx, y - cy);
        if (lensD < LENS_R) {
          if (lensD > LENS_R - 2.2) {
            // lens rim, with a highlight on the upper left
            const highlight = x - tx + (y - cy) < -6;
            F.put(i, j, highlight ? P.shine : P.fg, highlight ? 0.95 : 0.55, highlight ? 0.4 : 0);
            continue;
          }
          // inside the lens: sample the track closer to the centre, so it appears magnified
          const sx = tx + (x - tx) / LENS_ZOOM;
          const sy = cy + (y - cy) / LENS_ZOOM;
          const [si, sj] = F.ij(sx, sy);
          const cell = trackCell(sx, sy, si, sj);
          if (cell) F.put(i, j, cell.col, Math.min(1, cell.alpha + 0.05), cell.glow + 0.1);
          else F.put(i, j, P.fg, 0.05);
          continue;
        }
        const cell = trackCell(x, y, i, j);
        if (cell) F.put(i, j, cell.col, cell.alpha, cell.glow);
      }
    }
    this.flush(0.85, 5);
    return this.dragging || Math.abs(target - this.p) > 0.0005 || Math.abs(this.vp) > 0.001;
  }
}

define("hf-slider", HSlider);

declare global {
  interface HTMLElementTagNameMap {
    "hf-slider": HSlider;
  }
}

export { HSlider };
