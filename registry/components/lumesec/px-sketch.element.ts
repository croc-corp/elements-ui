/**
 * <px-sketch> · Mirror sketchpad
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/sketch
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-sketch.tsx.
 */
import { PxBase, clamp, define, now, rand, reduced, type PaletteKey, type Point } from "@/lib/lumesec/pixel";

/** Events fired by `<px-sketch>`. */
export interface SketchEventMap {
  /** Fires at the end of each pointer stroke and after each cell painted or erased with Space or Enter. */
  change: CustomEvent<Record<string, never>>;
  /** Fires when the pad is cleared. */
  clear: CustomEvent<Record<string, never>>;
}

/** Cells per side. */
const SIZE = 16;
const CELLS = SIZE * SIZE;

/** Sample drawing; digits are 1-based indices into {@link INKS}. */
const ROBOT = [
  "................",
  "................",
  ".......44.......",
  ".......44.......",
  "....11111111....",
  "...1........1...",
  "...1.22..22.1...",
  "...1.22..22.1...",
  "...1........1...",
  "...1..3333..1...",
  "...1........1...",
  "....11111111....",
  ".....1....1.....",
  "....11....11....",
  "................",
  "................",
];

/** The paint colours, as palette keys; a cell stores an index into this list, -1 when empty. */
const INKS: readonly PaletteKey[] = ["fg", "accent", "ok", "warn", "danger"];

/** Names of the inks for the swatch labels and the cursor announcement. */
const INK_NAMES: readonly string[] = ["Ink", "Accent", "Success", "Warning", "Danger"];

const ARROWS: Partial<Record<string, Point>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

/** A painted cell dropping off the pad after Clear; it starts falling at time `delay`. */
interface FallingCell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ink: number;
  delay: number;
}

/**
 * 16x16 pixel drawing pad with mirror mode for symmetric strokes; cells pop as you paint and Clear drops every pixel
 * with gravity.
 */
