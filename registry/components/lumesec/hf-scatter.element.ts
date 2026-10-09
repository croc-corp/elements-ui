/**
 * <hf-scatter> · Scatter with brush
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/scatter
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-scatter.tsx.
 *
 * Demo data: The 270 runs in three model groups are seeded random points; only `label` can be set. It cannot
 * show your own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import {
  HF,
  bayer,
  clamp,
  define,
  ease3,
  fmtInt,
  localPoint,
  mix,
  now,
  reduced,
  rollText,
  type PaletteKey,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-scatter>`. */
export interface HScatterEventMap {
  /**
   * A brush drag ended. `count` is the number of visible points inside the box; a click without dragging clears
   * the brush and reports 0.
   */
  select: CustomEvent<{ count: number }>;
}

/** Legend groups: name and palette colour. */
const GROUPS: readonly (readonly [name: string, color: PaletteKey])[] = [
  ["Large", "accent"],
  ["Medium", "ok"],
  ["Small", "warn"],
];

/** Point cloud per group: mean x and y, spread x and y, count. */
const CLUSTERS: readonly (readonly [mx: number, my: number, sx: number, sy: number, n: number])[] = [
  [0.55, 0.55, 0.16, 0.16, 70],
  [0.32, 0.36, 0.14, 0.14, 110],
  [0.14, 0.18, 0.07, 0.1, 90],
];

/** A run: latency `x` and output `y` as fractions of the axes, its group and an intro delay. */
interface ScatterPoint {
  x: number;
  y: number;
  g: number;
  /** Random 0..1 that staggers the intro. */
  d: number;
}

/** The brush box in canvas pixels; `live` while the pointer is down. */
interface Brush {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  live: boolean;
}

const WHITE: RGB = [255, 255, 255];

