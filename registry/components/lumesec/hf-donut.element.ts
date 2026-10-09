/**
 * <hf-donut> · Donut
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/donut
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-donut.tsx.
 */
import {
  HF,
  TAU,
  bayer,
  define,
  ease3,
  escapeHtml,
  fmtInt,
  localPoint,
  mix,
  now,
  reduced,
  rollText,
  type PaletteKey,
  type RGB,
} from "@/lib/lumesec/pixel";

/** A parsed `Label:value` pair of the `data` attribute. */
export interface HDonutDatum {
  label: string;
  v: number;
}

/** A datum with its share of the ring: `a0` to `a1` as fractions of a full turn, `k` its index. */
interface Segment extends HDonutDatum {
  a0: number;
  a1: number;
  k: number;
}

/** Segment colours in order; a sixth segment starts over. */
const SEGMENT_COLORS: readonly PaletteKey[] = ["accent", "ok", "warn", "danger", "muted"];

const WHITE: RGB = [255, 255, 255];

/** Inner and outer radius of the ring that reacts to the pointer, in canvas pixels. */
const HIT_INNER = 50;
const HIT_OUTER = 92;

/** Arrow keys and the direction they move the focused segment. */
const ARROW_STEP: Partial<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Angle of `(dx, dy)` clockwise from 12 o'clock, as a fraction of a full turn. */
const turnOf = (dx: number, dy: number): number => ((Math.atan2(dx, -dy) + TAU) % TAU) / TAU;

/**
 * Donut chart that sweeps in clockwise; hovering or arrowing to a segment pops it outward and rolls its share into
 * the centre.
 */
class HDonut extends HF {
  static observedAttributes = ["data", "label", "total"];

  /** Index of the highlighted segment; -1 for none. */
  private focused = -1;
  /** Eased 0–1 highlight per segment. */
  private hv: number[] = [];
  /** Time the sweep started. */
  private t0 = 0;
  private segs: Segment[] = [];
  /** Sum of the values; 1 when they sum to 0. */
  private tot = 1;

