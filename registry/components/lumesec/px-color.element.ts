/**
 * <px-color> · Pixel colour picker
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/color
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-color.tsx.
 */
import { PxBase, TAU, clamp, define, hsl, now, reduced, rollText, toHex, type Point } from "@/lib/lumesec/pixel";

/** Events fired by `<px-color>`. */
export interface ColorPickEventMap {
  /** Fires when the selected cell or the hue changes, with the colour as lowercase `#rrggbb`. */
  change: CustomEvent<{ hex: string }>;
}

/** Grid size: saturation across, lightness down. */
const COLS = 16;
const ROWS = 9;

/** Swatches in the hue strip, 10° apart. */
const HUE_SWATCHES = 36;

/** Duration of the hue ripple across the grid, in units of 1/3 s. */
const RIPPLE_END = 1.6;

const ARROWS: Partial<Record<string, Point>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

/** What the pointer is over: a grid cell `[column, row]` or a hue fraction in `[0, 1)` on the strip. */
type Hit = { grid: Point } | { hue: number };

/** Signed shortest difference `a - b` between two hues, in `[-180, 180)`. */
const hueDelta = (a: number, b: number): number => ((a - b + 540) % 360) - 180;

/** Saturation and lightness of grid cell `(c, r)`. */
const cellSL = (c: number, r: number): [s: number, l: number] => [
  0.15 + (0.85 * c) / (COLS - 1),
  0.88 - (0.76 * r) / (ROWS - 1),
];

/**
 * Colour picker made of pixel cells with a fisheye under the pointer; a new hue ripples across the grid from where you
 * clicked.
 */
