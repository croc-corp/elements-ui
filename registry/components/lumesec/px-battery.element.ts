/**
 * <px-battery> · Usage battery
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/battery
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-battery.tsx.
 *
 * Demo data: The usage level starting at 64% and the Monday 09:00 reset time are invented; nothing can be set.
 * It cannot show your own data yet; use it as a template and replace the invented data before it shows
 * anything real.
 */
import { PxBase, Sparks, bitmap, clamp, define, lerp, mix, now, rand, reduced, rollText } from "@/lib/lumesec/pixel";

/** Events fired by `<px-battery>`. */
export interface BatteryEventMap {
  /** Fires after usage is spent. `left` is the remaining fraction from 0 to 1. */
  use: CustomEvent<{ left: number }>;
  /** Fires when a reset finishes and the battery is full. */
  full: CustomEvent<Record<string, never>>;
}

const BOLT = bitmap(["...##", "..##.", ".##..", "#####", "..##.", ".##..", "##...", "#...."]);

/** Seconds a full reset takes from empty. */
const CHARGE_TIME = 2.4;
/** Cell pitch inside the battery in px. */
const CELL = 5;

/** A spark of current running along the cable; `u` is its progress to the fill edge. */
interface Current {
  u: number;
  y: number;
  speed: number;
}

/** A spent cell floating away; it waits until `delay`, then drifts up and fades. */
interface SpentCell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  delay: number;
  age: number;
  life: number;
}

/** Battery body: outline position and size, and the cell grid inside it. */
interface BatteryGeometry {
  x0: number;
  y0: number;
  bw: number;
  bh: number;
  cols: number;
  rows: number;
}

/**
 * Weekly usage shown as a pixel battery; spending knocks cells loose and resetting runs current along the cable until
 * it is full.
 */