class Sketch extends PxBase {
  /** Ink index per cell, row-major; -1 is empty. */
  private readonly grid = new Int8Array(CELLS).fill(-1);
  /** Paint pop per cell, 1 when painted, easing to 0. */
  private readonly pop = new Float32Array(CELLS);
  /** Index of the current ink. */
  private ink = 1;
  private mirror = true;
  private falling: FallingCell[] = [];
  /** Keyboard cursor `[column, row]`. */
  private cursor: Point = [8, 8];
  /** Whether the current stroke erases. */
  private erase = false;
  /** Last cell of the current pointer stroke, or null between strokes. */
  private last: Point | null = null;
  private focused = false;

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: grid; gap: 12px; justify-items: center; }
      canvas.px { width: 224px; height: 224px; touch-action: none; cursor: crosshair; border-radius: 10px; background: var(--_track); }
      .tools { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; }
      .sw { display: flex; gap: 6px; }
      .sw button { width: 26px; height: 26px; border-radius: 7px; border: 2px solid transparent; cursor: pointer; padding: 0; }
      .sw button[aria-pressed="true"] { border-color: var(--_fg); }
      .note { font-size: 11.5px; color: var(--_muted); text-align: center; flex-basis: 100%; }
      `,
      `<div class="wrap"><canvas class="px" tabindex="0" role="img" aria-label="16 by 16 pixel drawing pad"></canvas><div class="tools">
        <div class="sw" role="group" aria-label="Colour"></div>
        <button class="pbtn mir" type="button" aria-pressed="true">Mirror</button>
        <button class="pbtn clr" type="button">Clear</button>
        <span class="note">Starts with a sample drawing. Drag to paint; start on a filled cell of the same colour to erase.</span></div></div><span class="sr" aria-live="polite"></span>`,
    );
    const swatches = this.$(".sw");
    INKS.forEach((key, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.style.background = `var(--_${key})`;
      button.setAttribute("aria-label", INK_NAMES[i]);
      button.setAttribute("aria-pressed", String(i === this.ink));
      button.addEventListener("click", () => {
        this.ink = i;
        this.$$(".sw button").forEach((other, j) => other.setAttribute("aria-pressed", String(j === i)));
      });
      swatches.appendChild(button);
    });
    const mirrorButton = this.$<HTMLButtonElement>(".mir");
    mirrorButton.addEventListener("click", () => {
      this.mirror = !this.mirror;
      mirrorButton.setAttribute("aria-pressed", String(this.mirror));
    });
    this.$(".clr").addEventListener("click", () => this.clearAll());

    const canvas = this.$("canvas");
    const cellAt = (e: PointerEvent): Point => {
      const r = canvas.getBoundingClientRect();
      return [
        clamp(Math.floor(((e.clientX - r.left) / r.width) * SIZE), 0, SIZE - 1),
        clamp(Math.floor(((e.clientY - r.top) / r.height) * SIZE), 0, SIZE - 1),
      ];
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = cellAt(e);
      // starting on a cell of the current ink erases
      this.erase = this.grid[y * SIZE + x] === this.ink;
      this.last = [x, y];
      this.paint(x, y);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.last) return;
      const [x, y] = cellAt(e);
      const [lx, ly] = this.last;
      // fill the cells between two samples so fast strokes leave no gaps
      const n = Math.max(Math.abs(x - lx), Math.abs(y - ly));
      for (let k = 1; k <= n; k++) this.paint(Math.round(lx + ((x - lx) * k) / n), Math.round(ly + ((y - ly) * k) / n));
      this.last = [x, y];
    });
    const up = (): void => {
      if (!this.last) return;
      this.last = null;
      this.emit("change");
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("keydown", (e) => {
      const move = ARROWS[e.key];
      if (move) {
        e.preventDefault();
        this.cursor = [clamp(this.cursor[0] + move[0], 0, SIZE - 1), clamp(this.cursor[1] + move[1], 0, SIZE - 1)];
        this.announceCursor();
        this.kick();
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        const [x, y] = this.cursor;
        this.erase = this.grid[y * SIZE + x] === this.ink;
        this.paint(x, y);
        this.announceCursor();
        this.emit("change");
      }
    });
    canvas.addEventListener("focus", () => {
      this.focused = true;
      this.kick();
    });
    canvas.addEventListener("blur", () => {
      this.focused = false;
      this.kick();
    });
  }

  protected override init(): void {
    ROBOT.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch !== ".") this.grid[y * SIZE + x] = Number(ch) - 1;
      });
    });
  }

  /** Report the cursor cell and its colour; the canvas only draws them. */
  private announceCursor(): void {
    const [x, y] = this.cursor;
    const value = this.grid[y * SIZE + x];
    this.$(".sr").textContent = `Row ${y + 1}, column ${x + 1}, ${value < 0 ? "empty" : INK_NAMES[value]}`;
  }

  /** Paint (or erase) a cell, and its mirror image when mirroring. */
  private paint(x: number, y: number): void {
    const value = this.erase ? -1 : this.ink;
    for (const xx of this.mirror ? [x, SIZE - 1 - x] : [x]) {
      const i = y * SIZE + xx;
      if (this.grid[i] !== value) {
        this.grid[i] = value;
        this.pop[i] = reduced() ? 0 : 1;
      }
    }
    this.kick();
  }

  /**
   * Drops every painted cell off the bottom of the pad (with reduced motion, removes them at once) and fires
   * `clear`.
   */
  clearAll(): void {
    const cellSize = this.w / SIZE;
    const start = now();
    for (let i = 0; i < CELLS; i++) {
      if (this.grid[i] < 0) continue;
      const x = i % SIZE;
      const y = Math.floor(i / SIZE);
      if (!reduced()) {
        // lower rows fall first
        this.falling.push({
          x: x * cellSize + 1,
          y: y * cellSize + 1,
          vx: rand(-40, 40),
          vy: rand(-120, 0),
          ink: this.grid[i],
          delay: start + (SIZE - 1 - y) * 0.02 + rand(0, 0.05),
        });
      }
      this.grid[i] = -1;
    }
    this.emit("clear");
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const cs = this.w / SIZE;
    const colors = INKS.map((key) => P[key]);
    let busy = false;
    this.clear();
    for (let i = 0; i < CELLS; i++) {
      const x = i % SIZE;
      const y = Math.floor(i / SIZE);
      const value = this.grid[i];
      if (this.pop[i] > 0) {
        this.pop[i] = Math.max(0, this.pop[i] - dt * 4);
        busy = true;
      }
      if (value < 0) {
        this.dot(x * cs + cs / 2 - 0.8, y * cs + cs / 2 - 0.8, P.fg, 0.16, 1.6);
        continue;
      }
      const s = (cs - 2) * (1 + Math.sin(this.pop[i] * Math.PI) * 0.3);
      this.dot(x * cs + (cs - s) / 2, y * cs + (cs - s) / 2, colors[value], 1, s);
    }
    if (this.mirror) {
      for (let y = 0; y < this.h; y += 6) this.dot(this.w / 2 - 0.5, y, P.accent, 0.18, 1);
    }
    if (this.focused) {
      const [x, y] = this.cursor;
      const left = x * cs;
      const top = y * cs;
      for (let k = 0; k < 8; k++) {
        const along = (k * cs) / 8;
        this.dot(left + along, top, P.accent, 0.9, 1.6);
        this.dot(left + along, top + cs - 1.6, P.accent, 0.9, 1.6);
        this.dot(left, top + along, P.accent, 0.9, 1.6);
        this.dot(left + cs - 1.6, top + along, P.accent, 0.9, 1.6);
      }
    }
    this.falling = this.falling.filter((p) => {
      if (t >= p.delay) {
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      if (p.y > this.h + 20) return false;
      this.dot(p.x, p.y, colors[p.ink], 1, cs - 2);
      return true;
    });
    return busy || this.falling.length > 0;
  }
}

define("px-sketch", Sketch);

export { Sketch };

declare global {
  interface HTMLElementTagNameMap {
    "px-sketch": Sketch;
  }
}
