/**
 * <px-spinners> · Pixel loaders
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/spinners
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-spinners.tsx.
 */
import {
  PxBase,
  SMALL_CHECK,
  clamp,
  css,
  define,
  mix,
  now,
  reduced,
  type Palette,
  type Point,
} from "@/lib/lumesec/pixel";

const SPIN = ["Orbit", "Snake", "Helix", "Scan", "Rain", "Pulse"] as const;

/** Name of one of the six loaders. */
export type LoaderName = (typeof SPIN)[number];

/** Events fired by `<px-spinners>`. */
export interface SpinnersEventMap {
  /**
   * Fires when a loader is finished, by click, Finish all or `finish()`. `loader` is `Orbit`, `Snake`, `Helix`,
   * `Scan`, `Rain` or `Pulse`.
   */
  finish: CustomEvent<{ loader: LoaderName }>;
}

/** How long the check shows before the loader restarts, in seconds. */
const CHECK_TIME = 1.6;

/** Orbit rings: radius in px and angular speed in rad/s (negative runs backwards). */
const ORBITS: readonly (readonly [radius: number, speed: number])[] = [
  [10, 3.2],
  [18, 2.1],
  [26, -1.5],
];

/** Rain well size: columns and rows. */
const WELL_COLS = 6;
const WELL_ROWS = 7;

/** The 20 border cells of a 6×6 square, clockwise from the top-left corner. */
function snakePerimeter(): Point[] {
  const cells: Point[] = [];
  for (let k = 0; k < 5; k++) cells.push([k, 0]);
  for (let k = 0; k < 5; k++) cells.push([5, k]);
  for (let k = 5; k > 0; k--) cells.push([k, 5]);
  for (let k = 5; k > 0; k--) cells.push([0, k]);
  return cells;
}

const PERIMETER = snakePerimeter();

/** A falling rain block: well column and row. */
interface Drop {
  col: number;
  row: number;
}

/**
 * Six pixel loading indicators (orbit, snake, helix, scan, rain, pulse); clicking one finishes it with a check before
 * it restarts.
 */