class ColorPick extends PxBase {
  private currentHex = "";
  private hue = 262;
  /** Hue before the last change; the grid ripples from it to {@link ColorPick.hue}. */
  private oldHue = 262;
  /** Time of the last hue change. */
  private hueTime = -9;
  /** Grid column the hue ripple starts from. */
  private hueCol = COLS / 2;
  /** Hue currently shown at the ripple front, or null before the first frame. */
  private shownHue: number | null = null;
  /** Selected cell `[column, row]`. */
  private selected: Point = [12, 3];
  private hover: Hit | null = null;
  /** Selection pop, 1 on a new cell, easing to 0. */
  private pop = 0;
  private drag = false;
  private copyTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      canvas.px { height: 196px; cursor: crosshair; touch-action: none; border-radius: 10px; }
      .bar { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
      .sw { width: 34px; height: 34px; border-radius: 9px; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_fg) 15%, transparent); flex: none; transition: background-color .25s; }
      .hex { font-family: var(--_mono); font-size: 15px; font-weight: 500; }
      .hsl { font-size: 12px; color: var(--_muted); }
      .grow { display: grid; gap: 2px; flex: 1; min-width: 0; }
      `,
      `<canvas class="px" tabindex="0" role="group" aria-label="Colour picker. Arrow keys move in the grid, Page Up and Page Down change the hue."></canvas>
        <div class="bar"><span class="sw"></span><span class="grow"><span class="rollslot hex" aria-live="polite"></span><span class="hsl"></span></span><button class="pbtn copy" type="button">Copy</button></div>`,
    );
    const canvas = this.canvas;
    canvas.addEventListener("pointermove", (e) => {
      this.hover = this.hitAt(e);
      this.kick();
      if (this.drag) this.pick(e);
    });
    canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.kick();
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = true;
      this.pick(e);
    });
    const up = (): void => {
      this.drag = false;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("keydown", (e) => {
      const move = ARROWS[e.key];
      if (move) {
        e.preventDefault();
        const c = clamp(this.selected[0] + move[0], 0, COLS - 1);
        const r = clamp(this.selected[1] + move[1], 0, ROWS - 1);
        // at the edge of the grid the selection stays put and nothing fires
        if (c === this.selected[0] && r === this.selected[1]) return;
        this.selected = [c, r];
        this.pop = 1;
        this.update(false);
      }
      if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        this.changeHue(this.hue + (e.key === "PageUp" ? 15 : -15), COLS / 2);
      }
    });
    const copyButton = this.$<HTMLButtonElement>(".copy");
    copyButton.addEventListener("click", async () => {
      let ok = true;
      try {
        await navigator.clipboard.writeText(this.currentHex);
      } catch {
        ok = false;
      }
      copyButton.textContent = ok ? "Copied" : "Select it";
      clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1400);
    });
  }

  protected override init(): void {
    this.update(true);
  }

  /** Current colour as lowercase `#rrggbb`. */
  get hex(): string {
    return this.currentHex;
  }

  /** Layout: cell size, grid height, and top and height of the hue strip. */
  private geometry(): { cell: number; gridH: number; stripY: number; stripH: number } {
    const cell = this.w / COLS;
    const gridH = cell * ROWS;
    return { cell, gridH, stripY: gridH + 10, stripH: this.h - gridH - 10 };
  }

  private hitAt(e: PointerEvent): Hit | null {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const { cell, gridH, stripY } = this.geometry();
    if (y < gridH) {
      return { grid: [clamp(Math.floor(x / cell), 0, COLS - 1), clamp(Math.floor(y / cell), 0, ROWS - 1)] };
    }
    if (y >= stripY) return { hue: clamp(x / this.w, 0, 0.999) };
    return null;
  }

  private pick(e: PointerEvent): void {
    const hit = this.hitAt(e);
    if (!hit) return;
    if ("grid" in hit) {
      const [c, r] = hit.grid;
      if (c !== this.selected[0] || r !== this.selected[1]) {
        this.selected = hit.grid;
        this.pop = 1;
        this.update(false);
      }
    } else {
      this.changeHue(Math.round(hit.hue * 360), hit.hue * COLS);
    }
  }

  /**
   * Sets the hue in degrees (rounded and wrapped to 0 to 359), ripples it across the grid and fires `change`.
   * A value that is not a finite number is ignored.
   */
  setHue(hue: number): void {
    this.changeHue(hue, COLS / 2);
  }

  /** Change the hue with a ripple that starts at grid column `fromCol`. */
  private changeHue(hue: number, fromCol: number): void {
    if (!Number.isFinite(hue)) return;
    const h = ((Math.round(hue) % 360) + 360) % 360;
    if (h === this.hue) return;
    this.oldHue = this.shownHue ?? this.hue;
    this.hue = h;
    this.hueTime = now();
    this.hueCol = fromCol;
    this.update(false);
  }

  /** Recompute the colour and readouts; `first` (connect) shows it without the roll and without `change`. */
  private update(first: boolean): void {
    const [s, l] = cellSL(this.selected[0], this.selected[1]);
    this.currentHex = toHex(hsl(this.hue, s, l));
    rollText(this.$(".hex"), this.currentHex.toUpperCase(), 1, !first);
    this.$(".hsl").textContent = `hsl(${this.hue} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
    this.$(".sw").style.background = this.currentHex;
    if (!first) this.emit<{ hex: string }>("change", { hex: this.currentHex });
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const still = reduced();
    const { cell, stripY, stripH } = this.geometry();
    this.pop = Math.max(0, this.pop - dt * 3);
    const ripple = still ? 1 : clamp((t - this.hueTime) * 3, 0, RIPPLE_END);
    const dh = hueDelta(this.hue, this.oldHue);
    this.shownHue = this.oldHue + dh * clamp(ripple, 0, 1);
    const hoverCell = this.hover && "grid" in this.hover && !still ? this.hover.grid : null;
    this.clear();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // the new hue spreads outwards from the column it was picked at
        const lag = still ? 1 : clamp(ripple * 1.6 - Math.abs(c - this.hueCol) * 0.06, 0, 1);
        const [s, l] = cellSL(c, r);
        const color = hsl(this.oldHue + dh * lag, s, l);
        let scale = 0.7;
        if (hoverCell) {
          const d2 = (c - hoverCell[0]) ** 2 + (r - hoverCell[1]) ** 2;
          scale += 0.45 * Math.exp(-d2 / 2.2);
        }
        const isSelected = c === this.selected[0] && r === this.selected[1];
        if (isSelected) scale += 0.25 + Math.sin(this.pop * Math.PI) * 0.3;
        const size = cell * Math.min(1.05, scale);
        this.dot(c * cell + (cell - size) / 2, r * cell + (cell - size) / 2, color, 1, size);
        if (isSelected) {
          // a ring of dots orbits the selected cell; it holds still under reduced motion
          for (let k = 0; k < 12; k++) {
            const a = (TAU * k) / 12 + (still ? 0 : t);
            const x = c * cell + cell / 2 + Math.cos(a) * cell * 0.85 - 1;
            const y = r * cell + cell / 2 + Math.sin(a) * cell * 0.85 - 1;
            this.dot(x, y, P.fg, 0.9, 2);
          }
        }
      }
    }
    const swatchW = this.w / HUE_SWATCHES;
    for (let k = 0; k < HUE_SWATCHES; k++) {
      const swatchHue = k * 10;
      const near = Math.abs(hueDelta(swatchHue, this.hue)) < 5;
      const size = swatchW * (near ? 0.95 : 0.7);
      this.dot(k * swatchW + (swatchW - size) / 2, stripY + (stripH - size) / 2, hsl(swatchHue, 0.75, 0.55), 1, size);
    }
    const markerX = (this.hue / 360) * this.w;
    for (let y = stripY - 3; y < stripY + stripH + 3; y += 3) this.dot(markerX - 1, y, P.fg, 0.9, 2);
    // the selection ring keeps orbiting, so the loop only idles under reduced motion
    return !still || this.pop > 0;
  }
}

define("px-color", ColorPick);

export { ColorPick };

declare global {
  interface HTMLElementTagNameMap {
    "px-color": ColorPick;
  }
}
