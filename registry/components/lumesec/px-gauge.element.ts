/**
 * <px-gauge> · Throughput gauge
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/gauge
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-gauge.tsx.
 *
 * Demo data: The tokens-per-second reading is simulated; only `max` can be set. It cannot show your own data
 * yet; use it as a template and replace the invented data before it shows anything real.
 */
import { PxBase, clamp, css, define, mix, rand, reduced, type RGB } from "@/lib/lumesec/pixel";

/** Fraction of the scale where the amber zone starts. */
const WARN_AT = 0.7;
/** Fraction of the scale where the red zone starts. */
const DANGER_AT = 0.86;
/** Size of a gauge dot; dots are drawn centred on their position. */
const DOT = 2.4;

/** Half-circle pixel gauge for tokens per second with a spring needle and a peak marker. */
class Gauge extends PxBase {
  static readonly observedAttributes = ["max"] as const;

  /** Simulated reading in tokens per second. */
  private value = 70;
  /** Needle position as a fraction of the scale; follows the value on a spring. */
  private angle = 0.35;
  private velocity = 0;
  private peak = 0;
  private peakAt = 0;
  private boost = false;
  private noise = 0;
  /** Time of the last ARIA update; the meter values are written about twice per second. */
  private ariaAt = 0;
  /** Reading last written to the numeral. */
  private shownReading = "";
  /** Monospace font stack for the scale labels, read on layout. */
  private mono = "monospace";
  private readonly dial = this.$(".dial");
  private readonly readout = this.$(".read");
  private readonly numeral = this.$(".num");

