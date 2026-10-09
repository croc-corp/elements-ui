/**
 * <px-xp> · Level up
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/xp
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-xp.tsx.
 *
 * Demo data: The starting XP of 196 is invented; only `level` can be set and `gain()` adds to it. It cannot
 * show your own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { PxBase, Sparks, clamp, css, define, mix, now, rand, reduced, rollText, type Point } from "@/lib/lumesec/pixel";

/** Events fired by `<px-xp>`. */
export interface XPEventMap {
  /** Fires on each gain with the amount added. */
  gain: CustomEvent<{ xp: number }>;
  /** Fires when the bar overflows, with the new level. */
  levelup: CustomEvent<{ level: number }>;
}

/** Left edge of the XP bar in px; the level number sits left of it. */
const BAR_X = 124;
/** Top of the XP bar in px. */
const BAR_Y = 64;
/** Spacing of the pixels sampled from the level number, in px. */
const SAMPLE = 3;
/** Seconds the reassembled pixels take to hand over to the text. */
const HANDOVER = 0.25;

/** A pixel of the level number while it blows apart and reassembles. */
interface DigitPixel {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Target position. */
  tx: number;
  ty: number;
  /** 1 when the pixel is part of the new number, 0 when it fades out. */
  on: number;
  /** Opacity. */
  a: number;
  /** Time the pixel starts springing back; until then it falls. */
  d: number;
}

/** A "+N" label rising from the bar. */
interface Floater {
  t0: number;
  text: string;
}

/** XP bar with a hot leading edge; overflowing it blows the level number apart into the next level. */
class XP extends PxBase {
  static readonly observedAttributes = ["level"] as const;

  /** Current level; read from the `level` attribute on connect. */
  private level = 7;
  /** XP earned towards the next level. */
  private xp = 196;
  /** XP shown by the bar; it catches up with `xp`. */
  private shown = 196;
  /** Pixels of the level number during a level-up; empty while the number rests as text. */
  private pixels: DigitPixel[] = [];
  /** Time the reassembled pixels started handing over to the text, or -1. */
  private handoverAt = -1;
  /** Latest time the pixels hand over, even if a slow frame rate keeps them from settling exactly. */
  private handoverBy = 0;
  private readonly sparks = new Sparks();
  private floaters: Floater[] = [];
  /** Level-up flash, decaying from 1. */
  private flash = 0;
  /** Monospace font stack for the canvas labels, read on layout. */
  private mono = "monospace";
  /** Scratch canvas the level number is sampled from. */
  private sampler: HTMLCanvasElement | null = null;
  private readonly numeral = this.$(".num");
  private readonly digits = this.$(".digits");

  constructor() {
    super(
      `
      :host { display: block; }
      .face { position: relative; }
      canvas.px { height: 104px; }
      .lvl { position: absolute; left: 8px; top: 10px; display: grid; gap: 6px; pointer-events: none; }
      .lab { font-family: var(--_mono); font-size: 10px; line-height: 1; letter-spacing: .06em; text-transform: uppercase; color: var(--_muted); }
      .num { font-family: var(--_mono); font-size: 48px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; transition: opacity .25s; }
      .num.away { opacity: 0; transition: none; }
      .base { display: inline-block; width: 0; height: 0; vertical-align: baseline; }
      .bar { display: flex; gap: 10px; justify-content: space-between; align-items: center; margin-top: 12px; flex-wrap: wrap; }
      .btns { display: flex; gap: 8px; }
      .st { font-size: 12.5px; color: var(--_muted); }
      `,
      `<div class="face"><canvas class="px" role="progressbar" aria-valuemin="0"></canvas><div class="lvl"><span class="lab">Level</span><span class="num"><span class="digits"></span><i class="base"></i></span></div></div><div class="bar"><span class="rollslot st" aria-live="polite"></span><div class="btns"><button class="pbtn a" type="button">+40 XP</button><button class="pbtn b" type="button">+180 XP</button></div></div>`,
    );
    this.$(".a").addEventListener("click", () => this.gain(40));
    this.$(".b").addEventListener("click", () => this.gain(180));
  }

  /** XP needed to finish `level`. */
  private need(level: number = this.level): number {
    return 100 + level * 20;
  }

  protected override init(): void {
    this.level = this.levelAttribute();
    this.digits.textContent = String(this.level);
    rollText(this.$(".st"), "Finish tasks to earn XP", 1, false);
    this.updateLabel();
  }

