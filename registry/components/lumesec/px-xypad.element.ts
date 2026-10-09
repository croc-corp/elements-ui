/**
 * <px-xypad> · Sampling pad
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/xypad
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-xypad.tsx.
 */
import { PxBase, TAU, clamp, define, mix, reduced, type Point } from "@/lib/lumesec/pixel";

/** A pad position: `x` is temperature, `y` is top-p, both 0 to 1. */
export interface XYPadValue {
  x: number;
  y: number;
}

/** Events fired by `<px-xypad>`. */
export interface XYPadEventMap {
  /** Fires continuously while dragging. Values are 0 to 1, rounded to two decimals. */
  input: CustomEvent<XYPadValue>;
  /** Fires when the puck settles: on pointer release (snapped to 0.05), on arrow keys and on double-click reset. */
  change: CustomEvent<XYPadValue>;
}

/** A recent drag position; the trail fades over 0.6 seconds. */
interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

/** A ring spreading from where the puck was grabbed or settled. */
interface Ripple {
  x: number;
  y: number;
  t0: number;
  /** Strength. */
  s: number;
}

/** Arrow keys and the direction each moves the puck. */
const ARROW_STEPS: Partial<Record<string, Point>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** Starting position, also the double-click reset. */
const HOME: XYPadValue = { x: 0.7, y: 0.9 };
/** Spacing of the dot field in px. */
const PITCH = 8;

/** Round to the 0.05 grid. */
const snap = (v: number): number => Math.round(v * 20) / 20;

/** Two-axis pad for temperature and top-p on a glowing pixel field. */
class XYPad extends PxBase {
  /** Puck position, 0 to 1 on each axis. */
  private x = HOME.x;
  private y = HOME.y;
  /** Where the puck springs to. */
  private tx = HOME.x;
  private ty = HOME.y;
  private vx = 0;
  private vy = 0;
  private dragging = false;
  private snapping = false;
  private trail: TrailPoint[] = [];
  private ripples: Ripple[] = [];
  private lastTrailAt = 0;
  /** Last values written to the readout. */
  private shownX = "";
  private shownY = "";

