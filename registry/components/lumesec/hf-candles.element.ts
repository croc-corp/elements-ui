/**
 * <hf-candles> · Candlesticks
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/candles
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-candles.tsx.
 *
 * Data: set `data` (property, or JSON in the attribute) to your OHLC candles, oldest first, and call
 * `push()` to stream new ones. Without it the chart shows an invented random walk that ticks live; with it
 * nothing is simulated.
 */
import { finite, isRecord, readJson, rows, toDate } from "@/lib/lumesec/data";
import { HF, bayer, clamp, define, localPoint, mix, now, reduced, rollText, type RGB } from "@/lib/lumesec/pixel";

/** One candle of the series: open, high, low and close, with optional volume and date. */
export type HfCandlesDatum = {
  open: number;
  high: number;
  low: number;
  close: number;
  /** Traded volume; the volume strip is left out when no candle has one. */
  volume?: number;
  /** Start of the period, as an ISO string, epoch ms or `Date`; labels the hover readout. */
  date?: string | number | Date;
};

/** One period: open, high, low, close, volume and, for your data, the date. */
interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  d: Date | null;
}

/** Normalises one candle; `open` and `close` are required, `high` and `low` are widened to include them. */
function parseCandle(entry: unknown): Candle | null {
  if (!isRecord(entry)) return null;
  const o = finite(entry.open, NaN);
  const c = finite(entry.close, NaN);
  if (!Number.isFinite(o) || !Number.isFinite(c)) return null;
  return {
    o,
    c,
    h: Math.max(o, c, finite(entry.high, -Infinity)),
    l: Math.min(o, c, finite(entry.low, Infinity)),
    v: Math.max(0, finite(entry.volume, 0)),
    d: toDate(entry.date),
  };
}

/** Normalises `data`; invalid candles are dropped. Not an array gives null. */
const parseCandles = (value: unknown): Candle[] | null => rows(value, parseCandle);

/** Number of candles on the chart. */
const COUNT = 56;
/** Milliseconds between data updates; every eighth update opens a new candle. */
const TICK_MS = 700;
/** Height of the volume strip in px. */
const VOLUME_H = 34;

const WHITE: RGB = [255, 255, 255];

/** A price with three decimals below 10, two from 10 up. */
const fmtPrice = (v: number): string => v.toFixed(Math.abs(v) < 10 ? 3 : 2);

