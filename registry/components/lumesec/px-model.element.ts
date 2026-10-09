/**
 * <px-model> · Model morph
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/model
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-model.tsx.
 *
 * Demo data: The three models and their speed, depth and cost scores are invented; nothing can be set. It
 * cannot show your own data yet; use it as a template and replace the invented data before it shows anything
 * real.
 */
import { PxBase, checkRadio, css, define, mix, radioKeys, rand, reduced } from "@/lib/lumesec/pixel";

/** A model offered by `<px-model>`. */
export type ModelName = "Swift" | "Balanced" | "Deep";

/** Events fired by `<px-model>`. */
export interface ModelMorphEventMap {
  /** Fires when the user picks a model. Not fired for the initial selection. */
  change: CustomEvent<{ model: ModelName }>;
}

/** A model, its scores out of 10 and how its swarm moves. */
interface ModelSpec {
  name: ModelName;
  stats: [speed: number, depth: number, cost: number];
  /** Rotation speed in radians per second. */
  spin: number;
  /** Random offset per frame in px. */
  jitter: number;
  /** Whether the shape slowly pulses in size. */
  breathe?: boolean;
}

/** Built-in demo models. */
const MODELS: readonly ModelSpec[] = [
  { name: "Swift", stats: [10, 3, 2], spin: 0, jitter: 0.6 },
  { name: "Balanced", stats: [7, 7, 5], spin: 0.45, jitter: 0 },
  { name: "Deep", stats: [4, 10, 9], spin: 0.16, jitter: 0, breathe: true },
];

/** Labels of the three score bars. */
const STAT_LABELS = ["Speed", "Depth", "Cost"] as const;

/** A pixel of a model shape: offset from the centre, angle and grid radius. */
type ShapePoint = [x: number, y: number, angle: number, r: number];

/** A pixel of the swarm, springing towards its spot in the current shape. */
interface SwarmPixel {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Time the pixel starts moving towards a new shape. */
  d: number;
  /** Spring stiffness. */
  k: number;
}

/** Whether grid cell `(gx, gy)` belongs to the shape of model `index`: a diamond, a ring, or a rayed star. */
function inShape(index: number, gx: number, gy: number, r: number, angle: number): boolean {
  const manhattan = Math.abs(gx) + Math.abs(gy);
  if (index === 0) return manhattan <= 5 && manhattan % 2 === 0;
  if (index === 1) return (r >= 6 && r <= 8.3) || r <= 1.5;
  const ray = Math.abs(((((angle / (Math.PI / 4)) % 1) + 1) % 1) - 0.5) > 0.4;
  return (
    r <= 3.3 || (r >= 6 && r <= 7.2) || (ray && r > 3.3 && r <= 11) || (r >= 9.6 && r <= 10.4 && (gx + gy) % 2 === 0)
  );
}

/** The pixels of model `index`'s shape, sorted by angle so neighbouring pixels morph to neighbouring spots. */
function modelShape(index: number): ShapePoint[] {
  const pts: ShapePoint[] = [];
  for (let gy = -11; gy <= 11; gy++) {
    for (let gx = -11; gx <= 11; gx++) {
      const r = Math.hypot(gx, gy);
      const angle = Math.atan2(gy, gx);
      if (inShape(index, gx, gy, r, angle)) pts.push([gx * 4, gy * 4, angle, r]);
    }
  }
  return pts.sort((p, q) => p[2] - q[2] || p[3] - q[3]);
}

