/**
 * <px-activity> · Activity heatmap
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/activity
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-activity.tsx.
 *
 * Demo data: The daily activity counts are generated from each date; nothing can be set. It cannot show your
 * own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import {
  PxBase,
  checkRadio,
  clamp,
  css,
  define,
  fmtInt,
  hash,
  mix,
  radioKeys,
  reduced,
  rollText,
} from "@/lib/lumesec/pixel";

/** Size of a day cell in px. */
const CELL = 12;
/** Milliseconds per day. */
const DAY_MS = 864e5;
/** Sub-pixels lit per activity level 0–4 (of nine). */
const LIT_PER_LEVEL = [0, 2, 4, 6, 9];

/** The metric the heatmap shows: `0` sessions, `1` tokens. */
export type ActivityMetric = 0 | 1;

/** A day in the grid: week column `c` and weekday row `d` (0 is Sunday). */
interface DayCell {
  c: number;
  d: number;
}

/** A click ripple spreading from a day. */
interface Ripple extends DayCell {
  t0: number;
}

/** Local midnight of today. */
const today = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/** Activity heatmap where each day is nine sub-pixels, so intensity shows as brightness and density. */
class Activity extends PxBase {
  /** Current metric. */
  private metric: ActivityMetric = 0;
  private prevMetric: ActivityMetric = 0;
  /** Time of the last metric switch. */
  private switchedAt = -9;
  /** Number of week columns; 0 until the first layout. */
  private weeks = 0;
  private hovered: DayCell | null = null;
  private ripples: Ripple[] = [];