  attributeChangedCallback(): void {
    // before the first connect, init() reads the attribute; later the number changes in place without `levelup`
    if (!this.initialized) return;
    this.level = this.levelAttribute();
    this.digits.textContent = String(this.level);
    this.updateLabel();
    this.kick();
  }

  /** The `level` attribute as a whole number of at least 0; 7 when it is missing or invalid. */
  private levelAttribute(): number {
    return Math.max(0, Math.round(this.num("level", 7)));
  }

  protected override resized(): void {
    this.mono = this.monoFont;
  }

  /** Expose the bar as a progress bar towards the next level. */
  private updateLabel(): void {
    const canvas = this.cv;
    if (!canvas) return;
    const need = this.need();
    // a gain that overflows is reported as a full bar until the level-up carries it over
    const xp = clamp(Math.floor(this.xp), 0, need);
    canvas.setAttribute("aria-label", `XP towards level ${this.level + 1}`);
    canvas.setAttribute("aria-valuemax", String(need));
    canvas.setAttribute("aria-valuenow", String(xp));
    canvas.setAttribute("aria-valuetext", `${xp} of ${need} XP`);
  }

  /**
   * Adds XP, fires `gain` and animates the bar; overflow carries into the next level. A value that is not a
   * positive number is ignored.
   */
  gain(xp: number): void {
    if (!(Number.isFinite(xp) && xp > 0)) return;
    this.xp += xp;
    this.floaters.push({ t0: now(), text: `+${xp}` });
    this.emit<{ xp: number }>("gain", { xp });
    this.updateLabel();
    this.kick();
  }