  constructor() {
    super(
      `
      :host { display: block; }
      .dial { position: relative; }
      canvas.px { height: 180px; touch-action: none; cursor: pointer; }
      .read { position: absolute; left: 0; right: 0; top: 70px; display: grid; justify-items: center; gap: 5px; pointer-events: none; }
      .num { font-family: var(--_mono); font-size: 40px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; transition: color .2s; }
      .num.hot { color: var(--_danger); }
      .unit { font-family: var(--_mono); font-size: 11px; line-height: 1; color: var(--_muted); }
      .bar { display: flex; justify-content: center; margin-top: 8px; }
      `,
      `<div class="dial" role="meter" aria-label="Output speed in tokens per second" aria-valuemin="0"><canvas class="px"></canvas><div class="read"><span class="num">0</span><span class="unit">tok/s</span></div></div>
        <div class="bar"><button class="pbtn boost" type="button" aria-pressed="false">Hold to boost</button></div>`,
    );
    const button = this.$<HTMLButtonElement>(".boost");
    const canvas = this.$("canvas");
    const on = (e: Event): void => {
      e.preventDefault();
      this.boost = true;
      button.setAttribute("aria-pressed", "true");
      this.kick();
    };
    const off = (): void => {
      this.boost = false;
      button.setAttribute("aria-pressed", "false");
    };
    for (const el of [button, canvas]) {
      el.addEventListener("pointerdown", on);
      for (const type of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(type, off);
    }
    button.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) on(e);
    });
    button.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") off();
    });
    // focus leaving mid-hold (another window, a tab key) ends the boost
    button.addEventListener("blur", off);
  }

  attributeChangedCallback(): void {
    // the scale is read every frame; write the new maximum to the meter at once
    this.ariaAt = -Infinity;
    this.kick();
  }

  /** Full-scale value: the `max` attribute, `200` when missing, invalid or not positive. */
  get max(): number {
    const max = this.num("max", 200);
    return max > 0 ? max : 200;
  }

  set max(value: number) {
    this.setAttribute("max", String(value));
  }

  /** Radius of the outer ring for the current canvas size. */
  private radius(): number {
    return Math.min(this.w / 2 - 26, this.h - 42);
  }

  /** Size the numeral to the dial and place it inside the arc, above the needle pivot. */
  protected override resized(): void {
    this.mono = this.monoFont;
    const R = this.radius();
    const cy = this.h - 20;
    this.numeral.style.fontSize = `${Math.round(clamp(R * 0.3, 26, 44))}px`;
    this.readout.style.top = `${Math.round(cy - R * 0.62 - 4)}px`;
  }

  /** Advance the simulated reading, the needle spring and the peak marker. */
  private step(t: number, dt: number, max: number, still: boolean): void {
    this.noise += (rand(-1, 1) * 40 - this.noise) * Math.min(1, dt * 3);
    const target = clamp((this.boost ? max * 0.93 : max * 0.36) + this.noise + Math.sin(t * 1.7) * 8, 0, max * 1.02);
    this.value += (target - this.value) * Math.min(1, dt * (this.boost ? 2.4 : 1.3));
    const f = clamp(this.value / max, 0, 1);
    if (still) {
      this.angle = f;
      this.velocity = 0;
    } else {
      // under-damped spring, so the needle overshoots
      const stiffness = 150;
      const damping = 2 * Math.sqrt(stiffness) * 0.4;
      this.velocity += (stiffness * (f - this.angle) - damping * this.velocity) * dt;
      this.angle += this.velocity * dt;
    }
    const needle = clamp(this.angle, -0.02, 1.03);
    if (needle > this.peak) {
      this.peak = needle;
      this.peakAt = t;
    } else if (t - this.peakAt > 1.2) {
      this.peak = Math.max(needle, this.peak - dt * 0.25);
    }
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    const { w, h } = this;
    const max = this.max;
    const still = reduced();
    this.step(t, dt, max, still);
    const f = clamp(this.value / max, 0, 1);
    const needle = clamp(this.angle, -0.02, 1.03);
    const reading = String(Math.round(this.value));
    if (reading !== this.shownReading) {
      this.shownReading = reading;
      this.numeral.textContent = reading;
    }
    this.numeral.classList.toggle("hot", f >= DANGER_AT);
    if (t - this.ariaAt > 0.5) {
      this.ariaAt = t;
      this.dial.setAttribute("aria-valuenow", reading);
      this.dial.setAttribute("aria-valuemax", String(max));
      this.dial.setAttribute("aria-valuetext", `${reading} tokens per second`);
    }

    this.clear();
    const cx = w / 2;
    const cy = h - 20;
    const R = this.radius();
    /** A dot centred on the point at `radius` along the arc angle `a`. */
    const arcDot = (a: number, radius: number, color: RGB, alpha: number): void =>
      this.dot(cx + Math.cos(a) * radius - DOT / 2, cy + Math.sin(a) * radius - DOT / 2, color, alpha, DOT);

    const count = Math.max(28, Math.round(R * 0.6));
    for (let ring = 0; ring < 4; ring++) {
      const r = R - ring * 5;
      for (let i = 0; i < count; i++) {
        const u = i / (count - 1);
        const a = Math.PI + Math.PI * u;
        const zone = u >= DANGER_AT ? P.danger : u >= WARN_AT ? P.warn : P.accent;
        let alpha: number;
        let color: RGB;
        if (u <= needle) {
          const edge = Math.max(0, 1 - (needle - u) * 9);
          alpha = 0.45 + 0.4 * (1 - ring / 4) + edge * 0.3;
          color = mix(zone, P.shine, edge * 0.55);
          if (u >= DANGER_AT && !still) alpha *= 0.65 + 0.35 * Math.sin(t * 22 + i);
        } else {
          alpha = u >= WARN_AT ? 0.16 : 0.09;
          color = u >= WARN_AT ? zone : P.fg;
        }
        arcDot(a, r, color, alpha);
      }
    }

    const peakAngle = Math.PI + Math.PI * clamp(this.peak, 0, 1);
    for (let k = 0; k < 3; k++) arcDot(peakAngle, R + 5 + k * 3, P.shine, 0.9 - k * 0.22);

    g.font = `10px ${this.mono}`;
    g.fillStyle = css(P.muted);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.globalAlpha = 0.85;
    for (let k = 0; k <= 4; k++) {
      const a = Math.PI + (Math.PI * k) / 4;
      // the end labels sit level with the baseline, so lift them clear of the arc
      const lift = k === 0 || k === 4 ? 8 : 0;
      g.fillText(String(Math.round((max * k) / 4)), cx + Math.cos(a) * (R + 17), cy + Math.sin(a) * (R + 17) - lift);
    }
    g.globalAlpha = 1;

    const needleAngle = Math.PI + Math.PI * needle;
    const length = R - 18;
    for (let s = 7; s < length; s += 3) {
      arcDot(needleAngle, s, mix(P.fg, P.shine, s / length), 0.5 + (0.5 * s) / length);
    }
    for (let yy = -1; yy <= 1; yy++) {
      for (let xx = -1; xx <= 1; xx++) this.dot(cx + xx * 3 - DOT / 2, cy + yy * 3 - DOT / 2, P.fg, 0.9, DOT);
    }
    return true;
  }
}

define("px-gauge", Gauge);

export { Gauge };

declare global {
  interface HTMLElementTagNameMap {
    "px-gauge": Gauge;
  }
}