  constructor() {
    super(
      `
      :host { display: block; position: relative; }
      .head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
      .streak { font-size: 12.5px; color: var(--_muted); }
      .seg { display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--_track); }
      .seg button { border: 0; background: none; padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; color: var(--_muted); cursor: pointer; transition: background-color .25s, color .25s; }
      .seg button[aria-checked="true"] { background: var(--_surface); color: var(--_fg); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
      canvas.px { height: 86px; cursor: pointer; }
      .tip {
        position: absolute; pointer-events: none; padding: 4px 8px; border-radius: 6px; background: var(--_fg); color: var(--_surface);
        font-size: 11.5px; white-space: nowrap; transform: translate(-50%, calc(-100% - 8px)); z-index: 3;
      }
      `,
      `<div class="head"><span class="rollslot streak" aria-live="polite"></span><div class="seg" role="radiogroup" aria-label="Metric"><button type="button" role="radio" data-m="0">Sessions</button><button type="button" role="radio" data-m="1">Tokens</button></div></div>
        <canvas class="px" role="img"></canvas><div class="tip" hidden></div>`,
    );
    const buttons = this.$$(".seg button");
    for (const button of buttons) {
      button.addEventListener("click", () => this.setMetric(Number(button.dataset.m) === 1 ? 1 : 0));
    }
    // with two metrics every arrow key switches to the other one
    radioKeys(
      this.$(".seg"),
      () => buttons,
      () => this.metric,
      (index) => this.setMetric(index === 1 ? 1 : 0),
    );
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      this.hovered = this.cellAt(e);
      this.updateTip();
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hovered = null;
      this.updateTip();
      this.kick();
    });
    canvas.addEventListener("click", (e) => {
      const cell = this.cellAt(e);
      if (cell) {
        this.ripples.push({ ...cell, t0: this.t });
        this.kick();
      }
    });
  }

  protected override init(): void {
    this.applyMetric(0, true);
  }

  protected override resized(): void {
    this.weeks = Math.max(8, Math.min(40, Math.floor((this.w + 2) / CELL)));
    this.summarize(false);
  }

  /** The day under the pointer; null outside the grid and for days after today. */
  private cellAt(e: MouseEvent): DayCell | null {
    const canvas = this.cv;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const c = Math.floor((e.clientX - r.left) / CELL);
    const d = Math.floor((e.clientY - r.top) / CELL);
    if (c < 0 || c >= this.weeks || d < 0 || d > 6 || this.isFuture(c, d)) return null;
    return { c, d };
  }

  /** The grid ends at today: later days of the current week are empty. */
  private isFuture(c: number, d: number): boolean {
    return c === this.weeks - 1 && d > today().getDay();
  }

  private dateAt(c: number, d: number): Date {
    const day = today();
    const back = (this.weeks - 1 - c) * 7 + (day.getDay() - d);
    return new Date(day.getTime() - back * DAY_MS);
  }

  /** Demo activity in `[0, 1]`, derived deterministically from the date; weekdays are busier than weekends. */
  private raw(metric: ActivityMetric, c: number, d: number): number {
    const key = Math.floor(this.dateAt(c, d).getTime() / DAY_MS);
    const weekday = d >= 1 && d <= 5 ? 1 : 0.4;
    return clamp(hash(key * 1.37 + metric * 91.3) * 1.25 * weekday * (0.65 + 0.35 * Math.sin(key / 9)), 0, 1);
  }

  /** Activity level 0–4. */
  private level(metric: ActivityMetric, c: number, d: number): number {
    const v = this.raw(metric, c, d);
    return v < 0.14 ? 0 : Math.min(4, Math.ceil(v * 4));
  }

  /** Sessions, or thousands of tokens, on a day. */
  private valueAt(metric: ActivityMetric, c: number, d: number): number {
    const v = this.raw(metric, c, d);
    return metric === 0 ? Math.round(v * 14) : Math.round(v * 420);
  }

  /** Switches the metric: `0` for sessions, `1` for tokens. Other values are ignored. */
  setMetric(index: ActivityMetric): void {
    if (index !== 0 && index !== 1) return;
    this.applyMetric(index, false);
  }

  /** Switch to `metric`; the first call (from `init`) skips the flip wave and the roll. */
  private applyMetric(metric: ActivityMetric, first: boolean): void {
    if (metric === this.metric && !first) return;
    this.prevMetric = first ? metric : this.metric;
    this.metric = metric;
    this.switchedAt = first ? -9 : this.t;
    // the buttons are in metric order
    checkRadio(this.$$(".seg button"), metric);
    this.summarize(!first);
    this.updateTip();
    this.kick();
  }

  /** Update the longest streak and total, and the canvas label. */
  private summarize(animate: boolean): void {
    if (!this.weeks) return;
    let best = 0;
    let run = 0;
    let total = 0;
    for (let c = 0; c < this.weeks; c++) {
      for (let d = 0; d < 7; d++) {
        if (this.isFuture(c, d)) continue;
        total += this.valueAt(this.metric, c, d);
        if (this.level(this.metric, c, d) > 0) {
          run++;
          best = Math.max(best, run);
        } else {
          run = 0;
        }
      }
    }
    const totalText = this.metric === 0 ? `${fmtInt(total)} sessions` : `${fmtInt(total / 1000)}M tokens`;
    rollText(this.$(".streak"), `Longest streak ${best} days · ${totalText}`, this.metric ? 1 : -1, animate);
    this.cv?.setAttribute("aria-label", `Activity heatmap, ${totalText}, longest streak ${best} days`);
  }

  private updateTip(): void {
    const tip = this.$(".tip");
    const canvas = this.cv;
    if (!this.hovered || !canvas) {
      tip.hidden = true;
      return;
    }
    const { c, d } = this.hovered;
    const date = this.dateAt(c, d);
    const v = this.valueAt(this.metric, c, d);
    const day = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    tip.textContent = `${day} · ${this.metric ? `${v}k tokens` : `${v} sessions`}`;
    tip.style.left = `${clamp(c * CELL + 5, 60, this.w - 60)}px`;
    tip.style.top = `${canvas.offsetTop + d * CELL}px`;
    tip.hidden = false;
  }

  protected override render(t: number): boolean {
    const g = this.ctx;
    if (!this.weeks || !g) return false;
    const P = this.P;
    const still = reduced();
    this.clear();
    this.ripples = this.ripples.filter((r) => t - r.t0 < 1.4);
    let busy = this.ripples.length > 0;
    for (let c = 0; c < this.weeks; c++) {
      for (let d = 0; d < 7; d++) {
        if (this.isFuture(c, d)) continue;
        // cells flip in a diagonal wave: old level folding flat, then the new one opening
        const m = still ? 1 : clamp((t - this.switchedAt - (c + d) * 0.018) / 0.2, 0, 1);
        if (m < 1) busy = true;
        const level = m < 0.5 ? this.level(this.prevMetric, c, d) : this.level(this.metric, c, d);
        const fold = m < 0.5 ? 1 - 2 * m : 2 * m - 1;
        let boost = 0;
        for (const r of this.ripples) {
          const age = t - r.t0;
          const dist = Math.hypot(c - r.c, d - r.d);
          boost += Math.exp(-((dist - age * 16) ** 2) / 1.6) * (1 - age / 1.4);
        }
        const inCross = this.hovered !== null && (this.hovered.c === c || this.hovered.d === d);
        const isHovered = this.hovered !== null && this.hovered.c === c && this.hovered.d === d;
        const scale = isHovered ? 1.22 : 1;
        const x0 = c * CELL + 5;
        const y0 = d * CELL + 5;
        const lit = Math.min(9, LIT_PER_LEVEL[level] + Math.round(boost * 6));
        // a stable per-day order decides which sub-pixels light first
        const order = Math.floor(hash(c * 17 + d * 3) * 9);
        for (let s = 0; s < 9; s++) {
          const sx = (s % 3) - 1;
          const sy = Math.floor(s / 3) - 1;
          const on = (s + order) % 9 < lit;
          const x = x0 + sx * 3.4 * scale - 1.3;
          const y = y0 + sy * 3.4 * scale * fold - 1.3 * fold;
          const alpha = on
            ? 0.45 + 0.13 * level + boost * 0.4 + (inCross ? 0.1 : 0)
            : 0.08 + (inCross ? 0.06 : 0);
          g.globalAlpha = clamp(alpha, 0, 1);
          g.fillStyle = css(on ? mix(P.accent, P.shine, Math.min(1, boost * 0.8 + (isHovered ? 0.3 : 0))) : P.fg);
          g.fillRect(x, y, 2.6, 2.6 * Math.max(0.1, fold));
        }
      }
    }
    g.globalAlpha = 1;
    return busy;
  }
}

define("px-activity", Activity);

export { Activity };

declare global {
  interface HTMLElementTagNameMap {
    "px-activity": Activity;
  }
}
