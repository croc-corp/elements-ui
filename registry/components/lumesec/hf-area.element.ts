/**
 * <hf-area> · Area chart
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/area
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-area.tsx.
 *
 * Data: set `data` (property, or JSON in the attribute) to your daily values. Without it the chart shows
 * invented sample data seeded from `label`.
 */
import { finite, isRecord, readJson, rows, toDate } from "@/lib/lumesec/data";
import {
  HF,
  bayer,
  clamp,
  define,
  ease3,
  fbm,
  lerp,
  mix,
  now,
  reduced,
  rollText,
  strHash,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Compact value: `1.24M`, `48.2k` or a whole number. */
const fmtShort = (v: number): string =>
  v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : `${Math.round(v)}`;

const WHITE: RGB = [255, 255, 255];

/** One day of the series, oldest first: a value, or a value with its date. */
export type HfAreaDatum = number | { value: number; date?: string | number | Date };

/** A parsed day: value and, when given, its date. */
interface Day {
  v: number;
  d: Date | null;
}

/** Normalises `data`: numbers or `{ value, date }` records; anything else is dropped. Not an array gives null. */
const parseDays = (value: unknown): Day[] | null =>
  rows(value, (entry) => {
    if (isRecord(entry)) {
      const v = finite(entry.value, NaN);
      return Number.isFinite(v) ? { v, d: toDate(entry.date) } : null;
    }
    const v = finite(entry, NaN);
    return Number.isFinite(v) ? { v, d: null } : null;
  });

/** `Sep 3`, or `Today` for the current day. */
const dayLabel = (d: Date): string =>
  d.toDateString() === new Date().toDateString()
    ? "Today"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Space above the highest value in canvas pixels. */
const TOP = 10;

/** Area chart with a bright line over a dithered fill; ranges morph into each other and hover adds a crosshair. */
class HArea extends HF {
  static observedAttributes = ["data", "label", "days"];

  /** Number of days in the range. */
  private n = 30;
  private vals: number[] = [];
  /** Dates of `vals`, when the data has them. */
  private dates: (Date | null)[] = [];
  /** Your series from `data`; null shows the sample data. */
  private input: Day[] | null = null;
  /** The previous curve, sampled at 64 points, while a range change morphs from it; null on first show. */
  private from: number[] | null = null;
  /** Start time of the morph. */
  private mT = -9;
  /** Pointer position as a 0–1 fraction of the width; -1 when the pointer is outside. */
  private hx = -1;
  /** Eased 0–1 hover amount. */
  private hf = 0;
  /** Time the chart first appeared; the line draws in from the left. */
  private t0 = 0;
  /** Value text in the header, to skip rolling to the same text. */
  private shown = "";
  private shownV: number | null = null;

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
      .k { font-size: 12.5px; color: var(--_muted); }
      .v { display: flex; align-items: baseline; gap: 8px; font-size: 26px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
      .dl { font-size: 12px; font-weight: 600; color: var(--c); letter-spacing: 0; }
      .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--_track); }
      .seg button { border: 0; background: none; padding: 4px 9px; border-radius: 6px; font: 600 11.5px var(--_font); color: var(--_muted); cursor: pointer; }
      .seg button[aria-pressed="true"] { background: var(--_surface); color: var(--_fg); box-shadow: 0 1px 2px rgba(0,0,0,.16); }
      .seg button:focus-visible { outline: 2px solid var(--_accent); }
      .box { position: relative; }
      canvas.px { display: block; width: 100%; height: 150px; cursor: crosshair; }
      .tip { position: absolute; top: -6px; transform: translate(-50%, -100%); background: var(--_raised); border: 1px solid var(--_border); border-radius: 7px; padding: 4px 8px; font-size: 11.5px; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .12s; box-shadow: 0 4px 14px rgba(0,0,0,.14); }
      .tip.on { opacity: 1; }
      .ax { display: flex; justify-content: space-between; font-size: 11px; color: var(--_muted); margin-top: 6px; }
      `,
      `<div class="hd"><div><div class="k"></div><div class="v"><span class="rollslot n"></span><span class="dl"></span></div></div><div class="seg" role="group" aria-label="Range"><button type="button" data-n="7">7D</button><button type="button" data-n="30">30D</button><button type="button" data-n="90">90D</button></div></div>
        <div class="box"><canvas class="px" role="img"></canvas><div class="tip"></div></div><div class="ax"><span class="a0"></span><span>Today</span></div>`,
      2,
      0.72,
    );
    this.$$(".seg button").forEach((b) => b.addEventListener("click", () => this.setRange(Number(b.dataset.n))));
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.hx = clamp((e.clientX - r.left) / r.width, 0, 1);
      this.hover();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hx = -1;
      this.hover();
    });
    // a value assigned before the tag was defined sits on the instance and would hide the accessor
    const early = Object.getOwnPropertyDescriptor(this, "data");
    if (early) {
      Reflect.deleteProperty(this, "data");
      const value: unknown = early.value;
      this.input = parseDays(value);
    }
  }

  attributeChangedCallback(name: string): void {
    if (name === "data") {
      this.input = parseDays(readJson(this));
      this.reload();
      return;
    }
    // before the first connect, init() reads the label and the range
    if (!this.initialized) return;
    if (name === "label") {
      this.$(".k").textContent = this.labelText;
      this.reload();
    } else {
      this.setRange(this.rangeDays);
    }
  }

  /** Your daily values, oldest first; `null` while the chart shows sample data. Setting it redraws the chart. */
  get data(): readonly HfAreaDatum[] | null {
    return this.input && this.input.map((p) => (p.d ? { value: p.v, date: p.d.toISOString() } : p.v));
  }

  set data(value: readonly HfAreaDatum[] | null) {
    this.input = parseDays(value);
    this.reload();
  }

  /** Re-reads the series for the current range after the data changed. */
  private reload(): void {
    if (this.initialized) this.setRange(this.n, false, true);
  }

  private get labelText(): string {
    return this.getAttribute("label") || "Tokens per day";
  }

  /** The `days` attribute as a whole number of days, at least one. */
  private get rangeDays(): number {
    return Math.max(1, Math.round(this.num("days", 30)));
  }

  /** Demo series of `n` daily values, seeded from the label. */
  private gen(n: number): number[] {
    const seed = strHash(this.getAttribute("label") || "Tokens") % 100;
    return Array.from({ length: n }, (_, k) => {
      const x = (k / Math.max(1, n - 1)) * (n / 10);
      return 1.2e6 * (0.55 + 0.5 * fbm(x * 0.9 + seed, 1.7) + (k / n) * 0.35);
    });
  }

  protected override init(): void {
    this.$(".k").textContent = this.labelText;
    this.t0 = now();
    this.setRange(this.rangeDays, true);
  }

  /**
   * Show the last `n` days; after the first show the old curve morphs into the new one. With your data the
   * range holds at most as many days as the data has; a single day is drawn as a flat line.
   */
  private setRange(n: number, first = false, force = false): void {
    if (n === this.n && !first && !force) return;
    this.from = first || !this.vals.length ? null : this.curve(64);
    this.mT = first ? -9 : now();
    this.n = n;
    this.$$(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.n) === n)));
    const days = this.input?.slice(-n);
    this.vals = days ? days.map((p) => p.v) : this.gen(n);
    this.dates = days ? days.map((p) => p.d) : [];
    // days in the range; a single day is drawn twice, as a flat line across the width
    const count = this.vals.length;
    if (count === 1) {
      this.vals.push(this.vals[0]);
      this.dates.push(this.dates[0]);
    }
    const m = this.vals.length;
    const delta = this.$(".dl");
    if (!m) {
      this.$(".a0").textContent = "";
      this.$(".ax span:last-child").textContent = "";
      delta.textContent = "No data";
      delta.style.setProperty("--c", "var(--_muted)");
      rollText(this.$(".n"), "–", 1, false);
      this.shown = "";
      this.shownV = null;
      this.cv?.setAttribute("aria-label", `${this.labelText}: no data`);
      this.$(".tip").classList.remove("on");
      this.kick();
      return;
    }
    const d0 = this.dates[0];
    const d1 = this.dates[m - 1];
    this.$(".a0").textContent = d0 ? dayLabel(d0) : count === 1 ? "Today" : `${m} days ago`;
    this.$(".ax span:last-child").textContent = d1 ? dayLabel(d1) : "Today";
    const a = this.vals[0];
    const z = this.vals[m - 1];
    const d = a ? ((z - a) / Math.abs(a)) * 100 : 0;
    delta.textContent = `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}%`;
    delta.style.setProperty("--c", `var(--_${d >= 0 ? "ok" : "danger"})`);
    const span = `last ${count} day${count === 1 ? "" : "s"}`;
    this.cv?.setAttribute("aria-label", `${this.labelText}, ${span}, ${fmtShort(a)} to ${fmtShort(z)}`);
    this.hover();
    this.kick();
  }

  /** The series at `u` (0–1), interpolated between days. */
  private at(u: number): number {
    const v = this.vals;
    const x = u * (v.length - 1);
    const k = Math.floor(x);
    return lerp(v[k], v[Math.min(v.length - 1, k + 1)], x - k);
  }

  /** The series sampled at `m` evenly spaced points. */
  private curve(m: number): number[] {
    return Array.from({ length: m }, (_, k) => this.at(k / (m - 1)));
  }

  /** Update the header value and the date tip for the hovered day (or the latest day). */
  private hover(): void {
    const n = this.vals.length;
    if (!n) return;
    const tip = this.$(".tip");
    const k = this.hx < 0 ? n - 1 : Math.round(this.hx * (n - 1));
    const v = this.vals[k];
    const s = fmtShort(v);
    if (s !== this.shown) {
      rollText(this.$(".n"), s, this.shownV == null || v >= this.shownV ? 1 : -1, !!this.shown);
      this.shown = s;
      this.shownV = v;
    }
    if (this.hx < 0) {
      tip.classList.remove("on");
      this.kick();
      return;
    }
    const date = this.dates[k] ?? new Date(Date.now() - (n - 1 - k) * 864e5);
    tip.textContent = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    tip.style.left = `${clamp((k / (n - 1)) * this.w, 30, this.w - 30)}px`;
    tip.classList.add("on");
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const C = F.cols;
    const R = F.rows;
    const H = this.h;
    const morph = reducedMotion ? 1 : ease3((t - this.mT) / 0.6);
    const reveal = reducedMotion ? 2 : (t - this.t0) * 1.4;
    this.hf += ((this.hx >= 0 ? 1 : 0) - this.hf) * Math.min(1, dt * 10);
    if (!this.vals.length) {
      F.clear();
      this.flush(0.8, 4);
      return false;
    }
    const mx = Math.max(0, ...this.vals) * 1.12 || 1;
    const from = this.from;
    // the value at u, blended from the previous range's curve while morphing
    const cur = (u: number): number => {
      let v = this.at(u);
      if (from && morph < 1) {
        const m = from.length;
        const x = u * (m - 1);
        const k = Math.floor(x);
        v = lerp(lerp(from[k], from[Math.min(m - 1, k + 1)], x - k), v, morph);
      }
      return v;
    };
    // values are drawn from zero up; a negative value sits on the baseline
    const yOf = (u: number): number => TOP + (1 - Math.max(0, cur(u)) / mx) * (H - TOP - 2);
    // hovered day snapped to the series, as a 0–1 fraction; -1 without hover
    const last = this.vals.length - 1;
    const hxk = this.hx >= 0 ? Math.round(this.hx * last) / last : -1;
    F.clear();
    let prevY: number | null = null;
    for (let i = 0; i < C; i++) {
      const u = i / (C - 1);
      const front = reveal - u * 1.1;
      if (front < 0) {
        prevY = null;
        continue;
      }
      const yv = yOf(u);
      const ny = yOf(Math.min(1, (i + 1) / (C - 1)));
      const lo = Math.min(yv, prevY ?? yv, ny) - 1.2;
      const hi = Math.max(yv, prevY ?? yv, ny) + 1.2;
      prevY = yv;
      const fr = front < 0.08 ? 1 - front / 0.08 : 0;
      const nearH = hxk >= 0 ? Math.exp(-(((u - hxk) * this.w) ** 2) / 200) * this.hf : 0;
      for (let j = 0; j < R; j++) {
        const y = (j + 0.5) * F.pitch;
        if (y >= lo && y <= hi) {
          F.put(i, j, mix(P.accent, P.shine, 0.35 + nearH * 0.4), 1, 0.35 + fr * 0.6 + nearH * 0.4);
          continue;
        }
        if (y > yv) {
          const depth = (y - yv) / (H - yv + 1);
          const dens = 0.78 * Math.pow(1 - depth, 1.4) + 0.06 + nearH * 0.15;
          if (bayer(i, j) < dens) {
            F.put(i, j, mix(P.accent, P.shine, nearH * 0.3), (this.dark ? 0.7 : 0.6) * (1 - depth * 0.5), fr * 0.4);
          }
        }
        // grid dots
        if (j % 12 === 6 && i % 3 === 0) F.put(i, j, P.muted, 0.3);
        // crosshair
        if (hxk >= 0 && Math.abs(u - hxk) * this.w < 0.9 && j & 1) F.put(i, j, P.fg, 0.5 * this.hf);
      }
    }
    if (hxk >= 0) {
      const px = hxk * this.w;
      const py = yOf(hxk);
      for (let j = Math.floor((py - 6) / F.pitch); j <= (py + 6) / F.pitch; j++) {
        for (let i = Math.floor((px - 6) / F.pitch); i <= (px + 6) / F.pitch; i++) {
          const [x, y] = F.xy(i, j);
          const d = Math.hypot(x - px, y - py);
          if (d < 4.6) F.put(i, j, d > 3 ? P.accent : WHITE, 1, 0.8 * this.hf);
        }
      }
    }
    this.flush(0.8, 4);
    return !reducedMotion && (reveal < 1.3 || morph < 1 || Math.abs(this.hf - (this.hx >= 0 ? 1 : 0)) > 0.01);
  }
}

define("hf-area", HArea);

declare global {
  interface HTMLElementTagNameMap {
    "hf-area": HArea;
  }
}

export { HArea };
