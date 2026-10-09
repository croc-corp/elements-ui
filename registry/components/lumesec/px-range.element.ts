/**
 * <px-range> · Histogram range
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/range
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-range.tsx.
 *
 * Demo data: The response-time histogram and its run counts are invented; only the selected range is a real
 * control. It cannot show your own data yet; use it as a template and replace the invented data before it
 * shows anything real.
 */
import { PxBase, clamp, css, define, fmtInt, hash, mix, reduced, rollText } from "@/lib/lumesec/pixel";

/** A thumb of the range: the minimum (`lo`) or the maximum (`hi`). */
export type RangeThumb = "lo" | "hi";

/** Events fired by `<px-range>`. */
export interface RangeEventMap {
  /**
   * Fires when a drag ends and on each handled key press. Values are in milliseconds, in steps of 100; `max` of 4000
   * means open-ended (4,000+ ms).
   */
  change: CustomEvent<{ min: number; max: number }>;
}

/** Number of 100 ms buckets. */
const BUCKETS = 40;
/** Pixel rows of the tallest column. */
const ROWS = 14;
/** Fill speed of a column entering or leaving the range, per second. */
const FILL_RATE = 4.5;

/** Initial range: 500 to 1,700 ms. */
const INITIAL_LO = 5;
const INITIAL_HI = 17;

/** Arrow keys and the number of buckets each moves a thumb. */
const KEY_STEPS: Partial<Record<string, number>> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

/** Demo histogram: a main mode around 1 s and a smaller one around 2.5 s, with stable per-bucket variation. */
const COUNTS: readonly number[] = Array.from({ length: BUCKETS }, (_, i) => {
  const x = i / (BUCKETS - 1);
  const density =
    Math.exp(-(((x - 0.24) / 0.13) ** 2)) + 0.38 * Math.exp(-(((x - 0.62) / 0.09) ** 2)) + 0.05;
  return Math.round(density * 210 * (0.85 + 0.3 * hash(i * 9.1)));
});
const MAX_COUNT = Math.max(...COUNTS);

/** Label of a bucket boundary; the last one is open-ended. */
const msLabel = (i: number): string => (i >= BUCKETS ? "4,000+ ms" : `${fmtInt(i * 100)} ms`);

/** CSS left offset of a bucket boundary. */
const percent = (i: number): string => `${(i / BUCKETS) * 100}%`;

