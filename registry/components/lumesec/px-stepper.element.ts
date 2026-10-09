/**
 * <px-stepper> · Snake stepper
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/stepper
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-stepper.tsx.
 *
 * Demo data: The five onboarding steps and their subtitles are fixed demo content; nothing can be set. It
 * cannot show your own data yet; use it as a template and replace the invented data before it shows anything
 * real.
 */
import { PxBase, Sparks, css, define, mix, reduced, rollText, type Point } from "@/lib/lumesec/pixel";

/** Events fired by `<px-stepper>`. */
export interface StepperEventMap {
  /** Fires when the snake arrives at a step. `step` is 1-based. */
  change: CustomEvent<{ step: number }>;
  /** Fires when Finish is pressed on the last step. */
  complete: CustomEvent<Record<string, never>>;
}

/** An onboarding step: title and subtitle. */
type Step = readonly [title: string, subtitle: string];

const STEPS: readonly Step[] = [
  ["Account", "Create your login"],
  ["Workspace", "Name your workspace"],
  ["Connect", "Link your tools"],
  ["Invite", "Bring your team"],
  ["Launch", "You’re all set"],
];

const LAST = STEPS.length - 1;
/** Grid cell size in px. */
const CELL = 6;
/** Starting snake length in cells; it grows by one per step eaten. */
const MIN_LENGTH = 6;
/** Cells of snake history kept. */
const HISTORY = 40;

/**
 * Five-step onboarding progress drawn as a pixel snake that circles the current step, slithers to the next, eats it and
 * grows.
 */
class Stepper extends PxBase {
  /** Current step index. */
  private current = 0;
  private snakeLength = MIN_LENGTH;
  /** Cells the head has visited, oldest first; the snake is the tail of this list. */
  private history: Point[] = [];
  /** Cells left to travel to the next step. */
  private queue: Point[] = [];
  private readonly sparks = new Sparks();
  /** Moves owed to the snake clock. */
  private acc = 0;
  /** Position on the ring around the current step. */
  private ringIndex = 0;
  private readonly done: boolean[] = new Array<boolean>(STEPS.length).fill(false);
  /** Flash per step node, 1 when eaten, fading to 0. */
  private flash: number[] = new Array<number>(STEPS.length).fill(0);
  private cols = 0;
  private rows = 0;
  /** Grid row of the step nodes. */
  private midRow = 0;
  /** Grid column of each step node; null until the first layout. */
  private nodeX: number[] | null = null;
  /** Step the snake is travelling to, and in which direction. */
  private target = 0;
  private direction: 1 | -1 = 1;
  /** Canvas font of the step names, sized on layout. */
  private labelFontValue = "10px monospace";
  private readonly canvas = this.$("canvas");
  private readonly backButton = this.$<HTMLButtonElement>(".back");

  constructor() {
    super(
      `
      :host { display: block; }
      .pbtn[aria-disabled="true"] { opacity: .45; pointer-events: none; }
      canvas.px { height: 104px; }
      .info { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
      .txt { display: grid; gap: 1px; }
      .ttl { font-size: 14px; font-weight: 600; }
      .sub { font-size: 12.5px; color: var(--_muted); }
      .btns { display: flex; gap: 6px; }
      `,
      `<canvas class="px" role="img"></canvas><div class="info"><span class="txt"><span class="rollslot ttl" aria-live="polite"></span><span class="rollslot sub"></span></span><div class="btns"><button class="pbtn back" type="button">Back</button><button class="pbtn next" type="button">Next</button></div></div>`,
    );
    this.$(".next").addEventListener("click", () => this.go(1));
    this.backButton.addEventListener("click", () => this.go(-1));
  }

  protected override init(): void {
    this.label(false, 1);
  }

  private label(animate: boolean, dir: number): void {
    const [title, subtitle] = STEPS[this.current];
    const count = STEPS.length;
    rollText(this.$(".ttl"), `Step ${this.current + 1} of ${count} · ${title}`, dir, animate);
    rollText(this.$(".sub"), subtitle, dir, animate);
    this.setBackDisabled(this.current === 0 || this.queue.length > 0);
    this.$(".next").textContent = this.current === LAST ? "Finish" : "Next";
    this.canvas.setAttribute("aria-label", `Onboarding progress, step ${this.current + 1} of ${count}, ${title}`);
  }