/** `Sep 3`, with the time when it is not midnight: `Sep 3, 14:00`. */
const dateLabel = (d: Date): string => {
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!d.getHours() && !d.getMinutes()) return day;
  return `${day}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

/** Park–Miller generator centred on 0: the same seed gives the same sequence in `(-0.5, 0.5)`. */
function seededOffset(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}

/** Live candlestick chart with dithered bodies, wicks, volume and a last-price line. */
class HCandles extends HF {
  static observedAttributes = ["data", "ticker"];

  /** The demo random walk. */
  private readonly demo: Candle[] = [];
  /** Your candles from `data` and `push()`; null shows the demo walk. */
  private input: Candle[] | null = null;
  /** True once `push()` fed your series; shows the Live badge. */
  private streaming = false;
  /** Pointer x over the canvas in its CSS pixels, or -1 when the pointer is outside. */
  private hoverX = -1;
  /** Time the newest candle opened. */
  private openedAt = -9;
  private readonly rnd = seededOffset(11);
  /** Data updates so far. */
  private ticks = 0;
  private t0 = 0;
  private timer = 0;
  private lastPrice = "";
  private lastValue = 0;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
      .tk { font-family: var(--_mono); font-size: 12px; font-weight: 600; padding: 2px 7px; border-radius: 6px; background: var(--_raised); }
      .px2 { font-size: 24px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
      .ch { font-size: 12px; font-weight: 600; color: var(--c); font-variant-numeric: tabular-nums; }
      .live { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--_muted); }
      .live[hidden] { display: none; }
      .live i { width: 7px; height: 7px; border-radius: 50%; background: var(--_ok); animation: lp 1.6s infinite; }
      @keyframes lp { 50% { opacity: .3; } }
      .ohlc { font-family: var(--_mono); font-size: 11px; color: var(--_muted); min-height: 1.5em; margin-bottom: 4px; font-variant-numeric: tabular-nums; }
      .box { position: relative; }
      canvas.px { width: 100%; height: 200px; cursor: crosshair; }
      .tag { position: absolute; right: 0; transform: translateY(-50%); font-family: var(--_mono); font-size: 10.5px; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: var(--c); color: var(--_on-accent); pointer-events: none; }
      .tag:empty { display: none; }
      @media (prefers-reduced-motion: reduce) { .live i { animation: none; } }
      `,
      `<div class="hd"><span class="tk"></span><span class="rollslot px2"></span><span class="ch"></span><span class="live"><i></i>Live</span></div><div class="ohlc" aria-live="off"></div><div class="box"><canvas class="px" role="img"></canvas><span class="tag"></span></div>`,
      2,
      0.74,
    );
    const canvas = this.canvas;
    canvas.addEventListener("pointermove", (e) => {
      [this.hoverX] = localPoint(canvas, e);
      this.readout();
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hoverX = -1;
      this.readout();
      this.kick();
    });
    // a value assigned before the tag was defined sits on the instance and would hide the accessor
    const early = Object.getOwnPropertyDescriptor(this, "data");
    if (early) {
      Reflect.deleteProperty(this, "data");
      const value: unknown = early.value;
      this.input = parseCandles(value);
    }
  }

  attributeChangedCallback(name: string): void {
    if (name === "ticker") {
      this.$(".tk").textContent = this.tickerText;
      if (this.initialized) this.readout();
      return;
    }
    this.input = parseCandles(readJson(this));
    this.streaming = false;
    this.reload();
  }

  /** Your candles, oldest first; `null` while the chart shows demo data. Setting it redraws the chart. */
  get data(): readonly HfCandlesDatum[] | null {
    return (
      this.input &&
      this.input.map((c) => ({
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
        volume: c.v,
        ...(c.d ? { date: c.d.toISOString() } : {}),
      }))
    );
  }

  set data(value: readonly HfCandlesDatum[] | null) {
    this.input = parseCandles(value);
    this.streaming = false;
    this.reload();
  }

  /**
   * Appends a candle to your series, or replaces the last one when both have the same `date` (to update the
   * forming candle). Once the series is longer than 56 candles, each append drops the oldest. Without `data`
   * this starts your series and ends the demo. Invalid candles are ignored.
   */
  push(candle: HfCandlesDatum): void {
    const c = parseCandle(candle);
    if (!c) return;
    const series = this.input ?? [];
    const last = series[series.length - 1];
    if (last && c.d && last.d && c.d.getTime() === last.d.getTime()) series[series.length - 1] = c;
    else {
      series.push(c);
      if (series.length > COUNT) series.shift();
      this.openedAt = now();
    }
    this.input = series;
    this.streaming = true;
    this.reload();
  }

  /** The candles on the chart: the last 56 of your data, or the demo walk. */
  private get candles(): Candle[] {
    return this.input ? this.input.slice(-COUNT) : this.demo;
  }

  /** Redraws after the data changed and starts or stops the demo updates. */
  private reload(): void {
    if (!this.initialized) return;
    this.sync();
    this.readout();
    this.kick();
  }

  /** Runs the demo updates only while connected and without your data. */
  private sync(): void {
    const want = this.initialized && this.isConnected && !this.input;
    if (want && !this.timer) this.timer = window.setInterval(() => this.tick(), TICK_MS);
    else if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private get tickerText(): string {
    return this.getAttribute("ticker") || "GPU·H";
  }

  protected override init(): void {
    this.$(".tk").textContent = this.tickerText;
    // a seeded random walk
    let price = 2.4;
    for (let k = 0; k < COUNT; k++) {
      const o = price;
      const c = Math.max(0.5, o * (1 + this.rnd() * 0.05 + 0.002));
      this.demo.push({
        o,
        c,
        h: Math.max(o, c) * (1 + Math.abs(this.rnd()) * 0.025),
        l: Math.min(o, c) * (1 - Math.abs(this.rnd()) * 0.025),
        v: 0.3 + Math.abs(this.rnd()) * 1.4,
        d: null,
      });
      price = c;
    }
    this.ticks = 0;
    this.readout();
    this.t0 = now();
    this.sync();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.sync();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // re-inserted: restart the updates stopped on disconnect
    this.sync();
  }

  /** Move the last demo close; every eighth update opens a new candle. Paused off screen. */
  private tick(): void {
    if (!this.onScreen || this.input) return;
    const cs = this.demo;
    const c = cs[cs.length - 1];
    c.c = Math.max(0.5, c.c * (1 + this.rnd() * 0.012));
    c.h = Math.max(c.h, c.c);
    c.l = Math.min(c.l, c.c);
    c.v += Math.abs(this.rnd()) * 0.1;
    if (++this.ticks % 8 === 0) {
      cs.shift();
      cs.push({ o: c.c, c: c.c, h: c.c, l: c.c, v: 0.2, d: null });
      this.openedAt = now();
    }
    this.readout();
    this.kick();
  }

  /** Update the price, the change and the OHLC line of the hovered (or newest) candle. */
  private readout(): void {
    const cs = this.candles;
    const n = cs.length;
    const mine = !!this.input;
    this.$(".live").hidden = mine && !this.streaming;
    const ticker = this.tickerText;
    const periods = `last ${n} period${n === 1 ? "" : "s"}`;
    this.canvas.setAttribute("aria-label", n ? `${ticker} price, ${periods}` : `${ticker} price: no data`);
    const changeEl = this.$(".ch");
    if (!n) {
      rollText(this.$(".px2"), "–", 1, false);
      this.lastPrice = "";
      changeEl.textContent = "";
      this.$(".ohlc").textContent = "No data";
      this.$(".tag").textContent = "";
      return;
    }
    const last = cs[n - 1];
    const first = cs[0];
    const change = first.o ? ((last.c - first.o) / Math.abs(first.o)) * 100 : 0;
    const price = `$${fmtPrice(last.c)}`;
    if (price !== this.lastPrice) {
      rollText(this.$(".px2"), price, last.c >= this.lastValue ? 1 : -1, !!this.lastPrice);
      this.lastPrice = price;
      this.lastValue = last.c;
    }
    changeEl.textContent = `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(2)}%`;
    changeEl.style.setProperty("--c", `var(--_${change >= 0 ? "ok" : "danger"})`);
    const hovered = this.hoverX >= 0 && this.w > 0;
    const k = hovered ? clamp(Math.floor((this.hoverX / this.w) * n), 0, n - 1) : n - 1;
    const c = cs[k];
    const back = n - 1 - k;
    // your candles: their date, or periods counted back; the demo walk is hourly
    let when: string;
    if (c.d) when = dateLabel(c.d);
    else if (mine) when = back ? `${back} period${back === 1 ? "" : "s"} ago` : "Latest";
    else when = hovered ? `${back}h ago` : "Now";
    this.$(".ohlc").textContent =
      `${when} · O ${fmtPrice(c.o)} H ${fmtPrice(c.h)} L ${fmtPrice(c.l)} C ${fmtPrice(c.c)}`;
  }

  protected override render(t: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const W = this.w;
    const H = this.h;
    const cs = this.candles;
    const n = cs.length;
    F.clear();
    if (!n) {
      this.flush(0.8, 4);
      return false;
    }
    const vmax = Math.max(...cs.map((c) => c.v));
    // without volumes the prices use the full height
    const chartH = vmax > 0 ? H - VOLUME_H - 6 : H - 6;
    const hi = Math.max(...cs.map((c) => c.h));
    const lo = Math.min(...cs.map((c) => c.l));
    // a flat series still gets a range around its price
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
    const yv = (v: number): number => ((hi + pad - v) / (hi - lo + 2 * pad)) * chartH;
    const bw = W / n;
    const intro = R0 ? 9 : (t - this.t0) * 1.6;
    const hk = this.hoverX >= 0 ? clamp(Math.floor((this.hoverX / W) * n), 0, n - 1) : -1;
    // four dotted grid lines
    for (let j = 0; j < F.rows; j++) {
      const [, y] = F.xy(0, j);
      if (y < chartH && Math.round(y / pp) % Math.round(chartH / 4 / pp) === 0) {
        for (let i = 0; i < F.cols; i += 3) F.put(i, j, P.muted, 0.22);
      }
    }
    cs.forEach((c, k) => {
      if (k / n > intro) return;
      const up = c.c >= c.o;
      const col = up ? P.ok : P.danger;
      const x0 = k * bw + bw * 0.18;
      const x1 = (k + 1) * bw - bw * 0.18;
      const xm = (k + 0.5) * bw;
      const yo = yv(c.o);
      const yc = yv(c.c);
      const yh = yv(c.h);
      const yl = yv(c.l);
      const isHovered = k === hk;
      const isLast = k === n - 1;
      const flash = isLast && !R0 ? clamp(1 - (t - this.openedAt) / 0.6, 0, 1) : 0;
      const dim = hk >= 0 && !isHovered ? 0.6 : 1;
      // wick
      for (let j = Math.floor(yh / pp); j <= yl / pp; j++) {
        F.put(Math.round(xm / pp - 0.5), j, col, 0.9 * dim, isHovered ? 0.4 : 0);
      }
      // body: solid when up, dithered when down
      const top = Math.min(yo, yc);
      const bottom = Math.max(yo, yc, top + 1.5);
      const right = Math.max(x0 / pp + 1, x1 / pp);
      for (let j = Math.floor(top / pp); j <= bottom / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < right; i++) {
          const edge = j === Math.floor(top / pp) || j >= Math.floor(bottom / pp);
          if (!edge && !up && bayer(i, j) > 0.55) continue;
          const color = mix(col, WHITE, (isHovered ? 0.3 : 0) + flash * 0.5);
          F.put(i, j, color, dim, (isHovered ? 0.4 : 0.06) + flash * 0.6 + (isLast ? 0.2 : 0));
        }
      }
      // volume
      if (vmax > 0) {
        const vy = H - (c.v / vmax) * VOLUME_H;
        for (let j = Math.floor(vy / pp); j < H / pp; j++) {
          for (let i = Math.floor(x0 / pp); i < right; i++) {
            if (bayer(i, j) < 0.5) F.put(i, j, col, 0.45 * dim);
          }
        }
      }
    });
    // last-price line
    const last = cs[n - 1];
    const ly = yv(last.c);
    const lastUp = last.c >= last.o;
    for (let i = 0; i < F.cols; i++) {
      if (i % 2 === 0) F.put(i, Math.round(ly / pp - 0.5), lastUp ? P.ok : P.danger, 0.7, 0.3);
    }
    const tag = this.$(".tag");
    tag.textContent = fmtPrice(last.c);
    tag.style.top = `${ly}px`;
    tag.style.setProperty("--c", `var(--_${lastUp ? "ok" : "danger"})`);
    // hover cursor
    if (hk >= 0) {
      for (let j = 0; j < F.rows; j++) {
        if (j % 2) F.put(Math.round(((hk + 0.5) * bw) / pp - 0.5), j, P.fg, 0.45);
      }
    }
    this.flush(0.8, 4);
    if (R0) return false;
    // the demo is live and redraws every frame; your data only while the intro or a new candle animates
    return !this.input || intro <= 1 || t - this.openedAt < 0.6;
  }
}

define("hf-candles", HCandles);

export { HCandles };

declare global {
  interface HTMLElementTagNameMap {
    "hf-candles": HCandles;
  }
}