/** Two-thumb response-time filter over a pixel histogram. */
class Range extends PxBase {
  /** Bucket index of the minimum thumb. */
  private lo = INITIAL_LO;
  /** Bucket index of the maximum thumb (exclusive). */
  private hi = INITIAL_HI;
  /** Fill of each column, from 0 (outside the range) to 1 (inside); animates towards its target. */
  private readonly lit: number[] = COUNTS.map((_, i) => (i >= INITIAL_LO && i < INITIAL_HI ? 1 : 0));
  /** Run count shown last, for the roll direction. */
  private lastCount = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; gap: 10px; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      .cnt { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
      canvas.px { height: 88px; }
      .track { position: relative; height: 24px; margin-top: 6px; touch-action: none; cursor: pointer; }
      .rail { position: absolute; left: 0; right: 0; top: 11px; height: 2px; background: var(--_track); border-radius: 1px; }
      .sel { position: absolute; top: 11px; height: 2px; background: var(--_accent); border-radius: 1px; }
      .th {
        position: absolute; top: 3px; width: 18px; height: 18px; margin-left: -9px; border-radius: 50%; border: 0; padding: 0;
        background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35), 0 0 0 2px var(--_accent); cursor: grab; touch-action: none; transition: transform .15s;
      }
      .th:active { transform: scale(1.18); cursor: grabbing; }
      .ends { display: flex; justify-content: space-between; font-family: var(--_mono); font-size: 12px; color: var(--_muted); margin-top: 6px; }
      `,
      `<div class="head"><span class="lab">Response time</span><span class="rollslot cnt" aria-live="polite"></span></div>
        <canvas class="px" role="img" aria-label="Histogram of response times"></canvas>
        <div class="track"><div class="rail"></div><div class="sel"></div>
          <button class="th lo" type="button" role="slider" aria-label="Minimum response time"></button>
          <button class="th hi" type="button" role="slider" aria-label="Maximum response time"></button></div>
        <div class="ends"><span class="rollslot vlo"></span><span class="rollslot vhi"></span></div>`,
    );
    const track = this.$(".track");
    const indexAt = (e: PointerEvent): number => {
      const r = track.getBoundingClientRect();
      return clamp(Math.round(((e.clientX - r.left) / r.width) * BUCKETS), 0, BUCKETS);
    };
    let dragging: RangeThumb | null = null;
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      track.setPointerCapture(e.pointerId);
      const i = indexAt(e);
      const target = e.target instanceof Element ? e.target.classList : null;
      // a press on a thumb drags it; a press on the track moves the nearer thumb there
      if (target?.contains("hi")) dragging = "hi";
      else if (target?.contains("lo")) dragging = "lo";
      else dragging = Math.abs(i - this.lo) <= Math.abs(i - this.hi) ? "lo" : "hi";
      this.$(`.${dragging}`).focus({ preventScroll: true });
      this.set(dragging, i);
    });
    track.addEventListener("pointermove", (e) => {
      if (dragging) this.set(dragging, indexAt(e));
    });
    const up = (): void => {
      if (!dragging) return;
      dragging = null;
      this.reportChange();
    };
    track.addEventListener("pointerup", up);
    track.addEventListener("pointercancel", up);
    for (const thumb of ["lo", "hi"] as const) {
      this.$(`.${thumb}`).addEventListener("keydown", (e) => {
        let index: number;
        if (e.key === "Home") index = 0;
        else if (e.key === "End") index = BUCKETS;
        else {
          const step = KEY_STEPS[e.key];
          if (!step) return;
          index = this[thumb] + step;
        }
        e.preventDefault();
        // set() clamps, so Home and End stop at the other thumb
        this.set(thumb, index);
        this.reportChange();
      });
    }
  }

  protected override init(): void {
    this.sync(false);
  }

  /**
   * Moves a thumb to bucket `index` (0 to 40, 100 ms each), rounded and clamped so the thumbs never cross. Does
   * not fire `change`. An unknown thumb or an index that is not a finite number is ignored.
   */
  set(which: RangeThumb, index: number): void {
    if ((which !== "lo" && which !== "hi") || !Number.isFinite(index)) return;
    const bucket = Math.round(index);
    const i = which === "lo" ? clamp(bucket, 0, this.hi - 1) : clamp(bucket, this.lo + 1, BUCKETS);
    if (this[which] === i) return;
    const dir = i > this[which] ? 1 : -1;
    this[which] = i;
    this.sync(true, dir);
    this.kick();
  }

  private reportChange(): void {
    this.emit<{ min: number; max: number }>("change", { min: this.lo * 100, max: this.hi * 100 });
  }

  /** Position the thumbs and the selection, and update the labels, the run count and the slider values. */
  private sync(animate: boolean, dir = 1): void {
    const sel = this.$(".sel");
    this.$(".lo").style.left = percent(this.lo);
    this.$(".hi").style.left = percent(this.hi);
    sel.style.left = percent(this.lo);
    sel.style.width = `${((this.hi - this.lo) / BUCKETS) * 100}%`;
    rollText(this.$(".vlo"), msLabel(this.lo), dir, animate);
    rollText(this.$(".vhi"), msLabel(this.hi), dir, animate);
    let count = 0;
    for (let i = this.lo; i < this.hi; i++) count += COUNTS[i];
    rollText(this.$(".cnt"), `${fmtInt(count)} runs`, count >= this.lastCount ? 1 : -1, animate);
    this.lastCount = count;
    // each thumb's range ends one bucket before the other thumb
    const bounds: Record<RangeThumb, [min: number, max: number]> = {
      lo: [0, this.hi - 1],
      hi: [this.lo + 1, BUCKETS],
    };
    for (const thumb of ["lo", "hi"] as const) {
      const button = this.$(`.${thumb}`);
      button.setAttribute("aria-valuemin", String(bounds[thumb][0] * 100));
      button.setAttribute("aria-valuemax", String(bounds[thumb][1] * 100));
      button.setAttribute("aria-valuenow", String(this[thumb] * 100));
      button.setAttribute("aria-valuetext", msLabel(this[thumb]));
    }
  }

  protected override render(_t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    const { w, h } = this;
    const columnW = w / BUCKETS;
    const pitch = h / ROWS;
    const barW = Math.max(1.5, Math.min(columnW - 2, 5));
    const still = reduced();
    let moving = false;
    this.clear();
    for (let i = 0; i < BUCKETS; i++) {
      const target = i >= this.lo && i < this.hi ? 1 : 0;
      if (still) {
        this.lit[i] = target;
      } else {
        const d = target - this.lit[i];
        if (Math.abs(d) > 0.001) {
          this.lit[i] += clamp(d, -dt * FILL_RATE, dt * FILL_RATE);
          moving = true;
        }
      }
      const height = Math.max(1, Math.round((COUNTS[i] / MAX_COUNT) * ROWS));
      const x = i * columnW + (columnW - barW) / 2;
      // the fill rises from the bottom; its top row is highlighted
      const fillTop = this.lit[i] * (height + 2);
      for (let r = 0; r < height; r++) {
        const y = h - (r + 1) * pitch + 0.8;
        const on = r < fillTop - 1;
        const top = on && r >= fillTop - 2.2;
        g.globalAlpha = on ? 0.92 : 0.14;
        g.fillStyle = css(on ? mix(P.accent, P.shine, top ? 0.55 : (r / ROWS) * 0.25) : P.fg);
        g.fillRect(x, y, barW, pitch - 1.6);
      }
    }
    g.globalAlpha = 1;
    return moving;
  }
}

define("px-range", Range);

export { Range };

declare global {
  interface HTMLElementTagNameMap {
    "px-range": Range;
  }
}