  constructor() {
    super(
      `
      :host { display: block; }
      .pad { position: relative; border-radius: 12px; background: var(--_track); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_fg) 8%, transparent); touch-action: none; cursor: crosshair; }
      canvas.px { height: 200px; border-radius: 12px; }
      .ax { position: absolute; font-family: var(--_mono); font-size: 10.5px; color: var(--_muted); pointer-events: none; }
      .ax-x { right: 10px; bottom: 7px; } .ax-y { left: 10px; top: 8px; }
      .vals { display: flex; justify-content: space-between; margin-top: 10px; font-size: 13px; color: var(--_muted); }
      .vals b { color: var(--_fg); font-weight: 600; font-variant-numeric: tabular-nums; margin-left: 6px; }
      `,
      `<div class="pad" tabindex="0" role="group" aria-label="Sampling pad: temperature and top-p. Arrow keys move, double-click resets."><canvas class="px"></canvas><span class="ax ax-x">temperature →</span><span class="ax ax-y">↑ top-p</span></div>
        <div class="vals"><span>Temperature<b class="vx"></b></span><span>Top-p<b class="vy"></b></span></div><span class="sr" aria-live="polite"></span>`,
    );
    const pad = this.$(".pad");
    const at = (e: PointerEvent): Point => {
      const r = pad.getBoundingClientRect();
      return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)];
    };
    pad.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      pad.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.snapping = false;
      [this.x, this.y] = at(e);
      this.ripple(this.x, this.y, 0.6);
      this.kick();
    });
    pad.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      [this.x, this.y] = at(e);
      if (this.t - this.lastTrailAt > 0.025) {
        this.lastTrailAt = this.t;
        this.trail.push({ x: this.x, y: this.y, t: this.t });
        if (this.trail.length > 24) this.trail.shift();
      }
      this.emit<XYPadValue>("input", { x: +this.x.toFixed(2), y: +this.y.toFixed(2) });
      this.kick();
    });
    const up = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.settle(snap(this.x), snap(this.y));
    };
    pad.addEventListener("pointerup", up);
    pad.addEventListener("pointercancel", up);
    pad.addEventListener("dblclick", () => this.settle(HOME.x, HOME.y));
    pad.addEventListener("keydown", (e) => {
      const step = ARROW_STEPS[e.key];
      if (!step) return;
      e.preventDefault();
      this.settle(clamp(snap(this.tx + step[0] * 0.05), 0, 1), clamp(snap(this.ty + step[1] * 0.05), 0, 1));
      // the readout below changes every frame while the puck moves, so the new values are announced here
      this.$(".sr").textContent = `Temperature ${this.tx.toFixed(2)}, top-p ${this.ty.toFixed(2)}`;
    });
  }

  /**
   * Springs the puck to the given position (each axis limited to 0 to 1) and fires `change`. Values that are not
   * finite numbers are ignored.
   */
  settle(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.tx = clamp(x, 0, 1);
    this.ty = clamp(y, 0, 1);
    this.vx = 0;
    this.vy = 0;
    this.snapping = true;
    this.ripple(this.tx, this.ty, 1);
    this.emit<XYPadValue>("change", { x: this.tx, y: this.ty });
    this.kick();
  }

  private ripple(x: number, y: number, strength: number): void {
    this.ripples.push({ x, y, t0: this.t, s: strength });
    if (this.ripples.length > 6) this.ripples.shift();
  }

  /** Move the puck towards its target on a damped spring. */
  private spring(dt: number): void {
    if (reduced()) {
      this.x = this.tx;
      this.y = this.ty;
      this.snapping = false;
      return;
    }
    const stiffness = 220;
    const damping = 2 * Math.sqrt(stiffness) * 0.6;
    this.vx += (stiffness * (this.tx - this.x) - damping * this.vx) * dt;
    this.x += this.vx * dt;
    this.vy += (stiffness * (this.ty - this.y) - damping * this.vy) * dt;
    this.y += this.vy * dt;
    const distance = Math.abs(this.tx - this.x) + Math.abs(this.ty - this.y);
    const speed = Math.abs(this.vx) + Math.abs(this.vy);
    if (distance < 0.001 && speed < 0.01) {
      this.x = this.tx;
      this.y = this.ty;
      this.snapping = false;
    }
  }

  /** Glow of the field dot at `(x, y)` from the puck, the trail and the ripples, capped at 1. */
  private glow(x: number, y: number, px: number, py: number, t: number): number {
    const { w, h } = this;
    const dx = x - px;
    const dy = y - py;
    let glow = Math.exp(-(dx * dx + dy * dy) / 1800) * 0.8;
    // crosshair through the puck
    if (Math.abs(dx) < PITCH / 2 || Math.abs(dy) < PITCH / 2) glow += 0.2;
    for (const point of this.trail) {
      const fade = 1 - (t - point.t) / 0.6;
      const ex = x - point.x * w;
      const ey = y - (1 - point.y) * h;
      const d2 = ex * ex + ey * ey;
      if (d2 < 1600) glow += Math.exp(-d2 / 288) * fade * 0.35;
    }
    for (const ripple of this.ripples) {
      const age = t - ripple.t0;
      const d = Math.hypot(x - ripple.x * w, y - (1 - ripple.y) * h);
      glow += Math.exp(-((d - age * 240) ** 2) / 60) * (1 - age / 1.3) * 0.7 * ripple.s;
    }
    return Math.min(1, glow);
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const still = reduced();
    const { w, h } = this;
    if (!this.dragging && this.snapping) this.spring(dt);
    const sx = clamp(this.x, 0, 1).toFixed(2);
    const sy = clamp(this.y, 0, 1).toFixed(2);
    if (sx !== this.shownX) {
      this.shownX = sx;
      this.$(".vx").textContent = sx;
    }
    if (sy !== this.shownY) {
      this.shownY = sy;
      this.$(".vy").textContent = sy;
    }
    this.clear();
    const px = this.x * w;
    const py = (1 - this.y) * h;
    this.trail = this.trail.filter((p) => t - p.t < 0.6);
    this.ripples = this.ripples.filter((r) => t - r.t0 < 1.3);
    for (let y = PITCH / 2; y < h; y += PITCH) {
      for (let x = PITCH / 2; x < w; x += PITCH) {
        const glow = this.glow(x, y, px, py, t);
        const color =
          glow > 0.55 ? mix(P.accent, P.shine, (glow - 0.55) * 1.8) : mix(P.fg, P.accent, Math.min(1, glow * 2));
        this.dot(x - 1, y - 1, color, 0.13 + 0.87 * glow, 2);
      }
    }
    // ring of dots orbiting the puck; it holds still under reduced motion
    for (let k = 0; k < 10; k++) {
      const a = (still ? 0 : t * 1.6) + (TAU * k) / 10;
      this.dot(px + Math.cos(a) * 11 - 1, py + Math.sin(a) * 11 - 1, P.accent, 0.35 + 0.35 * Math.sin(a * 3), 2);
    }
    for (let yy = -1; yy <= 1; yy++) {
      for (let xx = -1; xx <= 1; xx++) this.dot(px + xx * 3 - 1.2, py + yy * 3 - 1.2, P.shine, 1, 2.4);
    }
    return !still || this.dragging || this.snapping || this.trail.length > 0 || this.ripples.length > 0;
  }
}

define("px-xypad", XYPad);

export { XYPad };

declare global {
  interface HTMLElementTagNameMap {
    "px-xypad": XYPad;
  }
}