  /** aria-disabled rather than disabled, so a keyboard user keeps focus on Back; go() ignores it meanwhile. */
  private setBackDisabled(disabled: boolean): void {
    if (disabled) this.backButton.setAttribute("aria-disabled", "true");
    else this.backButton.removeAttribute("aria-disabled");
  }

  protected override resized(): void {
    this.cols = Math.floor(this.w / CELL);
    this.rows = Math.floor(this.h / CELL);
    this.midRow = Math.floor(this.rows / 2) - 1;
    const nodeX = STEPS.map((_, i) => Math.round(3 + (i * (this.cols - 7)) / 4));
    this.nodeX = nodeX;
    if (!this.history.length) {
      this.history = Array.from({ length: this.snakeLength }, (): Point => [nodeX[0] - 2, this.midRow - 2]);
    }
    if (this.ctx) this.labelFontValue = this.labelFont(this.ctx, nodeX);
  }

  /** The 16 cells around step `i`, clockwise from the top-left corner. */
  private ring(nodeX: readonly number[], i: number): Point[] {
    const x = nodeX[i];
    const y = this.midRow;
    return [
      [x - 2, y - 2],
      [x - 1, y - 2],
      [x, y - 2],
      [x + 1, y - 2],
      [x + 2, y - 2],
      [x + 2, y - 1],
      [x + 2, y],
      [x + 2, y + 1],
      [x + 2, y + 2],
      [x + 1, y + 2],
      [x, y + 2],
      [x - 1, y + 2],
      [x - 2, y + 2],
      [x - 2, y + 1],
      [x - 2, y],
      [x - 2, y - 1],
    ];
  }

  /** The cells from step `a` to step `b`: a sine-shaped hop, above or below the line in turn. */
  private path(nodeX: readonly number[], a: number, b: number): Point[] {
    const points: Point[] = [];
    const dir = b > a ? 1 : -1;
    const x0 = nodeX[a] + 2 * dir;
    const x1 = nodeX[b] - 2 * dir;
    const up = a % 2 ? 1 : -1;
    let y = this.midRow - 2;
    points.push([x0, y]);
    const n = Math.abs(x1 - x0);
    for (let k = 1; k <= n; k++) {
      const x = x0 + k * dir;
      const ty = this.midRow - 2 + Math.round(3 * Math.sin((Math.PI * k) / n)) * up;
      // climb or descend one cell at a time, so the snake stays connected
      while (y !== ty) {
        y += Math.sign(ty - y);
        points.push([x - dir, y]);
      }
      points.push([x, y]);
    }
    return points;
  }

  /**
   * Moves to the next or previous step; on the last step, `go(1)` completes onboarding. Ignored while the snake
   * is moving and for other values.
   */
  go(direction: 1 | -1): void {
    const nodeX = this.nodeX;
    if ((direction !== 1 && direction !== -1) || this.queue.length || !nodeX) return;
    if (direction > 0 && this.current === LAST) {
      const P = this.P;
      this.done[LAST] = true;
      this.flash = this.flash.map(() => 1);
      for (const x of nodeX) {
        this.sparks.add(x * CELL + 3, this.midRow * CELL + 3, 14, [P.ok, P.shine, P.accent], { speed: [40, 160] });
      }
      rollText(this.$(".ttl"), "Onboarding complete", 1);
      rollText(this.$(".sub"), "Your workspace is ready", 1);
      this.emit("complete");
      this.kick();
      return;
    }
    const to = this.current + direction;
    if (to < 0 || to > LAST) return;
    if (direction < 0) {
      this.done[this.current] = false;
      this.done[to] = false;
      this.snakeLength = Math.max(MIN_LENGTH, this.snakeLength - 1);
    }
    this.queue = this.path(nodeX, this.current, to);
    this.target = to;
    this.direction = direction;
    this.setBackDisabled(true);
    this.kick();
  }

