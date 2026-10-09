/**
 * <hf-matrix> · Usage heatmap
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/matrix
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-matrix.tsx.
 *
 * Demo data: The weekday-by-hour message and token counts are synthetic; only `label` can be set. It cannot
 * show your own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import {
  HF,
  bayer,
  clamp,
  define,
  ease3,
  fmtInt,
  lerp,
  mix,
  now,
  pad2,
  reduced,
  vnoise,
  type Point,
  type RGB,
} from "@/lib/lumesec/pixel";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const HOURS = 24;

/** Metric shown: 0 messages, 1 tokens. */
type Metric = 0 | 1;

/** Cell steps per arrow key, as `[hours, days]`. */
const ARROWS: Partial<Record<string, Point>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const WHITE: RGB = [255, 255, 255];

const gaussian = (x: number, center: number, width: number): number => Math.exp(-((x - center) ** 2) / width);

/** Synthetic usage per cell in `[0, 1]`, row-major by day: a weekday working-hours shape with some noise. */
function usage(metric: Metric): number[] {
  return Array.from({ length: DAYS.length * HOURS }, (_, k) => {
    const d = Math.floor(k / HOURS);
    const h = k % HOURS;
    const weekday = d < 5;
    // messages peak mid-morning and mid-afternoon with a lunch dip; tokens peak in the afternoon and evening
    const day =
      metric === 0
        ? gaussian(h, 10.5, 7) + 0.85 * gaussian(h, 15.5, 6) - 0.25 * gaussian(h, 12.5, 0.8)
        : gaussian(h, 14, 14) + 0.7 * gaussian(h, 21, 5);
    return clamp((weekday ? 1 : 0.32) * day * (0.8 + 0.4 * vnoise(h * 0.7 + metric * 9, d * 1.3)) + 0.03, 0, 1);
  });
}