  constructor() {
    super(
      `
      :host { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
      .c { position: relative; width: 176px; height: 176px; flex: none; }
      canvas.px { width: 176px; height: 176px; outline: none; border-radius: 50%; }
      canvas.px:focus-visible { box-shadow: 0 0 0 2px var(--_accent); }
      .mid { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; text-align: center; pointer-events: none; }
      .mv { font-size: 24px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
      .ml { font-size: 12px; color: var(--_muted); }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; min-width: 0; font-size: 13px; }
      li { display: flex; align-items: center; gap: 8px; transition: opacity .2s; cursor: default; }
      li i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); flex: none; }
      li b { margin-left: auto; padding-left: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
      :host([data-focus]) li:not(.on) { opacity: .4; }
      `,
      `<div class="c"><canvas class="px" tabindex="0" role="img"></canvas><div class="mid"><span class="rollslot mv"></span><span class="rollslot ml"></span></div></div><ul></ul>`,
      2,
      0.72,
    );
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const [x, y] = localPoint(canvas, e);
      const dx = x - 88;
      const dy = y - 88;
      const d = Math.hypot(dx, dy);
      if (d < HIT_INNER || d > HIT_OUTER) return this.setFocus(-1);
      const a = turnOf(dx, dy);
      this.setFocus(this.segs.findIndex((s) => a >= s.a0 && a < s.a1));
    });
    canvas.addEventListener("pointerleave", () => this.setFocus(-1));
    canvas.addEventListener("blur", () => this.setFocus(-1));
    canvas.addEventListener("keydown", (e) => {
      const d = ARROW_STEP[e.key];
      if (!d) return;
      const n = this.segs.length;
      if (!n) return;
      e.preventDefault();
      const from = this.focused < 0 ? (d > 0 ? -1 : 0) : this.focused;
      this.setFocus((from + d + n) % n);
    });
  }

  /**
   * Segments parsed from the `data` attribute: `Label:value` pairs split at the last colon. Empty entries are
   * skipped; a missing, invalid or negative value counts as 0.
   */
  get data(): HDonutDatum[] {
    return (this.getAttribute("data") || "Code:42,Writing:23,Analysis:18,Other:17")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.lastIndexOf(":");
        if (i < 0) return { label: s, v: 0 };
        return { label: s.slice(0, i).trim(), v: Math.max(0, +s.slice(i + 1) || 0) };
      });
  }

  private get labelText(): string {
    return this.getAttribute("label") || "Usage by task";
  }

  attributeChangedCallback(name: string): void {
    // before the first connect, init() reads every attribute
    if (!this.initialized) return;
    if (name === "data") this.build();
    else this.describe();
  }

  protected override init(): void {
    this.build();
  }

  /** Lay out the segments and the legend from `data`; the donut sweeps in again. */
  private build(): void {
    const data = this.data;
    const tot = data.reduce((sum, d) => sum + d.v, 0) || 1;
    let a = 0;
    this.segs = data.map((d, k) => {
      const seg = { ...d, a0: a, a1: a + d.v / tot, k };
      a = seg.a1;
      return seg;
    });
    this.tot = tot;
    this.hv = data.map(() => 0);
    this.t0 = now();
    this.focused = -1;
    this.removeAttribute("data-focus");
    this.$("ul").innerHTML = this.segs
      .map(
        (s, k) =>
          `<li data-k="${k}" style="--c:var(--_${SEGMENT_COLORS[k % 5]})"><i></i>${escapeHtml(s.label)}<b>${this.share(s)}%</b></li>`,
      )
      .join("");
    this.$$("li").forEach((li) => {
      li.addEventListener("pointerenter", () => this.setFocus(Number(li.dataset.k)));
      li.addEventListener("pointerleave", () => this.setFocus(-1));
    });
    this.describe();
    this.kick();
  }

  /** A segment's rounded percentage of the total. */
  private share(s: Segment): number {
    return Math.round((s.v / this.tot) * 100);
  }

  /** Update the canvas label and the centre text after the data, `label` or `total` changed. */
  private describe(): void {
    this.$("canvas").setAttribute(
      "aria-label",
      `${this.labelText}: ${this.segs.map((s) => `${s.label} ${this.share(s)}%`).join(", ")}`,
    );
    this.center(false);
  }

  /** Roll the centre text to the focused segment's share, or the total. */
  private center(animate: boolean): void {
    const s = this.segs[this.focused];
    const total = this.getAttribute("total") || `${fmtInt(this.tot)}`;
    rollText(this.$(".mv"), s ? `${this.share(s)}%` : total, 1, animate);
    rollText(this.$(".ml"), s ? s.label : this.labelText, 1, animate);
  }

  private setFocus(k: number): void {
    if (k === this.focused) return;
    this.focused = k;
    this.toggleAttribute("data-focus", k >= 0);
    this.$$("li").forEach((li) => li.classList.toggle("on", Number(li.dataset.k) === k));
    this.center(true);
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    if (!this.segs.length) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const cx = this.w / 2;
    const cy = this.h / 2;
    const sweep = reducedMotion ? 1 : ease3((t - this.t0) * 1.1);
    let busy = sweep < 1;
    this.segs.forEach((_, k) => {
      const target = k === this.focused ? 1 : 0;
      this.hv[k] += (target - this.hv[k]) * Math.min(1, dt * 12);
      if (Math.abs(target - this.hv[k]) > 0.01) busy = true;
    });
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d < 50 || d > 88) continue;
        const a = turnOf(dx, dy);
        if (a > sweep) continue;
        const s = this.segs.find((g) => a >= g.a0 && a < g.a1);
        if (!s) continue;
        // the highlighted segment grows outward and slightly inward
        const hv = this.hv[s.k];
        const ro = 80 + hv * 7;
        const ri = 56 - hv * 2;
        if (d > ro || d < ri) continue;
        // a 1.6px gap between segments
        const gap = Math.min(a - s.a0, s.a1 - a) * TAU * d;
        if (gap < 1.6) continue;
        const dim = this.focused >= 0 && s.k !== this.focused ? 0.4 : 1;
        const e = (d - ri) / (ro - ri);
        const L = (0.72 + 0.28 * e) * (bayer(i, j) < 0.45 + 0.55 * e ? 1 : 0.7);
        const color = P[SEGMENT_COLORS[s.k % 5]];
        F.put(i, j, mix(color, WHITE, hv * (this.dark ? 0.25 : 0.08) * e), L * dim, hv * 0.6 + (e > 0.92 ? 0.1 : 0));
      }
    }
    this.flush(0.85, 5);
    return busy;
  }
}

define("hf-donut", HDonut);

declare global {
  interface HTMLElementTagNameMap {
    "hf-donut": HDonut;
  }
}

export { HDonut };