/** Park–Miller generator: the same seed gives the same sequence in `(0, 1)`. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Median of `values`, or 0 when empty. */
function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Scatter plot of runs with a drag-to-select brush; the summary rolls to the selection's medians. */
class HScatter extends HF {
  private readonly points: ScatterPoint[] = [];
  private brush: Brush | null = null;
  /** Legend state per group, 1 shown and 0 hidden. */
  private readonly shown = [1, 1, 1];
  /** Eased visibility per group. */
  private fades = [1, 1, 1];
  private t0 = 0;
  private lastSummary = "";
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
      .hd b { display: block; font-size: 13.5px; font-weight: 600; }
      .sum { font-size: 12px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      .lg { display: flex; gap: 6px; }
      .lg button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--_border); background: var(--_surface); color: var(--_fg); border-radius: 99px; height: 26px; padding: 0 10px; font-size: 11.5px; font-weight: 500; cursor: pointer; }
      .lg button i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
      .lg button[aria-pressed="false"] { opacity: .45; }
      .box { position: relative; padding-left: 34px; }
      canvas.px { width: 100%; height: 190px; cursor: crosshair; touch-action: none; }
      .ya { position: absolute; left: 0; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: space-between; font-size: 10.5px; color: var(--_muted); text-align: right; width: 28px; }
      .xa { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--_muted); margin: 4px 0 0 34px; }
      .xt { text-align: center; font-size: 11px; color: var(--_muted); margin-top: 2px; }
      `,
      `<div class="hd"><div><b class="ti"></b><span class="rollslot sum"></span><span class="sr" aria-live="polite"></span></div><div class="lg">${GROUPS.map(([n, c], k) => `<button type="button" data-g="${k}" aria-pressed="true" style="--c:var(--_${c})"><i></i>${n}</button>`).join("")}</div></div>
        <div class="box"><div class="ya"><span>4k</span><span>2k</span><span>0</span></div><canvas class="px" role="img"></canvas></div><div class="xa"><span>0s</span><span>2s</span><span>4s</span></div><div class="xt">latency → · tokens out ↑ · drag to select</div>`,
      2,
      0.72,
    );
    const canvas = this.canvas;
    /** The pointer in the canvas's CSS pixels, clamped to the plot. */
    const local = (e: PointerEvent): [x: number, y: number] => {
      const [x, y] = localPoint(canvas, e);
      return [clamp(x, 0, this.w), clamp(y, 0, this.h)];
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // throws for a pointer that is no longer active; brushing works without capture
      }
      const [x, y] = local(e);
      this.brush = { x0: x, y0: y, x1: x, y1: y, live: true };
      this.summarize();
      this.kick();
    });
    canvas.addEventListener("pointermove", (e) => {
      const brush = this.brush;
      if (!brush?.live) return;
      [brush.x1, brush.y1] = local(e);
      this.summarize();
      this.kick();
    });
    const up = (): void => {
      const brush = this.brush;
      if (!brush?.live) return;
      brush.live = false;
      // a click without dragging clears the brush
      if (Math.abs(brush.x1 - brush.x0) < 4 && Math.abs(brush.y1 - brush.y0) < 4) this.brush = null;
      this.summarize(true);
      this.emit<{ count: number }>("select", { count: this.selected().length });
      this.kick();
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    this.$$(".lg button").forEach((button) => {
      button.addEventListener("click", () => {
        const g = Number(button.dataset.g);
        this.shown[g] = this.shown[g] ? 0 : 1;
        button.setAttribute("aria-pressed", String(!!this.shown[g]));
        this.summarize(true);
        this.kick();
      });
    });
  }

  protected override init(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Latency vs. output";
    const rnd = seededRandom(7);
    // sum of four uniforms: a cheap bell curve around 0
    const gauss = (): number => {
      let u = 0;
      for (let k = 0; k < 4; k++) u += rnd();
      return u - 2;
    };
    CLUSTERS.forEach(([mx, my, sx, sy, n], g) => {
      for (let k = 0; k < n; k++) {
        const x = clamp(mx + gauss() * sx + 0.25 * (rnd() - 0.5) * 0.3, 0.01, 0.99);
        const y = clamp(my + (x - mx) * 0.7 + gauss() * sy, 0.01, 0.99);
        this.points.push({ x, y, g, d: rnd() });
      }
    });
    this.t0 = now();
    this.summarize();
  }

  /** Visible points inside the brush; empty without a brush. */
  private selected(): ScatterPoint[] {
    const b = this.brush;
    if (!b) return [];
    const xa = Math.min(b.x0, b.x1) / this.w;
    const xb = Math.max(b.x0, b.x1) / this.w;
    const ya = 1 - Math.max(b.y0, b.y1) / this.h;
    const yb = 1 - Math.min(b.y0, b.y1) / this.h;
    return this.points.filter((p) => this.shown[p.g] && p.x >= xa && p.x <= xb && p.y >= ya && p.y <= yb);
  }

  /**
   * Roll the summary to the selection's (or all visible runs') medians and update the canvas label. `announce`
   * passes the summary to the live region: once a brush ends or a group is toggled, not on every pointer move.
   */
  private summarize(announce = false): void {
    const sel = this.brush ? this.selected() : this.points.filter((p) => this.shown[p.g]);
    let text = "Nothing selected";
    if (sel.length) {
      const what = this.brush ? `${sel.length} selected` : `${sel.length} runs`;
      const latency = (median(sel.map((p) => p.x)) * 4).toFixed(1);
      const tokens = fmtInt(median(sel.map((p) => p.y)) * 4000);
      text = `${what} · median ${latency}s · ${tokens} tokens`;
    }
    if (text !== this.lastSummary) {
      rollText(this.$(".sum"), text, 1, !!this.lastSummary && !this.brush?.live);
      this.lastSummary = text;
    }
    this.canvas.setAttribute("aria-label", `Scatter plot of ${this.points.length} runs. ${text}`);
    if (announce) this.$(".sr").textContent = text;
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const W = this.w;
    const H = this.h;
    const cols = GROUPS.map(([, color]) => P[color]);
    let busy = !!this.brush?.live;
    this.fades = this.fades.map((v, g) => {
      const target = this.shown[g];
      const next = v + (target - v) * Math.min(1, dt * 8);
      if (Math.abs(next - target) > 0.01) busy = true;
      return next;
    });
    F.clear();
    // dotted cross hairs through the middle
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        if ((Math.abs(y - H / 2) < 0.8 || Math.abs(x - W / 2) < 0.8) && (i + j) % 3 === 0) F.put(i, j, P.muted, 0.3);
      }
    }
    const b = this.brush;
    const sel = b ? new Set(this.selected()) : null;
    const intro = R0 ? 9 : t - this.t0;
    for (const p of this.points) {
      const ap = clamp((intro - p.d * 0.8) / 0.4, 0, 1);
      if (ap <= 0) {
        busy = true;
        continue;
      }
      if (ap < 1) busy = true;
      const vis = this.fades[p.g];
      if (vis < 0.02) continue;
      // points settle down into place during the intro
      const px = p.x * W;
      const py = (1 - p.y) * H + (1 - ease3(ap)) * 30;
      const on = !sel || sel.has(p);
      const r = on && sel ? 3.2 : 2.3;
      for (let j = Math.floor((py - r) / pp); j <= (py + r) / pp; j++) {
        for (let i = Math.floor((px - r) / pp); i <= (px + r) / pp; i++) {
          const [x, y] = F.xy(i, j);
          if (Math.hypot(x - px, y - py) > r) continue;
          const color = on && sel ? mix(cols[p.g], WHITE, this.dark ? 0.3 : 0) : cols[p.g];
          F.put(i, j, color, (on ? 1 : 0.28) * vis * ap, on ? (sel ? 0.6 : 0.18) * vis : 0);
        }
      }
    }
    if (b) {
      const xa = Math.min(b.x0, b.x1);
      const xb = Math.max(b.x0, b.x1);
      const ya = Math.min(b.y0, b.y1);
      const yb = Math.max(b.y0, b.y1);
      for (let j = Math.floor(ya / pp); j <= yb / pp; j++) {
        for (let i = Math.floor(xa / pp); i <= xb / pp; i++) {
          const [x, y] = F.xy(i, j);
          const edge = x - xa < pp || xb - x < pp || y - ya < pp || yb - y < pp;
          if (edge) {
            // marching ants
            if ((i + j + Math.floor(t * 12)) % 3 !== 0) F.put(i, j, P.fg, 0.8, 0.2);
          } else if (bayer(i, j) < 0.08) {
            F.put(i, j, P.accent, 0.5);
          }
        }
      }
      if (!R0) busy = true;
    }
    this.flush(0.9, 4);
    return busy;
  }
}

define("hf-scatter", HScatter);

export { HScatter };

declare global {
  interface HTMLElementTagNameMap {
    "hf-scatter": HScatter;
  }
}
