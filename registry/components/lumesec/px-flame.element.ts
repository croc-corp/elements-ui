/**
 * <px-flame> · Temperature fire
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/flame
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-flame.tsx.
 */
import { PxBase, clamp, define, isDark, lerp, mix, rand, reduced, rollText, type RGB } from "@/lib/lumesec/pixel";

/** Events fired by `<px-flame>`. */
export interface FlameEventMap {
  /** Fires when a drag ends and on each handled key press, with the temperature in steps of 0.1. */
  change: CustomEvent<{ value: number }>;
}

/** Upper temperature bound of each word. */
const FLAME_WORDS: readonly (readonly [max: number, word: string])[] = [
  [0.35, "Precise"],
  [0.85, "Balanced"],
  [1.35, "Creative"],
  [9, "Wild"],
];

/** Hottest fire cell value. */
const MAX_HEAT = 24;

/** Fire cell size in px. */
const CELL = 5;

/** Temperature range. */
const MIN = 0;
const MAX = 2;

/** Change of the temperature per arrow key. */
const KEY_STEP: Partial<Record<string, number>> = {
  ArrowRight: 0.1,
  ArrowUp: 0.1,
  ArrowLeft: -0.1,
  ArrowDown: -0.1,
};

/** A spark rising from a hot fire. */
interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** A colour stop of the heat ramp: position in `[0, 1]` and colour. */
type HeatStop = readonly [at: number, color: RGB];

/**
 * Temperature slider drawn as a pixel fire simulation: low values leave embers, high values burn tall and Wild throws
 * sparks.
 */
class Flame extends PxBase {
  static readonly observedAttributes = ["value"] as const;