class Spinners extends PxBase {
  /** Finish time per loader. */
  private readonly doneAt: number[] = new Array<number>(SPIN.length).fill(-9);
  /** Settled rain blocks per column, top row first; 1 is filled. */
  private readonly well: number[][] = Array.from({ length: WELL_COLS }, () => new Array<number>(WELL_ROWS).fill(0));
  private drop: Drop | null = null;
  /** Time of the last rain step. */
  private rainTime = 0;
  /** Time the bottom row last cleared. */
  private clearTime = -9;
  /** Monospace font stack for the labels, read on layout. */
  private mono = "monospace";
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      canvas.px { height: 216px; cursor: pointer; }
      .bar { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 10px; }
      .hint { font-size: 12px; color: var(--_muted); }
      `,
      `<canvas class="px" role="img" aria-label="Six pixel loading indicators: orbit, snake, helix, scan, rain and pulse"></canvas><div class="bar"><span class="hint">Click one to finish it.</span><button class="pbtn all" type="button">Finish all</button></div>`,
    );
    this.canvas.addEventListener("click", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const i = this.loaderAt(e.clientX - r.left, e.clientY - r.top);
      if (i >= 0) this.finish(i);
    });
    this.$(".all").addEventListener("click", () => {
      SPIN.forEach((_, i) => setTimeout(() => this.finish(i), i * 90));
    });
  }

  protected override resized(): void {
    this.mono = this.monoFont;
  }

  /** Size of one loader's cell in the 3×2 grid. */
  private cellSize(): { cw: number; ch: number } {
    return { cw: this.w / 3, ch: this.h / 2 };
  }

  /** The loader under a canvas position, or -1. */
  private loaderAt(x: number, y: number): number {
    const { cw, ch } = this.cellSize();
    const c = Math.floor(x / cw);
    const r = Math.floor(y / ch);
    return c >= 0 && c < 3 && r >= 0 && r < 2 ? r * 3 + c : -1;
  }

  /**
   * Shows the check on loader 0 to 5 for 1.6 seconds, then restarts it, and fires `finish`. Other values are
   * ignored.
   */
  finish(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= SPIN.length) return;
    this.doneAt[index] = now();
    this.emit<{ loader: LoaderName }>("finish", { loader: SPIN[index] });
    this.kick();
  }

  protected override render(t: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const { cw, ch } = this.cellSize();
    // reduced motion freezes every loader on one frame
    const still = reduced();
    const time = still ? 0.6 : t;
    this.clear();
    ctx.font = `10.5px ${this.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < SPIN.length; i++) {
      const cx = (i % 3) * cw + cw / 2;
      const cy = Math.floor(i / 3) * ch + ch / 2 - 8;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = css(P.muted);
      ctx.fillText(SPIN[i], cx, cy + 46);
      ctx.globalAlpha = 1;
      const sinceDone = t - this.doneAt[i];
      if (sinceDone < CHECK_TIME) {
        const s = 3.2 * (1 + Math.sin(clamp(sinceDone / 0.35, 0, 1) * Math.PI) * 0.3);
        for (const [x, y] of SMALL_CHECK) this.dot(cx - 3.5 * s + x * s, cy - 2.5 * s + y * s, P.ok, 1, s * 0.85);
        continue;
      }
      this.drawLoader(i, cx, cy, time, P);
    }
    // still loaders need frames only while a check is showing
    return !still || this.doneAt.some((at) => t - at < CHECK_TIME);
  }

  private drawLoader(i: number, cx: number, cy: number, t: number, P: Palette): void {
    switch (i) {
      case 0:
        return this.orbit(cx, cy, t, P);
      case 1:
        return this.snake(cx, cy, t, P);
      case 2:
        return this.helix(cx, cy, t, P);
      case 3:
        return this.scan(cx, cy, t, P);
      case 4:
        return this.rain(cx, cy, t, P);
      default:
        return this.pulse(cx, cy, t, P);
    }
  }

  /** Three rings of comets at different speeds around a centre dot. */
  private orbit(cx: number, cy: number, t: number, P: Palette): void {
    for (const [r, speed] of ORBITS) {
      for (let k = 0; k < 7; k++) {
        const a = t * speed - k * 0.16 * Math.sign(speed);
        this.dot(cx + Math.cos(a) * r - 1.5, cy + Math.sin(a) * r - 1.5, k ? P.accent : P.shine, 1 - k * 0.13, 3);
      }
    }
    this.dot(cx - 1.5, cy - 1.5, P.fg, 0.5, 3);
  }

  /** A seven-cell snake running around a square track. */
  private snake(cx: number, cy: number, t: number, P: Palette): void {
    const n = PERIMETER.length;
    const head = Math.floor(t * 14) % n;
    for (const [x, y] of PERIMETER) this.dot(cx - 21 + x * 8, cy - 21 + y * 8, P.fg, 0.1, 5);
    for (let k = 0; k < 7; k++) {
      const [x, y] = PERIMETER[(head - k + n) % n];
      this.dot(cx - 21 + x * 8, cy - 21 + y * 8, k ? P.accent : P.shine, 1 - k * 0.13, 5);
    }
  }

  /** Two strands of a turning double helix; the front strand is lit. */
  private helix(cx: number, cy: number, t: number, P: Palette): void {
    for (let i = 0; i < 12; i++) {
      const x = cx - 26 + i * 4.8;
      const phase = t * 4 + i * 0.55;
      const s = Math.sin(phase);
      const depth = Math.cos(phase);
      this.dot(x - 1.5, cy + s * 14 - 1.5, depth > 0 ? P.accent : P.fg, depth > 0 ? 1 : 0.35, 3);
      this.dot(x - 1.5, cy - s * 14 - 1.5, depth < 0 ? P.accent : P.fg, depth < 0 ? 1 : 0.35, 3);
    }
  }

  /** A diagonal band sweeping across a 7×7 grid. */
  private scan(cx: number, cy: number, t: number, P: Palette): void {
    const d = ((t * 1.5) % 1.5) * 13 - 1;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const k = Math.exp(-((c + r - d) ** 2) / 1.8);
        this.dot(cx - 24 + c * 8, cy - 24 + r * 8, mix(P.fg, P.accent, k), 0.12 + 0.88 * k, 4);
      }
    }
  }

  /** Falling blocks stack up in a well; a full bottom row flashes and clears. */
  private rain(cx: number, cy: number, t: number, P: Palette): void {
    const well = this.well;
    if (t - this.rainTime > 0.09) {
      this.rainTime = t;
      if (!this.drop) {
        this.drop = { col: (Math.random() * WELL_COLS) | 0, row: 0 };
      } else {
        const column = well[this.drop.col];
        const floor = WELL_ROWS - 1 - column.filter((x) => x).length;
        if (this.drop.row < floor) {
          this.drop.row++;
        } else {
          column[floor] = 1;
          this.drop = null;
        }
      }
      if (well.every((column) => column[WELL_ROWS - 1])) {
        this.clearTime = t;
        for (const column of well) {
          column.pop();
          column.unshift(0);
        }
      }
    }
    const flash = Math.max(0, 1 - (t - this.clearTime) * 3);
    for (let c = 0; c < WELL_COLS; c++) {
      for (let r = 0; r < WELL_ROWS; r++) {
        const on = well[c][r];
        this.dot(cx - 22 + c * 8, cy - 26 + r * 8, on ? P.accent : P.fg, on ? 0.9 : 0.08, 5);
      }
    }
    if (flash > 0) {
      for (let c = 0; c < WELL_COLS; c++) this.dot(cx - 22 + c * 8, cy - 26 + 6 * 8, P.shine, flash, 5);
    }
    if (this.drop) this.dot(cx - 22 + this.drop.col * 8, cy - 26 + this.drop.row * 8, P.shine, 1, 5);
  }

  /** Rings rippling outwards from the centre of a 7×7 grid. */
  private pulse(cx: number, cy: number, t: number, P: Palette): void {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const d = Math.hypot(c - 3, r - 3);
        const k = 0.5 + 0.5 * Math.cos(d * 1.3 - t * 5);
        this.dot(cx - 24 + c * 8, cy - 24 + r * 8, mix(P.fg, P.accent, k), 0.15 + 0.85 * k * (1 - d / 6), 4);
      }
    }
  }
}

define("px-spinners", Spinners);

export { Spinners };

declare global {
  interface HTMLElementTagNameMap {
    "px-spinners": Spinners;
  }
}