  /** The snake reached the target step: eat it (going forward), relabel and fire `change`. */
  private arrive(nodeX: readonly number[]): void {
    const P = this.P;
    const i = this.target;
    if (this.direction > 0) {
      this.done[this.current] = true;
      this.snakeLength++;
      this.flash[i] = 1;
      this.sparks.add(nodeX[i] * CELL + 3, this.midRow * CELL + 3, 18, [P.accent, P.shine], { speed: [40, 150] });
    }
    this.current = i;
    this.ringIndex = 0;
    this.label(true, this.direction);
    this.emit<{ step: number }>("change", { step: this.current + 1 });
  }

  /** Label font: 10px, smaller on narrow layouts so neighbouring step names do not overlap. */
  private labelFont(ctx: CanvasRenderingContext2D, nodeX: readonly number[]): string {
    const family = this.monoFont;
    ctx.font = `10px ${family}`;
    const spacing = (nodeX[1] - nodeX[0]) * CELL;
    let needed = 0;
    for (let i = 1; i < STEPS.length; i++) {
      const pair = (ctx.measureText(STEPS[i - 1][0]).width + ctx.measureText(STEPS[i][0]).width) / 2;
      needed = Math.max(needed, pair + 6);
    }
    const size = needed > spacing ? Math.max(7, (10 * spacing) / needed) : 10;
    return `${size.toFixed(2)}px ${family}`;
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    const nodeX = this.nodeX;
    if (!nodeX || !ctx) return false;
    const P = this.P;
    const cs = CELL;
    const still = reduced();
    // the snake moves faster while travelling than while circling; under reduced motion it rests
    this.acc = still ? 0 : this.acc + dt * (this.queue.length ? 22 : 7);
    let moves = 0;
    while (this.acc >= 1 && moves < 4) {
      this.acc--;
      moves++;
      let next = this.queue.shift();
      if (next) {
        if (!this.queue.length) this.arrive(nodeX);
      } else {
        const ring = this.ring(nodeX, this.current);
        this.ringIndex = (this.ringIndex + 1) % ring.length;
        next = ring[this.ringIndex];
      }
      this.history.push(next);
      if (this.history.length > HISTORY) this.history.shift();
    }
    if (still && this.queue.length) {
      this.history.push(...this.queue);
      this.queue = [];
      this.arrive(nodeX);
    }

    this.clear();
    ctx.font = this.labelFontValue;
    ctx.textAlign = "center";
    for (let x = 2; x < this.cols - 2; x++) this.dot(x * cs + 2, this.midRow * cs + 2, P.fg, 0.1, 2);
    nodeX.forEach((x, i) => {
      this.flash[i] = Math.max(0, this.flash[i] - dt * 1.5);
      const complete = this.done[i] || i < this.current;
      const f = this.flash[i];
      const color = complete ? mix(P.ok, P.shine, f) : i === this.current ? P.accent : P.fg;
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          // open steps show only their centre cell, the current one pulsing
          const on = complete || (xx === 0 && yy === 0);
          const pulse = still ? 0.75 : 0.5 + 0.5 * Math.sin(t * 4 + i);
          const alpha = on ? (complete ? 0.95 : pulse) : 0.15;
          this.dot((x + xx) * cs + 0.5, (this.midRow + yy) * cs + 0.5, color, alpha, cs - 1);
        }
      }
      ctx.fillStyle = css(i === this.current ? P.fg : P.muted);
      ctx.globalAlpha = 0.9;
      ctx.fillText(STEPS[i][0], x * cs + 3, (this.midRow + 4) * cs + 8);
      ctx.globalAlpha = 1;
    });
    const body = this.history.slice(-this.snakeLength);
    body.forEach(([x, y], k) => {
      const head = k === body.length - 1;
      const u = k / body.length;
      this.dot(x * cs + 0.5, y * cs + 0.5, head ? mix(P.accent, P.shine, 0.5) : P.accent, 0.35 + 0.65 * u, cs - 1);
    });
    const sparking = this.sparks.step(ctx, dt);
    // under reduced motion the snake rests: draw only until the flashes have faded
    return !still || sparking || this.flash.some((f) => f > 0);
  }
}

define("px-stepper", Stepper);

export { Stepper };

declare global {
  interface HTMLElementTagNameMap {
    "px-stepper": Stepper;
  }
}
