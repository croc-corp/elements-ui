/**
 * <hf-knob> · Knob
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/knob
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-knob.tsx.
 */
import { FormMixin, HF, TAU, bayer, clamp, define, localPoint, mix, reduced, rollText } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-knob>`. */
export interface HKnobEventMap {
  /** Fires on every value change from drag, wheel or keys. */
  input: CustomEvent<{ value: number }>;
  /** Fires on pointer release and on each wheel step or key press. */
  change: CustomEvent<{ value: number }>;
}

/** Centre of the fixed 200 × 200 px dial. */
const CENTER = 100;
/** The value arc sweeps from -135° to +135°, measured clockwise from the top. */
const SWEEP_MIN = -135;
const SWEEP = 270;

/** Value steps per arrow and page key. */
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
  PageUp: 5,
  PageDown: -5,
};

/** Decimal places of a step size (`0.5` → 1). */
const decimalsOf = (step: number): number => {
  const text = String(step);
  return text.includes(".") ? text.split(".")[1].length : 0;
};

/**
 * Form-associated rotary knob drawn as a dithered sphere with an arc of lit cells; set it by drag, scroll wheel or
 * arrow keys.
 */
class HKnob extends FormMixin(HF) {
  static readonly observedAttributes = ["value", "min", "max", "step", "unit", "label"] as const;

  /** Current value; null until the first {@link HKnob.setValue}. */
  private v: number | null = null;
  /** Sprung pointer angle in degrees. */
  private ang = 0;
  /** Angular velocity. */
  private vel = 0;
  /** Tick highlight after a change, fading from 1 to 0. */
  private flash = 0;
  private dragging = false;

  constructor() {
    super(
      `
      :host { display: inline-block; vertical-align: middle; }
      .wrap { display: grid; justify-items: center; gap: 2px; }
      canvas.px { width: 200px; height: 200px; touch-action: none; cursor: grab; border-radius: 50%; }
      canvas.px:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
      :host(:disabled) { opacity: .55; }
      :host(:disabled) canvas.px { cursor: default; }
      .v { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .v .rollslot { justify-items: center; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      `,
      `<div class="wrap"><canvas class="px" tabindex="0" role="slider"></canvas><span class="v"><span class="rollslot vv" aria-hidden="true"></span></span><span class="lab"></span></div>`,
      2,
      0.7,
    );
    const dial = this.$("canvas");
    dial.addEventListener("pointerdown", (e) => {
      if (this.formDisabled || e.button !== 0) return;
      dial.setPointerCapture(e.pointerId);
      dial.focus({ preventScroll: true });
      this.dragging = true;
      this.track(e);
    });
    dial.addEventListener("pointermove", (e) => {
      if (this.dragging) this.track(e);
    });
    const release = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.kick();
      this.emit<{ value: number }>("change", { value: this.value });
    };
    dial.addEventListener("pointerup", release);
    dial.addEventListener("pointercancel", release);
    dial.addEventListener(
      "wheel",
      (e) => {
        if (this.formDisabled) return;
        e.preventDefault();
        this.setValue(this.value + (e.deltaY < 0 ? 1 : -1) * this.step, true, true);
      },
      { passive: false },
    );
    dial.addEventListener("keydown", (e) => {
      if (this.formDisabled) return;
      const d = KEY_STEPS[e.key];
      if (d) {
        e.preventDefault();
        this.setValue(this.value + d * this.step, true, true);
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        this.setValue(e.key === "Home" ? this.min : this.max, true, true);
      }
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

  /** Parsed `step`; a missing, zero or negative step is 1. */
  get step(): number {
    const step = this.num("step", 1);
    return step > 0 ? step : 1;
  }

  /**
   * Current value. Setting it clamps and snaps without firing events; it is not reflected to the attribute. `NaN`
   * until the element first connects.
   */
  get value(): number {
    return this.v ?? NaN;
  }

  set value(value: number) {
    this.setValue(+value, false);
  }

  protected override init(): void {
    this.renderLabel();
    // a value set through the property before the first connect wins over the attribute
    const start = this.v ?? this.num("value", 50);
    this.v = null;
    this.setValue(start, false);
    this.ang = this.angleFor(this.value);
  }

  attributeChangedCallback(name: string): void {
    // before the first connect, init() reads every attribute
    if (!this.initialized) return;
    if (name === "label") this.renderLabel();
    else if (name === "value") this.setValue(this.num("value", 50), false);
    else {
      // a new range, step or unit: clamp and snap the value again and refresh the text and ARIA
      const current = this.value;
      this.v = null;
      this.setValue(current, false);
    }
  }

  /** Called by the browser when the `disabled` attribute or a disabled ancestor `<fieldset>` changes. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    this.dragging = false;
    const dial = this.$("canvas");
    dial.tabIndex = disabled ? -1 : 0;
    if (disabled) dial.setAttribute("aria-disabled", "true");
    else dial.removeAttribute("aria-disabled");
    this.kick();
  }

  /** Restores the `value` attribute. */
  formResetCallback(): void {
    if (this.initialized) this.setValue(this.num("value", 50), false);
  }

  private renderLabel(): void {
    const label = this.getAttribute("label") || "Gain";
    this.$(".lab").textContent = label;
    this.$("canvas").setAttribute("aria-label", label);
  }

  /** Dial angle in degrees for a value. */
  private angleFor(value: number): number {
    return SWEEP_MIN + (SWEEP * (value - this.min)) / (this.max - this.min || 1);
  }

  private format(value: number): string {
    return `${value.toFixed(decimalsOf(this.step))}${this.getAttribute("unit") || ""}`;
  }

  /** Set the value from the pointer angle around the centre. */
  private track(e: PointerEvent): void {
    const [x, y] = localPoint(this.$("canvas"), e);
    let angle = (Math.atan2(x - CENTER, -(y - CENTER)) * 180) / Math.PI;
    // past either end of the sweep, stay at the end the pointer came from
    if (angle > 135 || angle < -135) angle = this.ang > 0 ? 135 : -135;
    this.ang = angle;
    this.vel = 0;
    this.setValue(this.min + ((angle - SWEEP_MIN) / SWEEP) * (this.max - this.min), true);
  }

  /** Clamp and snap `raw`, then update the label, ARIA and form value. */
  private setValue(raw: number, emit: boolean, change = false): void {
    const snapped = Math.round((raw - this.min) / this.step) * this.step + this.min;
    const v = +clamp(snapped, this.min, this.max).toFixed(6);
    if (v === this.v || !Number.isFinite(v)) return;
    const prev = this.v;
    this.v = v;
    this.flash = 1;
    const text = this.format(v);
    rollText(this.$(".vv"), text, prev == null || v > prev ? 1 : -1, prev != null);
    const dial = this.$("canvas");
    dial.setAttribute("aria-valuenow", String(v));
    dial.setAttribute("aria-valuemin", String(this.min));
    dial.setAttribute("aria-valuemax", String(this.max));
    dial.setAttribute("aria-valuetext", text);
    this.setFormValue(String(v));
    if (emit) {
      this.emit<{ value: number }>("input", { value: v });
      if (change) this.emit<{ value: number }>("change", { value: v });
    }
    this.kick();
  }

  protected override render(_t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const target = this.angleFor(this.value);
    if (!this.dragging) {
      if (reducedMotion) {
        this.ang = target;
      } else {
        const stiffness = 380;
        const damping = 2 * Math.sqrt(stiffness) * 0.6;
        this.vel += (stiffness * (target - this.ang) - damping * this.vel) * dt;
        this.ang += this.vel * dt;
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    const A = this.ang;
    const lit = mix(P.raised, P.fg, 0.5);
    const unlit = mix(P.raised, P.fg, 0.1);
    // pointer direction in radians, 0 along +x
    const ar = ((A - 90) * Math.PI) / 180;
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const dx = x - CENTER;
        const dy = y - CENTER;
        const r = Math.hypot(dx, dy);
        if (r > 98) continue;
        // clockwise from the top
        const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
        // value arc
        if (r >= 74 && r <= 88 && Math.abs(deg) <= 135) {
          const u = (deg - SWEEP_MIN) / SWEEP;
          const on = deg <= A;
          const head = on && A - deg < 6;
          if (on) F.put(i, j, mix(P.accent, P.shine, head ? 0.5 : u * u * 0.35), 0.95, head ? 0.9 : u * u * 0.45);
          else F.put(i, j, P.fg, 0.12, 0);
          continue;
        }
        // eleven ticks outside the arc
        if (r >= 92 && r <= 97) {
          for (let k = 0; k <= 10; k++) {
            const tickDeg = SWEEP_MIN + k * 27;
            if (Math.abs(deg - tickDeg) >= 1.4) continue;
            const on = tickDeg <= A + 0.5;
            const near = Math.abs(tickDeg - A) < 14 ? 1 : 0;
            F.put(i, j, on ? P.accent : P.fg, on ? 0.9 : 0.3, on ? 0.3 + this.flash * 0.5 * near : 0);
          }
          continue;
        }
        // knob body: a dithered, lit sphere with a ridged rim and an indicator line
        if (r <= 60) {
          const nx = dx / 60;
          const ny = dy / 60;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          let shade = clamp(0.2 + 0.8 * (-0.45 * nx - 0.55 * ny + 0.7 * nz), 0, 1);
          if (r > 57) shade *= 0.5;
          const ridge = r > 50 && r < 57 && Math.floor((Math.atan2(dy, dx) - ar) / (TAU / 48)) % 2 === 0;
          if (ridge) shade *= 0.8;
          F.put(i, j, shade > bayer(i, j) ? lit : unlit, 1, 0);
          const lineD = Math.abs(dx * Math.sin(ar) - dy * Math.cos(ar));
          const along = dx * Math.cos(ar) + dy * Math.sin(ar);
          if (lineD < 2.6 && along > 22 && along < 50) F.put(i, j, mix(P.accent, P.shine, 0.4), 1, 0.9);
        }
      }
    }
    this.flush(0.9, 6);
    return this.dragging || Math.abs(target - this.ang) > 0.02 || Math.abs(this.vel) > 0.05 || this.flash > 0;
  }
}

define("hf-knob", HKnob);

declare global {
  interface HTMLElementTagNameMap {
    "hf-knob": HKnob;
  }
}

export { HKnob };