  /** Lit points of `text` set like the level number, in canvas coordinates, on a {@link SAMPLE} px grid. */
  private samplePoints(text: string): Point[] {
    const canvas = this.cv;
    if (!canvas) return [];
    const canvasBox = canvas.getBoundingClientRect();
    const textBox = this.digits.getBoundingClientRect();
    const baseBox = this.$(".base").getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(this.numeral).fontSize) || 48;
    const left = textBox.left - canvasBox.left;
    const baseline = baseBox.top - canvasBox.top;
    this.sampler ??= document.createElement("canvas");
    const sampler = this.sampler;
    const W = Math.ceil(fontSize * 0.7 * text.length) + 8;
    const H = Math.ceil(fontSize * 1.2);
    sampler.width = W;
    sampler.height = H;
    const g = sampler.getContext("2d", { willReadFrequently: true });
    if (!g) return [];
    g.clearRect(0, 0, W, H);
    g.font = `600 ${fontSize}px ${this.mono}`;
    g.letterSpacing = `${-0.02 * fontSize}px`;
    g.textBaseline = "alphabetic";
    g.fillStyle = "#fff";
    const sampleBaseline = Math.round(fontSize);
    g.fillText(text, 0, sampleBaseline);
    const data = g.getImageData(0, 0, W, H).data;
    const pts: Point[] = [];
    for (let y = 0; y < H; y += SAMPLE) {
      for (let x = 0; x < W; x += SAMPLE) {
        if (data[(y * W + x) * 4 + 3] > 110) pts.push([left + x, baseline + y - sampleBaseline]);
      }
    }
    return pts;
  }

  /** Blow the old number's pixels apart; they fall, then spring into the new number. */
  private burstDigits(from: string, to: string): void {
    const start = this.samplePoints(from);
    const end = this.samplePoints(to);
    if (!start.length || !end.length) return;
    const t = now();
    const count = Math.max(start.length, end.length);
    this.pixels = Array.from({ length: count }, (_, k): DigitPixel => {
      const [x, y] = start[k % start.length];
      const [tx, ty] = end[k % end.length];
      return {
        x,
        y,
        vx: rand(-170, 170),
        vy: rand(-280, -60),
        tx,
        ty,
        on: k < end.length ? 1 : 0,
        a: k < start.length ? 1 : 0,
        d: t + 0.28 + rand(0, 0.18),
      };
    });
    this.handoverAt = -1;
    this.handoverBy = t + 1.6;
    this.numeral.classList.add("away");
  }

  private levelUp(): void {
    const need = this.need();
    const P = this.P;
    const previous = String(this.level);
    this.shown -= need;
    this.xp -= need;
    this.level++;
    this.flash = 1;
    this.digits.textContent = String(this.level);
    rollText(this.$(".st"), `Level ${this.level} reached`, 1);
    const barW = Math.max(60, this.w - BAR_X - 8);
    for (let k = 0; k < 5; k++) {
      this.sparks.add(BAR_X + (barW * k) / 4, 72, 10, [P.accent, P.shine, P.ok], {
        speed: [40, 170],
        angle: -Math.PI / 2,
        spread: Math.PI * 1.2,
      });
    }
    if (!reduced()) this.burstDigits(previous, String(this.level));
    this.emit<{ level: number }>("levelup", { level: this.level });
    this.updateLabel();
  }

  /** Move the number's pixels; once they rest, hand over to the text. Returns whether any is still visible. */
  private drawDigits(dt: number, t: number): boolean {
    if (!this.pixels.length) return false;
    const P = this.P;
    let moving = false;
    for (const p of this.pixels) {
      if (t >= p.d) {
        const stiffness = 200;
        const damping = 2 * Math.sqrt(stiffness) * 0.62;
        p.vx += (stiffness * (p.tx - p.x) - damping * p.vx) * dt;
        p.vy += (stiffness * (p.ty - p.y) - damping * p.vy) * dt;
      } else {
        p.vy += 500 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.a += clamp(p.on - p.a, -dt * 4, dt * 4);
      if (t < p.d || Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.3 || Math.abs(p.on - p.a) > 0.01) moving = true;
    }
    if ((!moving || t > this.handoverBy) && this.handoverAt < 0) {
      this.handoverAt = t;
      this.numeral.classList.remove("away");
    }
    // the pixels fade while the text fades in over them
    const fade = this.handoverAt < 0 ? 1 : 1 - clamp((t - this.handoverAt) / HANDOVER, 0, 1);
    if (fade <= 0) {
      this.pixels = [];
      return false;
    }
    for (const p of this.pixels) {
      const speed = Math.min(1, Math.hypot(p.vx, p.vy) / 300);
      const alpha = p.a * fade;
      const color = mix(P.fg, P.accent, Math.max(speed, this.flash * 0.8));
      if (alpha > 0.01) this.dot(p.x - 1.2, p.y - 1.2, color, alpha, 2.6);
    }
    return true;
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    const still = reduced();
    if (this.shown < this.xp) {
      this.shown = still ? this.xp : Math.min(this.xp, this.shown + Math.max(70, (this.xp - this.shown) * 2.4) * dt);
    }
    if (this.shown >= this.need()) this.levelUp();
    this.flash = Math.max(0, this.flash - dt * 2);
    this.clear();
    const moving = this.drawDigits(dt, t);

    const barW = Math.max(60, this.w - BAR_X - 8);
    const columns = Math.floor(barW / 4);
    const f = clamp(this.shown / this.need(), 0, 1);
    g.font = `10px ${this.mono}`;
    g.textBaseline = "alphabetic";
    g.fillStyle = css(P.muted);
    g.globalAlpha = 0.95;
    g.textAlign = "left";
    g.fillText(`${Math.floor(this.shown)} / ${this.need()} XP`, BAR_X, BAR_Y - 10);
    g.textAlign = "right";
    g.fillText(`LV ${this.level + 1}`, BAR_X + barW, BAR_Y - 10);
    g.globalAlpha = 1;
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < 3; r++) {
        const u = (c + 0.5) / columns;
        const on = u <= f;
        // the last three columns of the fill are the hot leading edge
        const edge = on && u > f - 3 / columns;
        let color = P.accent;
        if (this.flash > 0) color = mix(P.accent, P.shine, this.flash);
        else if (edge) color = mix(P.accent, P.shine, 0.7);
        this.dot(BAR_X + c * 4, BAR_Y + r * 4, on ? color : P.fg, on ? 0.95 : 0.12, 2.8);
      }
    }
    g.font = `600 12px ${this.mono}`;
    g.textAlign = "left";
    g.fillStyle = css(P.accent);
    this.floaters = this.floaters.filter((floater) => {
      const age = t - floater.t0;
      if (age > 1) return false;
      const x = Math.min(BAR_X + barW - g.measureText(floater.text).width, BAR_X + f * barW);
      g.globalAlpha = 1 - age;
      g.fillText(floater.text, x, BAR_Y - 20 - age * 26);
      return true;
    });
    g.globalAlpha = 1;
    const sparking = this.sparks.step(g, dt);
    return this.shown < this.xp || this.flash > 0 || this.floaters.length > 0 || sparking || moving;
  }
}

define("px-xp", XP);

export { XP };

declare global {
  interface HTMLElementTagNameMap {
    "px-xp": XP;
  }
}