/** Model picker where one pixel swarm morphs between a diamond, a ring and a rotating star. */
class ModelMorph extends PxBase {
  private readonly shapes: ShapePoint[][] = MODELS.map((_, i) => modelShape(i));
  /** Swarm size: the largest shape; smaller shapes share spots. */
  private readonly pool: number = Math.max(...this.shapes.map((s) => s.length));
  private readonly pixels: SwarmPixel[] = Array.from({ length: this.pool }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    d: 0,
    k: 150,
  }));
  private readonly buttons: HTMLButtonElement[] = [];
  /** Index of the selected model. */
  private index = 1;
  /** Animated bar lengths. */
  private readonly stat: [number, number, number] = [0, 0, 0];
  /** Place the swarm without flying on the next frame (the initial selection). */
  private firstSnap = false;
  /** Monospace font stack for the bar labels, read on layout. */
  private mono = "monospace";

  constructor() {
    super(
      `
      :host { display: block; }
      .seg { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--_track); width: max-content; max-width: 100%; margin: 0 auto; }
      .seg button { border: 0; background: none; padding: 5px 14px; border-radius: 7px; font-size: 13px; font-weight: 500; color: var(--_muted); cursor: pointer; transition: background-color .25s, color .25s, box-shadow .25s; }
      .seg button[aria-checked="true"] { background: var(--_surface); color: var(--_fg); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
      canvas.px { height: 212px; margin-top: 6px; }
      `,
      `<div class="seg" role="radiogroup" aria-label="Model"></div><canvas class="px" role="img"></canvas>`,
    );
    const seg = this.$(".seg");
    MODELS.forEach((model, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = model.name;
      button.setAttribute("role", "radio");
      button.addEventListener("click", () => this.select(i));
      seg.appendChild(button);
      this.buttons.push(button);
    });
    radioKeys(
      seg,
      () => this.buttons,
      () => this.index,
      (index) => this.select(index),
    );
  }

  protected override init(): void {
    this.apply(this.index, true);
  }

  protected override resized(): void {
    this.mono = this.monoFont;
  }

  /** Selects model 0 (`Swift`), 1 (`Balanced`) or 2 (`Deep`) and fires `change`. Other values are ignored. */
  select(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= MODELS.length) return;
    this.apply(index, false);
  }

  /** Select model `i`; the initial selection places the swarm at once and fires no event. */
  private apply(i: number, first: boolean): void {
    this.index = i;
    checkRadio(this.buttons, i);
    for (const pixel of this.pixels) {
      pixel.d = this.t + (first ? 0 : Math.random() * 0.22);
      pixel.k = rand(110, 200);
    }
    const { name, stats } = MODELS[i];
    this.$("canvas").setAttribute(
      "aria-label",
      `${name}: speed ${stats[0]}, depth ${stats[1]}, cost ${stats[2]} out of 10`,
    );
    if (!first) this.emit<{ model: ModelName }>("change", { model: name });
    this.firstSnap = first;
    this.kick();
  }

  /** Draw the swarm springing towards the rotated, scaled shape. */
  private drawSwarm(
    model: ModelSpec,
    shape: readonly ShapePoint[],
    cx: number,
    cy: number,
    t: number,
    dt: number,
  ): void {
    const P = this.P;
    // under reduced motion the shape holds still: no rotation, breathing or jitter
    const still = reduced();
    const angle = still ? 0 : t * model.spin;
    const scale = model.breathe && !still ? 1 + 0.04 * Math.sin(t * 2) : 1;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.pixels.forEach((p, k) => {
      const s = shape[Math.floor((k * shape.length) / this.pool)];
      let tx = cx + (s[0] * cos - s[1] * sin) * scale;
      let ty = cy + (s[0] * sin + s[1] * cos) * scale;
      if (model.jitter && !still) {
        tx += rand(-model.jitter, model.jitter);
        ty += rand(-model.jitter, model.jitter);
      }
      if (this.firstSnap || still) {
        p.x = tx;
        p.y = ty;
        p.vx = 0;
        p.vy = 0;
      } else if (t >= p.d) {
        const damping = 2 * Math.sqrt(p.k) * 0.55;
        p.vx += (p.k * (tx - p.x) - damping * p.vx) * dt;
        p.x += p.vx * dt;
        p.vy += (p.k * (ty - p.y) - damping * p.vy) * dt;
        p.y += p.vy * dt;
      }
      const speed = Math.min(1, Math.hypot(p.vx, p.vy) / 300);
      const core = 1 - Math.min(1, s[3] / 11);
      const color = mix(P.accent, P.shine, speed * 0.8 + core * 0.35);
      this.dot(p.x - 1.2, p.y - 1.2, color, 0.55 + 0.45 * Math.max(speed, core), 2.4);
    });
    this.firstSnap = false;
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    const model = MODELS[this.index];
    const cx = this.w / 2;
    this.clear();
    this.drawSwarm(model, this.shapes[this.index], cx, 80, t, dt);
    g.font = `11px ${this.mono}`;
    g.textAlign = "right";
    g.textBaseline = "middle";
    const x0 = cx - 34;
    STAT_LABELS.forEach((label, r) => {
      const y = 160 + r * 18;
      this.stat[r] += (model.stats[r] - this.stat[r]) * Math.min(1, dt * 7);
      g.globalAlpha = 0.9;
      g.fillStyle = css(P.muted);
      g.fillText(label, x0 - 10, y);
      for (let c = 0; c < 10; c++) {
        const on = c < this.stat[r] - 0.5;
        const edge = on && c >= this.stat[r] - 1.5;
        this.dot(x0 + c * 9, y - 3, on ? mix(P.accent, P.shine, edge ? 0.5 : 0) : P.fg, on ? 0.95 : 0.12, 6);
      }
    });
    g.globalAlpha = 1;
    // the swarm keeps moving unless reduced motion holds it still; then only the bars ease into place
    return !reduced() || this.stat.some((v, r) => Math.abs(model.stats[r] - v) > 0.01);
  }
}

define("px-model", ModelMorph);

export { ModelMorph };

declare global {
  interface HTMLElementTagNameMap {
    "px-model": ModelMorph;
  }
}
