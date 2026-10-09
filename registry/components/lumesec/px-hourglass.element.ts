/**
 * <px-hourglass> · Rate-limit hourglass
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/hourglass
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-hourglass.tsx.
 */
import { PxBase, Sparks, clamp, define, hash, mix, now, reduced, rollText, type Point } from "@/lib/lumesec/pixel";

/** Events fired by `<px-hourglass>`. */
export interface HourglassEventMap {
  /** Fires after the hourglass has turned over. */
  flip: CustomEvent<Record<string, never>>;
  /** Fires once when the top chamber runs empty, meaning the limit has reset. */
  reset: CustomEvent<Record<string, never>>;
}

/** Sand grid size in cells. */
const COLS = 40;
const ROWS = 56;
/** Last row of the top chamber; grains below it have passed the neck. */
const NECK = ROWS / 2 - 1;
/** Simulation steps per second. */
const STEPS_PER_SECOND = 120;
/** Size of a grid cell on the canvas in px. */
const CELL = 3;

/** Falling-sand hourglass that counts down to a usage reset. */
class Hourglass extends PxBase {
  static readonly observedAttributes = ["duration"] as const;

  /** 1 for cells inside the glass. */
  private readonly mask = new Uint8Array(COLS * ROWS);
  /** Sand per cell: 0 is empty, 1–255 a grain with its own shade. */
  private grid = new Uint8Array(COLS * ROWS);
  /** 1 for cells whose grain moved in the last step; they draw brighter. */
  private readonly moved = new Uint8Array(COLS * ROWS);
  /** Outline cells of the glass. */
  private edge: Point[] = [];
  /** Simulation steps between two grains passing the neck, so a full chamber lasts `duration` seconds. */
  private interval = 0;
  /** Steps until the neck lets the next grain through. */
  private gate = 0;
  /** Fractional simulation steps owed to the clock. */
  private pending = 0;
  /** Clock time (`now()`) of the last frame; 0 while the loop is idle. The sand catches up from it after a pause. */
  private clockAt = 0;
  /** Whether a grain moved in the last simulation step. */
  private sandMoving = false;
  private flipping = false;
  private doneShown = false;
  private lastTime = "";
  private readonly sparks = new Sparks();

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: flex; align-items: center; justify-content: center; gap: 28px; flex-wrap: wrap; }
      .glass { width: 120px; cursor: pointer; border-radius: 12px; }
      canvas.px { width: 120px; height: 168px; }
      .info { display: grid; gap: 8px; justify-items: start; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      .time { font-size: 32px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
      :host([data-done]) .time { color: var(--_ok); }
      `,
      `<div class="wrap"><div class="glass" tabindex="0" role="button" aria-label="Flip the hourglass"><canvas class="px"></canvas></div>
        <div class="info"><span class="rollslot lab" aria-live="polite"></span><span class="rollslot time"></span><button class="pbtn flip" type="button">Flip</button></div></div>`,
    );
    const flip = (): void => this.flip();
    const glass = this.$(".glass");
    this.$(".flip").addEventListener("click", flip);
    glass.addEventListener("click", flip);
    glass.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flip();
      }
    });
  }

  /** Countdown length in seconds: the `duration` attribute, `30` when missing, invalid or not positive. */
  get duration(): number {
    const seconds = this.num("duration", 30);
    return seconds > 0 ? seconds : 30;
  }

  set duration(seconds: number) {
    this.setAttribute("duration", String(seconds));
  }

  attributeChangedCallback(): void {
    // before the first connect, init() sizes the countdown
    if (!this.initialized) return;
    // the sand left in the top chamber now runs out in `duration` seconds
    const top = this.topGrains();
    if (top > 0) this.interval = (this.duration * STEPS_PER_SECOND) / top;
    this.kick();
  }

  /** Number of grains in the top chamber. */
  private topGrains(): number {
    let top = 0;
    const end = (NECK + 1) * COLS;
    for (let i = 0; i < end; i++) if (this.grid[i]) top++;
    return top;
  }

  protected override init(): void {
    const mask = this.mask;
    // two cones meeting at a two-cell neck
    for (let r = 1; r < ROWS - 1; r++) {
      const width = 2 + ((COLS - 6) * Math.abs(r + 0.5 - ROWS / 2)) / (ROWS / 2);
      for (let c = 0; c < COLS; c++) {
        if (Math.abs(c + 0.5 - COLS / 2) <= width / 2) mask[r * COLS + c] = 1;
      }
    }
    const outside = (r: number, c: number): boolean => r < 0 || r >= ROWS || c < 0 || c >= COLS || !mask[r * COLS + c];
    this.edge = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!mask[r * COLS + c]) continue;
        if (outside(r - 1, c) || outside(r + 1, c) || outside(r, c - 1) || outside(r, c + 1)) this.edge.push([c, r]);
      }
    }
    let grains = 0;
    for (let r = 5; r <= NECK; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        if (mask[i]) {
          this.grid[i] = 1 + ((hash(i) * 254) | 0);
          grains++;
        }
      }
    }
    this.interval = (this.duration * STEPS_PER_SECOND) / grains;
    this.gate = 0;
    rollText(this.$(".lab"), "Usage resets in", 1, false);
  }

  /**
   * One falling-sand step, bottom row first; rows alternate direction at random so piles stay symmetric.
   * Returns whether a grain moved.
   */
  private simulate(): boolean {
    let anyMoved = false;
    const grid = this.grid;
    const mask = this.mask;
    const moved = this.moved;
    moved.fill(0);
    if (this.gate > 0) this.gate--;
    for (let r = ROWS - 2; r >= 0; r--) {
      const leftToRight = Math.random() < 0.5;
      for (let k = 0; k < COLS; k++) {
        const c = leftToRight ? k : COLS - 1 - k;
        const i = r * COLS + c;
        if (!grid[i]) continue;
        const crossing = r === NECK;
        if (crossing && this.gate > 0) continue;
        const below = i + COLS;
        let to = -1;
        if (mask[below] && !grid[below]) {
          to = below;
        } else {
          const d = Math.random() < 0.5 ? -1 : 1;
          for (const dd of [d, -d]) {
            const cc = c + dd;
            if (cc < 0 || cc >= COLS) continue;
            const j = below + dd;
            if (mask[j] && !grid[j]) {
              to = j;
              break;
            }
          }
        }
        if (to >= 0) {
          grid[to] = grid[i];
          grid[i] = 0;
          moved[to] = 1;
          anyMoved = true;
          if (crossing) this.gate = this.interval;
        }
      }
    }
    return anyMoved;
  }

  /** Turns the hourglass over so the sand runs back. Ignored while a flip is animating. */
  flip(): void {
    if (this.flipping) return;
    this.flipping = true;
    const glass = this.$(".glass");
    const done = (): void => {
      // rotate the grid by 180°
      const turned = new Uint8Array(COLS * ROWS);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) turned[(ROWS - 1 - r) * COLS + (COLS - 1 - c)] = this.grid[r * COLS + c];
      }
      this.grid = turned;
      this.flipping = false;
      this.gate = 0;
      this.doneShown = false;
      delete this.dataset.done;
      rollText(this.$(".lab"), "Usage resets in", -1);
      this.emit("flip");
      this.kick();
    };
    if (reduced() || typeof glass.animate !== "function") {
      done();
      return;
    }
    glass.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(196deg)", offset: 0.7 }, { transform: "rotate(180deg)" }],
      { duration: 650, easing: "cubic-bezier(.5,0,.3,1)" },
    ).onfinish = done;
  }

  protected override render(_t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const clock = now();
    if (!this.flipping) {
      // the loop pauses off screen and in hidden tabs; the sand then catches up from the clock, at most by
      // one full chamber
      const elapsed = this.clockAt ? clock - this.clockAt : dt;
      this.pending = Math.min(this.pending + elapsed * STEPS_PER_SECOND, (this.duration + 2) * STEPS_PER_SECOND);
      // 8 steps per frame normally, so a slow frame does not stall; more while catching up, within about 30 frames
      const cap = clamp(Math.ceil(this.pending / 30), 8, 600);
      let steps = 0;
      while (this.pending >= 1 && steps < cap) {
        this.pending -= 1;
        this.sandMoving = this.simulate();
        steps++;
      }
    }
    this.clockAt = clock;
    const P = this.P;
    const grid = this.grid;
    const moved = this.moved;
    this.clear();
    for (const [c, r] of this.edge) this.dot(c * CELL, r * CELL, P.fg, 0.13, 2.4);
    for (let c = 4; c < COLS - 4; c++) {
      this.dot(c * CELL, 0, P.fg, 0.35, 2.4);
      this.dot(c * CELL, (ROWS - 1) * CELL, P.fg, 0.35, 2.4);
    }
    let top = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const grain = grid[i];
        if (!grain) continue;
        if (r <= NECK) top++;
        const shade = (grain / 255) * 0.35 + (moved[i] ? 0.45 : 0);
        this.dot(c * CELL, r * CELL, mix(P.accent, P.shine, shade), moved[i] ? 1 : 0.85, 2.4);
      }
    }
    // the remaining time is derived from the sand left in the top chamber
    const secs = Math.ceil((top * this.interval) / STEPS_PER_SECOND);
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    if (time !== this.lastTime) {
      rollText(this.$(".time"), time, -1, !!this.lastTime);
      this.lastTime = time;
    }
    if (top === 0 && !this.doneShown && !this.flipping) {
      this.doneShown = true;
      this.dataset.done = "";
      rollText(this.$(".lab"), "Limit reset · flip to start", 1);
      this.sparks.add(60, 140, 30, [P.ok, P.shine, P.accent], {
        speed: [40, 150],
        angle: -Math.PI / 2,
        spread: Math.PI * 1.2,
      });
      this.emit("reset");
    }
    const sparking = this.sparks.step(g, dt);
    // an empty top chamber with the sand at rest is a still picture until the next flip
    const busy = top > 0 || this.sandMoving || sparking || this.flipping;
    if (!busy) this.clockAt = 0;
    return busy;
  }
}

define("px-hourglass", Hourglass);

export { Hourglass };

declare global {
  interface HTMLElementTagNameMap {
    "px-hourglass": Hourglass;
  }
}
