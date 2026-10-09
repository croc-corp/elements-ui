/**
 * <hf-radial> · Radial bars
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/radial
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-radial.tsx.
 *
 * Demo data: The monthly values for 2025 and 2026 and the highlighted current month are invented; only `label`
 * can be set. It cannot show your own data yet; use it as a template and replace the invented data before it
 * shows anything real.
 */
import {
  HF,
  TAU,
  bayer,
  define,
  ease3,
  fmtInt,
  lerp,
  localPoint,
  mix,
  now,
  reduced,
  rollText,
  vnoise,
} from "@/lib/lumesec/pixel";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Years with built-in data. */
type Year = 2025 | 2026;

/** Month steps per arrow key. */
const ARROW_STEPS: Partial<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Hours per unit of data. */
const HOURS = 1200;
/** Dial centre, inner and outer radius in px (the canvas is a fixed 236px square). */
const CENTER = 118;
const INNER = 44;
const OUTER = 114;

/** Monthly values in `[0, 1]`; 2026 is filled up to October. */
function monthly(year: Year): number[] {
  return MONTHS.map((_, k) =>
    year === 2026
      ? k > 9
        ? 0
        : 0.35 + k * 0.06 + 0.12 * vnoise(k * 0.9, 3)
      : 0.25 + 0.25 * vnoise(k * 0.8, 7) + k * 0.025,
  );
}

/** Clockwise angle from 12 o'clock as a fraction of a turn. */
const turn = (dx: number, dy: number): number => ((Math.atan2(dx, -dy) + TAU) % TAU) / TAU;

