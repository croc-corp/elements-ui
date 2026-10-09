/**
 * <hf-status> · Uptime
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/status
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-status.tsx.
 *
 * Demo data: Daily status and uptime are generated from a hash of `name`; only `incidents` and `state`
 * override them. It cannot show your own data yet; use it as a template and replace the invented data before
 * it shows anything real.
 */
import { HF, bayer, clamp, define, ease3, hash, mix, now, reduced, strHash, type RGB } from "@/lib/lumesec/pixel";

/** Value of the `state` attribute, which overrides the status pill. */
export type HStatusState = "operational" | "degraded" | "outage";

/** Status of one day: no incidents, degraded or a partial outage. */
type DayStatus = "ok" | "deg" | "down";

/** One generated day of history. */
interface Day {
  s: DayStatus;
  /** Uptime in percent. */
  up: number;
  date: Date;
}

const WHITE: RGB = [255, 255, 255];

const DAY_LABEL: Readonly<Record<DayStatus, string>> = {
  ok: "No incidents",
  deg: "Elevated latency",
  down: "Partial outage",
};

const STATE_LABEL: Readonly<Record<HStatusState, string>> = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
};

const isState = (value: string): value is HStatusState =>
  value === "operational" || value === "degraded" || value === "outage";

const DAY_MS = 864e5;

/** Day steps per key; Home and End overshoot and are clamped. */
const KEY_STEPS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1, End: 999, Home: -999 };

/**
 * Uptime chart of daily bars coloured by incidents, with today pulsing; hover or use the arrow keys to read a day's
 * figures.
 */
class HStatus extends HF {
  static readonly observedAttributes = ["name", "incidents", "state"] as const;