  /** Temperature from 0 to 2; read from the `value` attribute on connect. */
  private v = 0.9;
  /** Temperature the still picture was grown for under reduced motion; NaN when it needs regrowing. */
  private stillValue = Number.NaN;
  /** Fire steps owed to the 30 Hz simulation clock. */
  private acc = 0;
  private embers: Ember[] = [];
  private drag = false;
  /** Fire grid size in cells. */
  private cols = 0;
  private rows = 0;
  /** Heat per fire cell, row-major; null until the first layout. */
  private fire: Uint8Array | null = null;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      .val { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
      canvas.px { height: 190px; touch-action: none; cursor: ew-resize; border-radius: 10px; }
      `,
      `<div class="head"><span class="lab">Temperature</span><span class="rollslot val"></span></div>
        <canvas class="px" tabindex="0" role="slider" aria-label="Temperature" aria-valuemin="0" aria-valuemax="2"></canvas>`,
    );
    const canvas = this.canvas;
    /** Temperature under the pointer, snapped to 0.1. */
    const valueAt = (e: PointerEvent): number => {
      const r = canvas.getBoundingClientRect();
      return clamp(Math.round(((e.clientX - r.left - 10) / (r.width - 20)) * 20) / 10, MIN, MAX);
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = true;
      this.set(valueAt(e));
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.drag) this.set(valueAt(e));
    });
    const up = (): void => {
      if (!this.drag) return;
      this.drag = false;
      this.emit<{ value: number }>("change", { value: this.v });
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("keydown", (e) => {
      let next: number;
      if (e.key === "Home" || e.key === "End") {
        next = e.key === "End" ? MAX : MIN;
      } else {
        const step = KEY_STEP[e.key];
        if (step == null) return;
        next = Math.round((this.v + step) * 10) / 10;
      }
      e.preventDefault();
      this.set(next);
      this.emit<{ value: number }>("change", { value: this.v });
    });
  }

  protected override init(): void {
    this.update(this.valueAttribute(), true);
  }

  attributeChangedCallback(): void {
    // before the first connect, init() reads the attribute
    if (this.initialized) this.set(this.valueAttribute());
  }

  /** The `value` attribute limited to 0–2, or 0.9 when it is missing or invalid. */
  private valueAttribute(): number {
    return clamp(this.num("value", 0.9), MIN, MAX);
  }

  /** Current temperature from 0 to 2. Setting it works like {@link Flame.set}. */
  get value(): number {
    return this.v;
  }

  set value(value: number) {
    this.set(value);
  }

  private word(v: number): string {
    const match = FLAME_WORDS.find(([max]) => v <= max) ?? FLAME_WORDS[FLAME_WORDS.length - 1];
    return match[1];
  }

  /**
   * Sets the temperature, limited to 0–2, and updates the readout and ARIA values without firing `change`.
   * A value that is not a finite number is ignored.
   */
  set(value: number): void {
    if (!Number.isFinite(value)) return;
    this.update(clamp(value, MIN, MAX), false);
  }

  /** Apply a temperature; `first` shows it without the roll, even when unchanged. */
  private update(v: number, first: boolean): void {
    if (v === this.v && !first) return;
    const dir = v >= this.v ? 1 : -1;
    this.v = v;
    rollText(this.$(".val"), `${v.toFixed(1)} · ${this.word(v)}`, dir, !first);
    this.canvas.setAttribute("aria-valuenow", String(v));
    this.canvas.setAttribute("aria-valuetext", `${v.toFixed(1)}, ${this.word(v)}`);
    this.kick();
  }

  protected override resized(): void {
    this.cols = Math.floor(this.w / CELL);
    // the bottom 36px hold the scale
    this.rows = Math.floor((this.h - 36) / CELL);
    this.fire = new Uint8Array(this.cols * this.rows);
    this.stillValue = Number.NaN;
  }

  /**
   * One step of the classic fire effect: the bottom row is re-seeded with heat (embers only near zero
   * temperature), every cell rises one row with a random sideways drift and cools by a random amount;
   * higher temperatures cool less, so the flames grow taller.
   */
  private step(fire: Uint8Array): void {
    const W = this.cols;
    const H = this.rows;
    const base = this.v <= 0.05 ? 7 : MAX_HEAT;
    const decay = lerp(3.4, 0.85, this.v / 2);
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, W - 1 - x) < 4 ? 0.55 : 1;
      fire[(H - 1) * W + x] = Math.round(base * edge * (0.82 + Math.random() * 0.18));
    }
    for (let y = 1; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const src = y * W + x;
        const heat = fire[src];
        if (!heat) {
          fire[src - W] = 0;
          continue;
        }
        const drift = (Math.random() * 3) | 0;
        const dst = src - W - drift + 1;
        if (dst >= 0) fire[dst] = Math.max(0, heat - Math.floor(Math.random() * (2 * decay + 1)));
      }
    }
  }

  protected override render(t: number, dt: number): boolean {
    const fire = this.fire;
    if (!fire) return false;
    const P = this.P;
    const still = reduced();
    const W = this.cols;
    const H = this.rows;
    if (still) {
      // a still picture: grow the fire to its full height once per temperature, then stop drawing
      if (this.stillValue !== this.v) {
        for (let i = 0; i < H; i++) this.step(fire);
        this.stillValue = this.v;
      }
    } else {
      this.stillValue = Number.NaN;
      this.acc += dt * 30;
      let steps = 0;
      while (this.acc >= 1 && steps < 3) {
        this.acc--;
        this.step(fire);
        steps++;
      }
    }

    const hot: RGB = isDark(P) ? [255, 250, 235] : mix(P.warn, [255, 214, 90], 0.5);
    const stops: readonly HeatStop[] = [
      [0, P.accent],
      [0.3, mix(P.accent, P.danger, 0.6)],
      [0.55, P.danger],
      [0.78, P.warn],
      [1, hot],
    ];
    const ramp: RGB[] = [];
    for (let i = 0; i <= MAX_HEAT; i++) {
      const k = i / MAX_HEAT;
      let j = 1;
      while (j < stops.length - 1 && stops[j][0] < k) j++;
      const [k0, c0] = stops[j - 1];
      const [k1, c1] = stops[j];
      ramp.push(mix(c0, c1, clamp((k - k0) / (k1 - k0), 0, 1)));
    }

    this.clear();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const heat = fire[y * W + x];
        if (heat < 1) continue;
        this.dot(x * CELL + 0.5, y * CELL + 0.5, ramp[heat], Math.min(1, 0.25 + (heat / MAX_HEAT) * 1.4), 4);
      }
    }

    if (this.v >= 1.4 && !still && Math.random() < (this.v - 1.3) * 1.5) {
      this.embers.push({
        x: rand(10, this.w - 10),
        y: H * CELL - rand(20, 70),
        vx: rand(-20, 20),
        vy: rand(-90, -40),
        age: 0,
        life: rand(0.8, 1.6),
      });
    }
    this.embers = this.embers.filter((e) => {
      e.age += dt;
      if (e.age > e.life) return false;
      e.vx += Math.sin(t * 3 + e.y * 0.05) * 40 * dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      this.dot(e.x, e.y, mix(P.warn, hot, 0.5), 1 - e.age / e.life, 2.4);
      return true;
    });

    const sy = this.h - 18;
    const sx0 = 10;
    const sw = this.w - 20;
    for (let k = 0; k <= 20; k++) {
      const x = sx0 + (sw * k) / 20;
      const on = k / 10 <= this.v + 1e-6;
      const big = k % 5 === 0;
      const color = on ? mix(P.accent, P.warn, k / 20) : P.fg;
      this.dot(x - (big ? 2 : 1.4), sy - (big ? 2 : 1.4), color, on ? 0.95 : 0.2, big ? 4 : 2.8);
    }
    const tx = sx0 + (sw * this.v) / 2;
    for (let yy = -2; yy <= 2; yy++) {
      this.dot(tx - 3, sy + yy * 3 - 1.5, P.fg, 1, 3);
      this.dot(tx, sy + yy * 3 - 1.5, P.fg, 1, 3);
    }
    return !still;
  }
}

define("px-flame", Flame);

export { Flame };

declare global {
  interface HTMLElementTagNameMap {
    "px-flame": Flame;
  }
}
