/**
 * <px-eq> · Equalizer
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/eq
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-eq.tsx.
 *
 * Demo data: The spectrum behind the bands is simulated; only the bands are a real control. It cannot show
 * your own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { PxBase, clamp, css, define, hash, lerp, mix, now, reduced } from "@/lib/lumesec/pixel";

/** Name of an equalizer preset. */
export type EqPreset = "Flat" | "Bass" | "Vocal" | "Air";

/** Detail of the `change` event: seven target gains in dB, and the preset when one was chosen. */
export interface EqChangeDetail {
  gains: number[];
  preset?: EqPreset;
}

/** Events fired by `<px-eq>`. */
export interface EQEventMap {
  /**
   * Fires when a drag ends, on each ArrowUp or ArrowDown press, on a double-click reset and when a preset is
   * chosen. `gains` holds seven target values in dB; `preset` is present only for presets.
   */
  change: CustomEvent<EqChangeDetail>;
}

const EQ_BANDS = ["60", "150", "400", "1k", "2.4k", "6k", "15k"] as const;

const PRESET_NAMES: readonly EqPreset[] = ["Flat", "Bass", "Vocal", "Air"];

const EQ_PRESETS: Readonly<Record<EqPreset, readonly number[]>> = {
  Flat: [0, 0, 0, 0, 0, 0, 0],
  Bass: [9, 6, 2, 0, -1, 0, 1],
  Vocal: [-3, -1, 2, 6, 5, 2, 0],
  Air: [-2, -2, 0, 1, 3, 7, 10],
};

/** Gain range in dB, symmetric around 0. */
const MAX_GAIN = 12;
/** Top and bottom margin of the gain area in px. */
const TOP = 14;
const BOTTOM_GAP = 34;

/**
 * Seven-band pixel equalizer with spring-loaded bands, a smooth curve and a live spectrum behind; presets cascade band
 * by band.
 */