/** Radial bar chart of twelve months; hovering or the arrow keys roll a month's value into the centre. */
class HRadial extends HF {
  private year: Year = 2026;
  private current: number[] = [];
  /** Values the year switch eases from; null before the first switch. */
  private from: number[] | null = null;
  private yearAt = -9;
  /** Inspected month, or -1 for the yearly total. */
  private focusMonth = -1;
  /** Eased 0..1 highlight per month. */
  private readonly highlight: number[] = new Array<number>(12).fill(0);
  private t0 = 0;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
      .hd b { font-size: 13.5px; font-weight: 600; }
      .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--_track); }
      .seg button { border: 0; background: none; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 11.5px; color: var(--_muted); cursor: pointer; }
      .seg button[aria-pressed="true"] { background: var(--_surface); color: var(--_fg); box-shadow: 0 1px 2px rgba(0,0,0,.16); }
      .c { position: relative; width: 236px; height: 236px; margin: 0 auto; }
      canvas.px { width: 236px; height: 236px; border-radius: 50%; outline: none; }
      canvas.px:focus-visible { box-shadow: 0 0 0 2px var(--_accent); }
      .mid { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; pointer-events: none; text-align: center; }
      .mv { font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
      .ml { font-size: 11.5px; color: var(--_muted); }
      `,
      `<div class="hd"><b class="ti"></b><div class="seg" role="group" aria-label="Year"><button type="button" data-y="2025" aria-pressed="false">2025</button><button type="button" data-y="2026" aria-pressed="true">2026</button></div></div><div class="c"><canvas class="px" tabindex="0" role="img"></canvas><div class="mid"><span class="rollslot mv"></span><span class="rollslot ml"></span></div></div>`,
      2,
      0.72,
    );
    this.$$(".seg button").forEach((button) => {
      button.addEventListener("click", () => this.setYear(button.dataset.y === "2025" ? 2025 : 2026));
    });
    const canvas = this.canvas;
    canvas.addEventListener("pointermove", (e) => {
      const [x, y] = localPoint(canvas, e);
      const dx = x - CENTER;
      const dy = y - CENTER;
      const d = Math.hypot(dx, dy);
      this.setFocus(d < 40 || d > 116 ? -1 : Math.floor(turn(dx, dy) * 12));
    });
    canvas.addEventListener("pointerleave", () => this.setFocus(-1));
    canvas.addEventListener("blur", () => this.setFocus(-1));
    canvas.addEventListener("keydown", (e) => {
      const step = ARROW_STEPS[e.key];
      if (!step) return;
      e.preventDefault();
      // the first press starts at January going forward, at December going back
      const from = this.focusMonth < 0 ? (step > 0 ? -1 : 0) : this.focusMonth;
      this.setFocus((from + step + 12) % 12);
    });
  }

  private get labelText(): string {
    return this.getAttribute("label") || "Agent hours per month";
  }

  protected override init(): void {
    this.$(".ti").textContent = this.labelText;
    this.current = monthly(2026);
    this.t0 = now();
    this.center(false);
  }

  private setYear(year: Year): void {
    if (year === this.year) return;
    this.from = this.values();
    this.year = year;
    this.current = monthly(year);
    this.yearAt = now();
    this.$$(".seg button").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.y) === year));
    });
    this.center(true);
    this.kick();
  }

  /** Month values, eased from the previous year for 0.6 s after a switch. */
  private values(): number[] {
    const e = reduced() ? 1 : ease3((now() - this.yearAt) / 0.6);
    const from = this.from;
    return this.current.map((v, k) => (from ? lerp(from[k], v, e) : v));
  }

  /** Roll the inspected month (or the yearly total) into the centre and refresh the canvas label. */
  private center(anim: boolean): void {
    const k = this.focusMonth;
    const total = this.current.reduce((a, b) => a + b, 0);
    let value = `${fmtInt(total * HOURS)} h`;
    if (k >= 0) value = this.current[k] ? `${fmtInt(this.current[k] * HOURS)} h` : "—";
    rollText(this.$(".mv"), value, 1, anim);
    rollText(this.$(".ml"), k >= 0 ? `${MONTHS[k]} ${this.year}` : `Total ${this.year}`, 1, anim);
    const months = MONTHS.map((m, i) => `${m} ${fmtInt(this.current[i] * HOURS)}`).join(", ");
    this.canvas.setAttribute("aria-label", `${this.labelText} in ${this.year}: ${months}`);
  }

  private setFocus(k: number): void {
    if (k === this.focusMonth) return;
    this.focusMonth = k;
    this.center(true);
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const cx = this.w / 2;
    const cy = this.h / 2;
    const v = this.values();
    const sweep = R0 ? 1 : ease3((t - this.t0) * 0.9);
    let busy = sweep < 1 || (!R0 && now() - this.yearAt < 0.6);
    for (let k = 0; k < 12; k++) {
      const target = k === this.focusMonth ? 1 : 0;
      this.highlight[k] += (target - this.highlight[k]) * Math.min(1, dt * 12);
      if (Math.abs(target - this.highlight[k]) > 0.01) busy = true;
    }
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d < INNER - 6 || d > OUTER + 4) continue;
        const a = turn(dx, dy);
        const k = Math.floor(a * 12);
        const f = a * 12 - k;
        // inner tick per month
        if (d < INNER - 2) {
          if (Math.abs(f - 0.5) < 0.06) F.put(i, j, P.muted, 0.5);
          continue;
        }
        if (a > sweep || f < 0.08 || f > 0.92) continue;
        const len = INNER + (OUTER - INNER) * v[k] * (1 + this.highlight[k] * 0.05);
        const u = (d - INNER) / (OUTER - INNER);
        if (d > len) {
          if (bayer(i, j) < 0.06) F.put(i, j, P.muted, 0.4);
          continue;
        }
        const dim = this.focusMonth >= 0 && k !== this.focusMonth ? 0.45 : 1;
        const cap = len - d < 2.2;
        // October 2026 is the current month
        const isCurrent = this.year === 2026 && k === 9;
        // denser toward each tip
        if (!cap && bayer(i, j) > 0.3 + 0.6 * u) continue;
        const color = cap ? mix(P.accent, P.shine, 0.4) : mix(P.accent, isCurrent ? P.warn : P.accent, 0.6);
        const pulse = isCurrent && !R0 ? 0.3 * (0.5 + 0.5 * Math.sin(t * 4)) : 0;
        F.put(i, j, color, dim, (cap ? 0.6 : 0.05) + this.highlight[k] * 0.4 + pulse);
      }
    }
    if (this.year === 2026 && !R0) busy = true;
    this.flush(0.85, 5);
    return busy;
  }
}

define("hf-radial", HRadial);

export { HRadial };

declare global {
  interface HTMLElementTagNameMap {
    "hf-radial": HRadial;
  }
}