/** Weekday-by-hour usage heatmap in which dot density is the value; hover or arrow keys show a cell's count. */
class HMatrix extends HF {
  private metric: Metric = 0;
  private current: number[] = [];
  /** Values the metric switch eases from; null before the first switch. */
  private from: number[] | null = null;
  private metricAt = 0;
  /** Inspected cell as `[hour, day]`. */
  private selected: Point | null = null;
  /** Eased 0..1 strength of the dimming around the inspected cell. */
  private focusFade = 0;
  private t0 = 0;
  private readonly tip = this.$(".tip");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
      .hd b { font-size: 13.5px; font-weight: 600; }
      .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--_track); }
      .seg button { border: 0; background: none; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 11.5px; color: var(--_muted); cursor: pointer; }
      .seg button[aria-pressed="true"] { background: var(--_surface); color: var(--_fg); box-shadow: 0 1px 2px rgba(0,0,0,.16); }
      .g { display: grid; grid-template-columns: 30px 1fr; column-gap: 6px; }
      .dl { display: grid; grid-template-rows: repeat(7, 1fr); font-size: 10.5px; color: var(--_muted); align-items: center; }
      .box { position: relative; }
      canvas.px { width: 100%; height: 154px; cursor: crosshair; }
      canvas.px:focus-visible { outline: 2px solid var(--_accent); outline-offset: 3px; }
      .hl { grid-column: 2; display: flex; justify-content: space-between; font-size: 10.5px; color: var(--_muted); margin-top: 5px; }
      .tip { position: absolute; transform: translate(-50%, calc(-100% - 8px)); background: var(--_raised); border: 1px solid var(--_border); border-radius: 7px; padding: 4px 8px; font-size: 11.5px; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .12s; box-shadow: 0 4px 14px rgba(0,0,0,.14); z-index: 2; }
      .tip.on { opacity: 1; }
      .lg { display: flex; align-items: center; justify-content: flex-end; gap: 4px; font-size: 10.5px; color: var(--_muted); margin-top: 8px; }
      .lg i { width: 10px; height: 10px; border-radius: 2px; background: color-mix(in srgb, var(--_accent) var(--p), var(--_track)); }
      `,
      `<div class="hd"><b class="ti"></b><div class="seg" role="group" aria-label="Metric"><button type="button" data-m="0" aria-pressed="true">Messages</button><button type="button" data-m="1" aria-pressed="false">Tokens</button></div></div>
        <div class="g"><div class="dl">${DAYS.map((d) => `<span>${d}</span>`).join("")}</div><div class="box"><canvas class="px" tabindex="0" role="img"></canvas><div class="tip" aria-hidden="true"></div><span class="sr" aria-live="polite"></span></div><div class="hl"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></div>
        <div class="lg">Less <i style="--p:8%"></i><i style="--p:30%"></i><i style="--p:55%"></i><i style="--p:80%"></i><i style="--p:100%"></i> More</div>`,
      2,
      0.74,
    );
    this.$$(".seg button").forEach((button) => {
      button.addEventListener("click", () => this.setMetric(button.dataset.m === "1" ? 1 : 0));
    });
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.pick(
        Math.floor(((e.clientX - r.left) / r.width) * HOURS),
        Math.floor(((e.clientY - r.top) / r.height) * DAYS.length),
      );
    });
    canvas.addEventListener("pointerleave", () => this.pick(-1, -1));
    canvas.addEventListener("blur", () => this.pick(-1, -1));
    canvas.addEventListener("keydown", (e) => {
      const step = ARROWS[e.key];
      if (!step) return;
      e.preventDefault();
      // the first press starts from Wednesday 11:00
      const [c, r] = this.selected ?? [11, 2];
      this.pick(clamp(c + step[0], 0, HOURS - 1), clamp(r + step[1], 0, DAYS.length - 1), false, true);
    });
  }

  protected override init(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "When your team uses AI";
    this.current = usage(0);
    this.metricAt = now() - 9;
    this.t0 = now();
    this.$("canvas").setAttribute("aria-label", "Usage heatmap by weekday and hour. Use arrow keys to inspect cells.");
  }

  private setMetric(metric: Metric): void {
    if (metric === this.metric) return;
    this.from = this.values();
    this.metric = metric;
    this.current = usage(metric);
    this.metricAt = now();
    this.$$(".seg button").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.m) === metric));
    });
    if (this.selected) this.pick(this.selected[0], this.selected[1], true);
    this.kick();
  }

  /** Cell values, eased from the previous metric for 0.6 s after a switch. */
  private values(): number[] {
    const e = reduced() ? 1 : ease3((now() - this.metricAt) / 0.6);
    const from = this.from;
    return this.current.map((v, k) => (from ? lerp(from[k], v, e) : v));
  }

  /**
   * Inspect the cell at hour `c` and day `r`; a cell outside the grid hides the tooltip. `announce` also reads the
   * cell out through the live region, for keyboard moves (pointer hover stays quiet).
   */
  private pick(c: number, r: number, force = false, announce = false): void {
    const tip = this.tip;
    if (c < 0 || r < 0 || c > HOURS - 1 || r > DAYS.length - 1) {
      this.selected = null;
      tip.classList.remove("on");
      this.kick();
      return;
    }
    if (!force && this.selected && this.selected[0] === c && this.selected[1] === r) return;
    this.selected = [c, r];
    const v = this.current[r * HOURS + c];
    const scale = this.metric ? 48000 : 420;
    tip.textContent = `${DAYS[r]} ${pad2(c)}:00 · ${fmtInt(v * scale)} ${this.metric ? "tokens" : "messages"}`;
    if (announce) this.$(".sr").textContent = tip.textContent;
    tip.style.left = `${clamp(((c + 0.5) / HOURS) * this.w, 70, this.w - 70)}px`;
    tip.style.top = `${(r / DAYS.length) * this.h}px`;
    tip.classList.add("on");
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const cw = this.w / HOURS;
    const ch = this.h / DAYS.length;
    const v = this.values();
    const selected = this.selected;
    this.focusFade += ((selected ? 1 : 0) - this.focusFade) * Math.min(1, dt * 10);
    const peak = v.indexOf(Math.max(...v));
    const intro = R0 ? 9 : (t - this.t0) * 2;
    F.clear();
    for (let k = 0; k < DAYS.length * HOURS; k++) {
      const c = k % HOURS;
      const r = Math.floor(k / HOURS);
      const x0 = c * cw + 1;
      const y0 = r * ch + 1;
      const w = cw - 2;
      const h = ch - 2;
      // cells appear along the diagonal
      const appear = clamp(intro - (c + r) / 30, 0, 1);
      if (appear <= 0) continue;
      const inCross = selected && (selected[0] === c || selected[1] === r);
      const isSelected = selected && selected[0] === c && selected[1] === r;
      const dim = selected && !inCross ? 1 - 0.45 * this.focusFade : 1;
      const val = v[k] * appear;
      const pulse = k === peak && !R0 ? 0.5 + 0.5 * Math.sin(t * 4) : 0;
      for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < (x0 + w) / pp; i++) {
          const [x, y] = F.xy(i, j);
          if (isSelected && (x - x0 < 1.5 || x0 + w - x < 1.5 || y - y0 < 1.5 || y0 + h - y < 1.5)) {
            F.put(i, j, this.dark ? WHITE : P.fg, 1, 0.6);
            continue;
          }
          // dot density is the value
          if (bayer(i, j) > 0.12 + val * 0.88) {
            F.put(i, j, P.track, dim * 0.9);
            continue;
          }
          const base = mix(P.accent, P.surface, (1 - val) * 0.5);
          const color = mix(base, P.shine, Math.max(0, val - 0.75) * 1.2 + pulse * 0.3);
          const glow = (val > 0.8 ? (val - 0.8) * 2 : 0) + pulse * 0.4 + (isSelected ? 0.3 : 0);
          F.put(i, j, color, dim, glow);
        }
      }
    }
    this.flush(0.85, 4);
    // the peak cell pulses, so the heatmap redraws every frame unless motion is reduced
    return !R0;
  }
}

define("hf-matrix", HMatrix);

export { HMatrix };

declare global {
  interface HTMLElementTagNameMap {
    "hf-matrix": HMatrix;
  }
}