  /** Index of the inspected day, or -1. */
  private sel = -1;
  /** Number of days shown; adapts to the width. */
  private n = 60;
  /** Time of the first connect; the bars grow in from here. */
  private t0 = 0;
  /** Eased highlight per day. */
  private hl: number[] = [];
  /** Generated history, oldest first; null until the first layout. */
  private days: Day[] | null = null;

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 13.5px; flex-wrap: wrap; }
      .nm { font-weight: 600; }
      .pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 9px 3px 8px; border-radius: 99px; font-weight: 600; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); --c: var(--_ok); }
      .pill i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); animation: pu 2s infinite; }
      @keyframes pu { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--c) 60%, transparent); } 70%, 100% { box-shadow: 0 0 0 7px transparent; } }
      .up { margin-left: auto; color: var(--_muted); font-family: var(--_mono); font-size: 12px; }
      .box { position: relative; }
      canvas.px { display: block; width: 100%; height: 44px; cursor: crosshair; border-radius: 3px; }
      canvas.px:focus-visible { outline: 2px solid var(--_accent); outline-offset: 4px; }
      .ft { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--_muted); margin-top: 8px; }
      .tip { position: absolute; bottom: calc(100% + 8px); left: 0; transform: translateX(-50%); background: var(--_raised); border: 1px solid var(--_border); border-radius: 8px; padding: 7px 10px; font-size: 12px; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .15s; box-shadow: 0 6px 20px rgba(0,0,0,.18); z-index: 2; }
      .tip b { display: block; font-weight: 600; margin-bottom: 1px; }
      .tip span { color: var(--_muted); }
      .tip.on { opacity: 1; }
      @media (prefers-reduced-motion: reduce) { .pill i { animation: none; } }
      `,
      `<div class="hd"><span class="nm"></span><span class="pill"><i></i><span class="ps"></span></span><span class="up"></span></div>
        <div class="box"><canvas class="px" tabindex="0" role="img"></canvas><div class="tip" role="status"></div></div>
        <div class="ft"><span class="d0"></span><span>Today</span></div>`,
      2,
      0.72,
    );
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      // the right edge maps to n, one past the last day
      this.pick(clamp(Math.floor(((e.clientX - r.left) / r.width) * this.n), 0, this.n - 1));
    });
    canvas.addEventListener("pointerleave", () => this.pick(-1));
    canvas.addEventListener("blur", () => this.pick(-1));
    canvas.addEventListener("keydown", (e) => {
      const d = KEY_STEPS[e.key];
      if (!d) return;
      e.preventDefault();
      this.pick(clamp((this.sel < 0 ? this.n - 1 : this.sel) + d, 0, this.n - 1));
    });
  }

  private get serviceName(): string {
    return this.getAttribute("name") || "API";
  }

  /** Demo history for day `k` (0 is the oldest), seeded by the service name; `incidents` forces a day's status. */
  private day(k: number): Day {
    const seed = strHash(this.serviceName);
    const back = this.n - 1 - k;
    const r = hash((seed % 997) + back * 7.31);
    const forced = (this.getAttribute("incidents") || "")
      .split(",")
      .map((entry) => entry.trim())
      // an empty list (no attribute) must not read as "0 days ago"
      .filter((entry) => entry !== "")
      .map((entry) => entry.split(":"))
      .find(([daysAgo]) => Number(daysAgo) === back);
    let s: DayStatus;
    if (forced) s = forced[1] === "down" ? "down" : "deg";
    else s = r < 0.035 ? "down" : r < 0.11 ? "deg" : "ok";
    const up = s === "ok" ? 100 : s === "deg" ? 99.2 + hash(r * 91) * 0.7 : 96.5 + hash(r * 37) * 2.6;
    const date = new Date(Date.now() - back * DAY_MS);
    return { s, up, date };
  }

  protected override init(): void {
    this.t0 = now();
    this.$(".nm").textContent = this.serviceName;
  }

  attributeChangedCallback(): void {
    if (!this.initialized) return;
    this.$(".nm").textContent = this.serviceName;
    if (!this.w) return;
    // rebuild the history and refresh an open tooltip with the new figures
    const sel = this.sel;
    this.sel = -1;
    this.layout();
    this.pick(sel < this.n ? sel : -1);
    this.kick();
  }

  protected override layout(): void {
    // one bar per 6px
    this.n = clamp(Math.floor(this.w / 6), 20, 90);
    const n = this.n;
    const days = Array.from({ length: n }, (_, k) => this.day(k));
    const today = days[n - 1].s;
    this.days = days;
    const avg = days.reduce((sum, d) => sum + d.up, 0) / days.length;
    this.$(".up").textContent = `${avg.toFixed(2)}% uptime`;
    this.$(".d0").textContent = `${n} days ago`;
    const todayState: HStatusState = today === "ok" ? "operational" : today === "deg" ? "degraded" : "outage";
    const state = this.getAttribute("state") || todayState;
    this.$(".ps").textContent = isState(state) ? STATE_LABEL[state] : "Operational";
    const token = state === "outage" ? "danger" : state === "degraded" ? "warn" : "ok";
    this.$(".pill").style.setProperty("--c", `var(--_${token})`);
    const incidentDays = days.filter((d) => d.s !== "ok").length;
    this.$("canvas").setAttribute(
      "aria-label",
      `${this.serviceName} uptime over ${n} days: ${avg.toFixed(2)}%. ${incidentDays} days with incidents. Use arrow keys to inspect days.`,
    );
    this.hl = new Array<number>(n).fill(0);
  }

  /** Inspect day `k` in the tooltip, or hide it for -1. */
  private pick(k: number): void {
    if (k === this.sel) return;
    this.sel = k;
    const tip = this.$(".tip");
    if (k < 0 || !this.days) {
      tip.classList.remove("on");
      this.kick();
      return;
    }
    const d = this.days[k];
    const date = document.createElement("b");
    date.textContent = d.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const figures = document.createElement("span");
    figures.textContent = `${DAY_LABEL[d.s]} · ${d.up.toFixed(2)}%`;
    tip.replaceChildren(date, figures);
    const x = ((k + 0.5) / this.n) * this.w;
    tip.style.left = `${clamp(x, 74, this.w - 74)}px`;
    tip.classList.add("on");
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const days = this.days;
    if (!days) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const n = this.n;
    const R = F.rows;
    const columnW = this.w / n;
    const dark = this.dark;
    F.clear();
    for (let k = 0; k < n; k++) {
      const d = days[k];
      // bars grow up from the left
      const e = reducedMotion ? 1 : ease3((t - this.t0) * 2.4 - (k / n) * 1.3);
      this.hl[k] += ((k === this.sel ? 1 : 0) - this.hl[k]) * Math.min(1, dt * 14);
      const hv = this.hl[k];
      const col = d.s === "ok" ? P.ok : d.s === "deg" ? P.warn : P.danger;
      const i0 = Math.round((k * columnW) / F.pitch);
      const i1 = Math.max(i0 + 1, Math.round(((k + 1) * columnW) / F.pitch) - 1);
      const top = R - Math.round(R * e);
      const today = k === n - 1 && !reducedMotion ? 0.5 + 0.5 * Math.sin(t * 3.4) : 0;
      const dim = this.sel >= 0 && k !== this.sel ? 0.62 : 1;
      const glow = hv * 0.6 + today * 0.45 + (d.s !== "ok" ? 0.12 : 0);
      for (let i = i0; i < i1; i++) {
        for (let j = top; j < R; j++) {
          const v = j / R;
          const a = bayer(i, j) < 0.5 + 0.5 * v ? 1 : 0.55;
          const light = a * (0.85 + hv * 0.15) * dim;
          F.put(i, j, mix(col, WHITE, hv * (dark ? 0.3 : 0.1) + (j === top ? 0.25 : 0)), light, glow);
        }
      }
    }
    this.flush(0.85, 4);
    return !reducedMotion;
  }
}

define("hf-status", HStatus);

declare global {
  interface HTMLElementTagNameMap {
    "hf-status": HStatus;
  }
}

export { HStatus };