class Battery extends PxBase {
  /** Level from 0 to 1. */
  private level = 0.64;
  /** Displayed level, easing towards {@link Battery.level}. */
  private shown = 0.64;
  private charging = false;
  private currents: Current[] = [];
  private spent: SpentCell[] = [];
  private readonly sparks = new Sparks();
  /** Percentage last announced while charging. */
  private lastPercent = -1;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      .pbtn[aria-disabled="true"] { opacity: .45; pointer-events: none; }
      .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 10px; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      .pct { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
      :host([data-zone="low"]) .pct { color: var(--_danger); }
      :host([data-zone="mid"]) .pct { color: var(--_warn); }
      canvas.px { height: 92px; }
      .bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
      .st { font-size: 12.5px; color: var(--_muted); }
      .btns { display: flex; gap: 8px; }
      `,
      `<div class="head"><span class="lab">Weekly usage left</span><span class="rollslot pct" aria-live="polite"></span></div><canvas class="px" role="meter" aria-label="Weekly usage left" aria-valuemin="0" aria-valuemax="100"></canvas>
        <div class="bar"><span class="rollslot st"></span><div class="btns"><button class="pbtn use" type="button">Run a big task (−15%)</button><button class="pbtn chg" type="button">Reset limit</button></div></div>`,
    );
    this.$(".use").addEventListener("click", () => this.use());
    this.$(".chg").addEventListener("click", () => this.charge());
  }

  protected override init(): void {
    this.sync(false, 1);
    rollText(this.$(".st"), "Resets Monday 09:00", 1, false);
  }

  /** Update the percentage, the zone and the meter value. */
  private sync(animate: boolean, dir: number): void {
    const percent = Math.round(this.level * 100);
    this.dataset.zone = percent <= 20 ? "low" : percent <= 45 ? "mid" : "ok";
    rollText(this.$(".pct"), `${percent}%`, dir, animate);
    this.canvas.setAttribute("aria-valuenow", String(percent));
  }

  private geometry(): BatteryGeometry {
    const x0 = 8;
    const y0 = 14;
    const bw = this.w - 34;
    const bh = 60;
    return { x0, y0, bw, bh, cols: Math.floor((bw - 12) / CELL), rows: Math.floor((bh - 12) / CELL) };
  }

  /** Mark both buttons unavailable during a reset; `use()` and `charge()` ignore presses meanwhile. */
  private setButtonsDisabled(disabled: boolean): void {
    // aria-disabled rather than disabled, so a keyboard user keeps focus on the pressed button
    for (const button of this.$$(".btns .pbtn")) {
      if (disabled) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
    }
  }

  /** Spends 15% and fires `use`. Ignored while resetting or when empty. */
  use(): void {
    if (this.charging || this.level <= 0) return;
    const from = this.level;
    this.level = Math.max(0, Number((this.level - 0.15).toFixed(2)));
    const { x0, y0, bw, rows } = this.geometry();
    const start = now();
    const xa = x0 + 6 + this.level * (bw - 12);
    const xb = x0 + 6 + from * (bw - 12);
    // the spent cells float off, starting at the old fill edge
    for (let x = xa; x < xb; x += CELL) {
      for (let r = 0; r < rows; r++) {
        this.spent.push({
          x,
          y: y0 + 6 + r * CELL,
          vx: rand(-20, 40),
          vy: rand(-140, -40),
          delay: start + (xb - x) / 400,
          age: 0,
          life: rand(0.5, 0.9),
        });
      }
    }
    this.sync(true, -1);
    if (this.level <= 0.2) rollText(this.$(".st"), "Running low · resets Monday 09:00", 1);
    this.emit<{ left: number }>("use", { left: this.level });
    this.kick();
  }

  /** Refills the battery over about 2.4 seconds, then fires `full`. Ignored when already full or resetting. */
  charge(): void {
    if (this.charging || this.level >= 1) return;
    this.charging = true;
    // the readout rolls in 5% steps while charging; a busy live region holds them back and announces the result
    this.$(".pct").setAttribute("aria-busy", "true");
    this.setButtonsDisabled(true);
    rollText(this.$(".st"), "Resetting…", 1);
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const still = reduced();
    const { x0, y0, bw, bh, cols, rows } = this.geometry();
    if (this.charging) {
      this.level = Math.min(1, this.level + (dt / CHARGE_TIME) * (still ? 99 : 1));
      if (!still) {
        for (let k = 0; k < 2; k++) this.currents.push({ u: 0, y: y0 + bh / 2 + rand(-3, 3), speed: rand(0.9, 1.3) });
      }
      // announce in 5% steps
      const percent = Math.round(this.level * 100);
      if (percent !== this.lastPercent && (percent % 5 === 0 || percent === 100)) {
        this.lastPercent = percent;
        this.sync(true, 1);
      }
      if (this.level >= 1) {
        this.charging = false;
        this.sync(true, 1);
        this.$(".pct").removeAttribute("aria-busy");
        this.setButtonsDisabled(false);
        rollText(this.$(".st"), "Full · resets Monday 09:00", 1);
        this.sparks.add(x0 + bw / 2, y0 + bh / 2, 40, [P.ok, P.shine, P.accent], { speed: [50, 200], jitter: 40 });
        this.emit("full");
      }
    }
    this.shown += clamp(this.level - this.shown, -dt * 1.2, dt * 3);

    this.clear();
    const color = this.shown <= 0.2 ? P.danger : this.shown <= 0.45 ? P.warn : P.ok;
    for (let x = x0; x <= x0 + bw; x += 4) {
      this.dot(x, y0, P.fg, 0.45, 2.4);
      this.dot(x, y0 + bh - 2.4, P.fg, 0.45, 2.4);
    }
    for (let y = y0; y <= y0 + bh - 2; y += 4) {
      this.dot(x0, y, P.fg, 0.45, 2.4);
      this.dot(x0 + bw, y, P.fg, 0.45, 2.4);
    }
    // the terminal nub
    for (let y = y0 + bh / 2 - 10; y <= y0 + bh / 2 + 8; y += 4) {
      for (let x = x0 + bw + 4; x <= x0 + bw + 10; x += 3) this.dot(x, y, P.fg, 0.45, 2.4);
    }
    const lit = this.shown * cols;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const on = c < lit;
        const edge = on && c > lit - 2;
        const wave = this.charging && !still ? 0.25 * Math.max(0, Math.sin(t * 10 - c * 0.4)) : 0;
        const cellColor = on ? mix(color, P.shine, edge ? 0.5 : wave) : P.fg;
        this.dot(x0 + 6 + c * CELL, y0 + 6 + r * CELL, cellColor, on ? 0.9 : 0.08, 3.4);
      }
    }
    if (this.charging) {
      const bx = x0 + bw / 2 - 7;
      const by = y0 + bh / 2 - 12;
      const pulse = 0.6 + 0.4 * Math.sin(t * 8);
      for (const [x, y] of BOLT) this.dot(bx + x * 3, by + y * 3, P.shine, pulse, 2.8);
    }
    const fillX = x0 + 6 + this.shown * (bw - 12);
    this.currents = this.currents.filter((current) => {
      current.u += dt * 1.6 * current.speed;
      const x = lerp(-6, fillX, current.u);
      if (current.u >= 1) return false;
      this.dot(x, current.y, P.shine, 0.9, 2.4);
      return true;
    });
    this.spent = this.spent.filter((cell) => {
      if (t < cell.delay) {
        this.dot(cell.x, cell.y, color, 0.9, 3.4);
        return true;
      }
      cell.age += dt;
      cell.vy += 200 * dt;
      cell.x += cell.vx * dt;
      cell.y += cell.vy * dt;
      if (cell.age > cell.life) return false;
      this.dot(cell.x, cell.y, mix(color, P.muted, cell.age / cell.life), 1 - cell.age / cell.life, 3);
      return true;
    });
    const sparking = this.sparks.step(ctx, dt);
    return (
      this.charging ||
      this.currents.length > 0 ||
      this.spent.length > 0 ||
      sparking ||
      Math.abs(this.level - this.shown) > 0.001
    );
  }
}

define("px-battery", Battery);

export { Battery };

declare global {
  interface HTMLElementTagNameMap {
    "px-battery": Battery;
  }
}