class EQ extends PxBase {
  /** Displayed gain per band in dB, springing towards {@link EQ.targets}. */
  private readonly gains = [0, 0, 2, 4, 3, 1, 2];
  /** Target gain per band in dB. */
  private readonly targets = [...this.gains];
  private readonly velocities: number[] = new Array<number>(7).fill(0);
  /** Per band: time before which the band waits (preset cascade). */
  private readonly delay: number[] = new Array<number>(7).fill(0);
  /** Selected band index. */
  private selected = 3;
  /** Smoothed height of each background spectrum column, 0 to 1. */
  private readonly spectrum: number[] = new Array<number>(64).fill(0);
  private drag = false;
  /** Monospace font stack for the labels, read on layout. */
  private mono = "monospace";
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      canvas.px { height: 196px; touch-action: none; cursor: ns-resize; border-radius: 10px; }
      .bar { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; justify-content: center; }
      .bar .pbtn { height: 28px; }
      `,
      `<canvas class="px" tabindex="0" role="group" aria-label="Equalizer. Left and right pick a band, up and down change its gain."></canvas><span class="sr" aria-live="polite"></span><div class="bar"></div>`,
    );
    const bar = this.$(".bar");
    for (const name of PRESET_NAMES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pbtn";
      button.textContent = name;
      button.dataset.k = name;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => this.preset(name));
      bar.appendChild(button);
    }
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = true;
      this.selected = this.bandAt(e);
      this.setFrom(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.drag) this.setFrom(e);
    });
    const up = (): void => {
      if (!this.drag) return;
      this.drag = false;
      this.emitChange();
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("dblclick", (e) => {
      const i = this.bandAt(e);
      this.targets[i] = 0;
      this.delay[i] = now();
      this.kick();
      this.emitChange();
    });
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        this.selected = clamp(this.selected + (e.key === "ArrowRight" ? 1 : -1), 0, 6);
        this.announce();
        this.kick();
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const step = e.key === "ArrowUp" ? 1 : -1;
        this.targets[this.selected] = clamp(this.targets[this.selected] + step, -MAX_GAIN, MAX_GAIN);
        this.announce();
        this.kick();
        this.emitChange();
      }
    });
  }

  /** Report the selected band and its gain to assistive technology; the canvas only draws them. */
  private announce(): void {
    this.$(".sr").textContent = `${EQ_BANDS[this.selected]} Hz, ${this.gainText(this.selected)} dB`;
  }

  /** Target gain of band `i` with a sign and one decimal, such as `+4.0`. */
  private gainText(i: number): string {
    return (this.targets[i] > 0 ? "+" : "") + this.targets[i].toFixed(1);
  }

  /** Fire `change`; a change by hand (no preset) clears the pressed preset. */
  private emitChange(preset?: EqPreset): void {
    if (!preset) {
      for (const button of this.$$(".bar .pbtn")) button.setAttribute("aria-pressed", "false");
    }
    const detail: EqChangeDetail = preset ? { preset, gains: [...this.targets] } : { gains: [...this.targets] };
    this.emit<EqChangeDetail>("change", detail);
  }

  protected override resized(): void {
    this.mono = this.monoFont;
  }

  /** Centre x of band `i`. */
  private colX(i: number): number {
    const pad = 26;
    return pad + (i * (this.w - pad * 2)) / 6;
  }

  /** y of a gain in dB. */
  private yOf(gain: number): number {
    return lerp(this.h - BOTTOM_GAP, TOP, (gain + MAX_GAIN) / (2 * MAX_GAIN));
  }

  /** The band whose column is nearest to the pointer. */
  private bandAt(e: MouseEvent): number {
    const x = e.clientX - this.canvas.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < 7; i++) {
      if (Math.abs(this.colX(i) - x) < Math.abs(this.colX(best) - x)) best = i;
    }
    return best;
  }

  /** Set the selected band to the gain under the pointer, in 0.5 dB steps. */
  private setFrom(e: PointerEvent): void {
    const y = e.clientY - this.canvas.getBoundingClientRect().top;
    const top = TOP;
    const bottom = this.h - BOTTOM_GAP;
    const gain = ((bottom - y) / (bottom - top)) * 2 * MAX_GAIN - MAX_GAIN;
    this.targets[this.selected] = clamp(Math.round(gain * 2) / 2, -MAX_GAIN, MAX_GAIN);
    this.delay[this.selected] = 0;
    this.kick();
  }

  /** Applies a preset with a left-to-right cascade and fires `change`. An unknown name is ignored. */
  preset(name: EqPreset): void {
    if (!PRESET_NAMES.includes(name)) return;
    const start = now();
    EQ_PRESETS[name].forEach((v, i) => {
      this.targets[i] = v;
      this.delay[i] = start + i * 0.05;
    });
    for (const button of this.$$(".bar .pbtn")) {
      button.setAttribute("aria-pressed", String(button.dataset.k === name));
    }
    this.emitChange(name);
    this.kick();
  }

  /** Displayed gain at x: a cosine blend between neighbouring bands, flat beyond the outer ones. */
  private gainAt(x: number): number {
    if (x <= this.colX(0)) return this.gains[0];
    if (x >= this.colX(6)) return this.gains[6];
    for (let i = 0; i < 6; i++) {
      const a = this.colX(i);
      const b = this.colX(i + 1);
      if (x <= b) {
        const u = (x - a) / (b - a);
        const s = (1 - Math.cos(u * Math.PI)) / 2;
        return lerp(this.gains[i], this.gains[i + 1], s);
      }
    }
    return 0;
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const still = reduced();
    const w = this.w;
    const h = this.h;
    for (let i = 0; i < 7; i++) {
      if (t < this.delay[i]) continue;
      if (still) {
        this.gains[i] = this.targets[i];
        this.velocities[i] = 0;
        continue;
      }
      const stiffness = 260;
      const damping = 2 * Math.sqrt(stiffness) * 0.55;
      this.velocities[i] += (stiffness * (this.targets[i] - this.gains[i]) - damping * this.velocities[i]) * dt;
      this.gains[i] += this.velocities[i] * dt;
    }

    this.clear();
    const y0 = this.yOf(0);
    const cols = Math.floor(w / 6);
    // whether a spectrum column is still easing towards its height
    let easing = false;
    for (let c = 0; c < cols; c++) {
      const x = c * 6 + 3;
      const gain = this.gainAt(x);
      const flicker = still ? 0 : 0.25 * hash(c * 7.3 + Math.floor(t * 12));
      const base = 0.45 + 0.35 * Math.sin(c * 0.37) * Math.cos(c * 0.13) + flicker;
      const target = clamp(base * (1 + gain / 14), 0, 1);
      const previous = this.spectrum[c] || 0;
      this.spectrum[c] = previous + (target - previous) * Math.min(1, dt * 14);
      if (Math.abs(target - this.spectrum[c]) > 0.002) easing = true;
      const cells = Math.round(this.spectrum[c] * 10);
      for (let r = 0; r < cells; r++) this.dot(x - 1.2, h - 36 - r * 5, P.fg, 0.07 + r * 0.008, 2.4);
    }
    for (let x = 4; x < w; x += 6) this.dot(x - 1, y0 - 1, P.fg, 0.25, 2);
    for (let x = 2; x < w - 1; x += 3) {
      const y = this.yOf(this.gainAt(x));
      this.dot(x - 1.2, y - 1.2, mix(P.accent, P.shine, 0.35), 1, 2.4);
      // faint fill between the curve and the 0 dB line, every other column
      const dir = y < y0 ? 1 : -1;
      if (x % 6 === 2) {
        for (let yy = y + dir * 5; dir > 0 ? yy < y0 : yy > y0; yy += dir * 5) {
          this.dot(x - 1, yy - 1, P.accent, 0.22, 2);
        }
      }
    }

    ctx.font = `10px ${this.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < 7; i++) {
      const x = this.colX(i);
      const y = this.yOf(this.gains[i]);
      const selected = i === this.selected;
      const knob = selected ? P.shine : P.accent;
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) this.dot(x + xx * 4 - 1.6, y + yy * 4 - 1.6, knob, 1, 3.2);
      }
      ctx.globalAlpha = selected ? 1 : 0.8;
      ctx.fillStyle = css(selected ? P.fg : P.muted);
      ctx.fillText(EQ_BANDS[i], x, h - 12);
      if (selected) ctx.fillText(`${this.gainText(i)} dB`, clamp(x, 26, w - 26), Math.max(12, y - 14));
    }
    ctx.globalAlpha = 1;
    if (!still) return true;
    // under reduced motion nothing flickers: draw until the cascade and the spectrum have settled
    return easing || this.delay.some((at) => t < at);
  }
}

define("px-eq", EQ);

export { EQ };

declare global {
  interface HTMLElementTagNameMap {
    "px-eq": EQ;
  }
}
