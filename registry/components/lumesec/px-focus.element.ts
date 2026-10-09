/**
 * <px-focus> · Focus timer
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/focus
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-focus.tsx.
 */
import { PxBase, Sparks, TAU, clamp, define, mix, now, rand, reduced } from "@/lib/lumesec/pixel";

/** Events fired by `<px-focus>`. */
export interface FocusEventMap {
  /** Fires when the timer starts or resumes. */
  start: CustomEvent<Record<string, never>>;
  /** Fires when the timer is paused. */
  pause: CustomEvent<Record<string, never>>;
  /** Fires when the timer is reset. */
  reset: CustomEvent<Record<string, never>>;
  /** Fires when the last pixel falls and the session is complete. */
  done: CustomEvent<Record<string, never>>;
}

/** Pixels on the ring; the session is split evenly across them. */
const RING = 60;
/** Ring centre height and radius in px. */
const RING_Y = 100;
const RING_R = 78;
/** Width of a sand-pile column in px. */
const COLUMN = 3;
/** Downward acceleration of falling pixels in px/s². */
const GRAVITY = 700;

/** A pixel falling from the ring. */
interface FallingPixel {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A pixel resting in the sand pile. */
interface PilePixel {
  x: number;
  y: number;
}

/** A pixel flying back to its ring slot after a reset. */
interface ReturningPixel {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ring slot position. */
  tx: number;
  ty: number;
  /** Time the pixel starts flying. */
  d: number;
  /** Ring slot index. */
  i: number;
}

/** Centre of ring slot `i` (slot 0 at the top, clockwise). */
const slot = (cx: number, i: number): [x: number, y: number, angle: number] => {
  const angle = -Math.PI / 2 + TAU * (i / RING);
  return [cx + Math.cos(angle) * RING_R, RING_Y + Math.sin(angle) * RING_R, angle];
};

/** Focus timer drawn as a ring of 60 pixels that break loose one by one into a sand pile. */
class Focus extends PxBase {
  static readonly observedAttributes = ["duration"] as const;

  /** Seconds of focus banked by earlier runs, before the last pause. */
  private banked = 0;
  /** Clock time (`now()`) the current run started. */
  private runStart = 0;
  private running = false;
  /** Whether the session is complete; the next toggle resets. */
  private finished = false;
  /** Fires `done` on time even while the tab is hidden or the element is off screen and not drawing. */
  private doneTimer: ReturnType<typeof setTimeout> | undefined;
  /** Number of ring pixels that have fallen. */
  private fallen = 0;
  private falling: FallingPixel[] = [];
  private pile: PilePixel[] = [];
  private returning: ReturningPixel[] = [];
  /** Height of the sand pile per column, in pixels; null until the first frame sizes it. */
  private columns: number[] | null = null;
  /** Time and status last written to the readout. */
  private lastText = "";
  private lastStatus = "";
  private readonly sparks = new Sparks();

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: grid; justify-items: center; gap: 10px; }
      .face { position: relative; }
      canvas.px { width: 224px; height: 232px; }
      .read { position: absolute; left: 0; right: 0; top: 74px; display: grid; justify-items: center; gap: 6px; pointer-events: none; }
      .num { font-family: var(--_mono); font-size: 40px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .num.done { font-family: var(--_font); color: var(--_ok); }
      .status { font-size: 12px; line-height: 1; color: var(--_muted); }
      .bar { display: flex; gap: 8px; }
      `,
      `<div class="wrap"><div class="face"><canvas class="px" aria-hidden="true"></canvas><div class="read" role="timer" aria-live="off"><span class="num"></span><span class="status"></span></div></div><div class="bar"><button class="pbtn go" type="button">Start</button><button class="pbtn reset" type="button">Reset</button></div></div>`,
    );
    this.$(".go").addEventListener("click", () => this.toggle());
    this.$(".reset").addEventListener("click", () => this.reset());
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.schedule();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.doneTimer);
  }

  attributeChangedCallback(): void {
    // a new duration moves the end of a running session
    this.schedule();
    this.kick();
  }

  /** Session length in seconds: the `duration` attribute, `60` when missing, invalid or not positive. */
  get duration(): number {
    const seconds = this.num("duration", 60);
    return seconds > 0 ? seconds : 60;
  }

  set duration(seconds: number) {
    this.setAttribute("duration", String(seconds));
  }

  /** Seconds of focus so far. Read from the clock, so the timer keeps time in a hidden tab or off screen. */
  private get elapsed(): number {
    return this.running ? this.banked + now() - this.runStart : this.banked;
  }

  /** Starts, pauses or resumes the timer; after completion it resets instead. */
  toggle(): void {
    if (this.finished) {
      this.reset();
      return;
    }
    if (this.running) {
      this.banked = this.elapsed;
      this.running = false;
    } else {
      this.runStart = now();
      this.running = true;
    }
    this.schedule();
    this.$(".go").textContent = this.running ? "Pause" : "Resume";
    this.emit(this.running ? "start" : "pause");
    this.kick();
  }

  /** Stops the timer and flies the fallen pixels back into the ring. */
  reset(): void {
    this.running = false;
    this.finished = false;
    this.banked = 0;
    clearTimeout(this.doneTimer);
    this.fallen = 0;
    this.$(".go").textContent = "Start";
    const cx = this.w / 2;
    this.returning = [];
    for (const p of this.falling) this.pile.push({ x: p.x, y: p.y });
    this.falling = [];
    // the top of the pile fell last, so it returns to the last slot
    this.pile.forEach((p, k) => {
      const i = this.pile.length - 1 - k;
      const [tx, ty] = slot(cx, i);
      this.returning.push({ x: p.x, y: p.y, vx: 0, vy: 0, tx, ty, d: this.t + k * 0.012, i });
    });
    this.pile = [];
    this.columns = null;
    this.emit("reset");
    this.kick();
  }

  /** Arm the timer that completes a running session; clear it otherwise. */
  private schedule(): void {
    clearTimeout(this.doneTimer);
    if (!this.running || !this.isConnected) return;
    const left = this.duration - this.elapsed;
    this.doneTimer = setTimeout(() => {
      if (this.elapsed >= this.duration) this.finish();
      else this.schedule();
    }, Math.max(0, left * 1000));
  }

  /** Complete the session and fire `done`; the next frame drops the remaining pixels. */
  private finish(): void {
    if (this.finished) return;
    this.banked = this.duration;
    this.running = false;
    this.finished = true;
    clearTimeout(this.doneTimer);
    this.$(".go").textContent = "Again";
    this.emit("done");
    this.kick();
  }

  /** Drop the ring pixels whose interval has passed; sparks fly when the last one goes. */
  private dropDue(cx: number, interval: number, elapsed: number): void {
    const due = this.finished ? RING : Math.min(RING, Math.floor(elapsed / interval));
    if (this.fallen >= due) return;
    while (this.fallen < due) {
      const [x, y, angle] = slot(cx, this.fallen);
      this.falling.push({ x, y, vx: Math.cos(angle) * 30 + rand(-20, 20), vy: -60 + rand(-20, 10) });
      this.fallen++;
    }
    if (this.fallen >= RING) {
      const P = this.P;
      this.sparks.add(cx, RING_Y, 30, [P.ok, P.shine], { speed: [40, 160] });
    }
  }

  /** Move falling pixels; on landing a pixel slides down the pile until it rests. */
  private fall(columns: number[], dt: number, w: number, floor: number): void {
    this.falling = this.falling.filter((p) => {
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.x = clamp(p.x, 2, w - 4);
      let c = clamp(Math.round(p.x / COLUMN), 0, columns.length - 1);
      const land = floor - (columns[c] + 1) * COLUMN;
      if (p.y < land) return true;
      for (let k = 0; k < 12; k++) {
        const left = c > 0 ? columns[c - 1] : 99;
        const right = c < columns.length - 1 ? columns[c + 1] : 99;
        if (left < columns[c] - 1 && left <= right) c--;
        else if (right < columns[c] - 1) c++;
        else break;
      }
      columns[c]++;
      this.pile.push({ x: c * COLUMN, y: floor - columns[c] * COLUMN });
      return false;
    });
  }

  /** Spring returning pixels to their ring slots; clears the list once all have arrived. */
  private flyBack(t: number, dt: number): void {
    let busy = false;
    for (const p of this.returning) {
      if (t < p.d) {
        busy = true;
        continue;
      }
      const stiffness = 160;
      const damping = 2 * Math.sqrt(stiffness) * 0.7;
      p.vx += (stiffness * (p.tx - p.x) - damping * p.vx) * dt;
      p.x += p.vx * dt;
      p.vy += (stiffness * (p.ty - p.y) - damping * p.vy) * dt;
      p.y += p.vy * dt;
      if (Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.5) busy = true;
    }
    if (!busy && this.returning.length) this.returning = [];
  }

  /** Draw the ring: fallen slots dim, the next pixel to fall brightening and trembling. */
  private drawRing(cx: number, interval: number, elapsed: number): void {
    const P = this.P;
    const flying = new Set(this.returning.map((p) => p.i));
    for (let i = 0; i < RING; i++) {
      let [x, y] = slot(cx, i);
      if (i < this.fallen || flying.has(i)) {
        this.dot(x - 1.5, y - 1.5, P.fg, 0.1, 3);
        continue;
      }
      let alpha = 0.85;
      let color = P.accent;
      if (i === this.fallen && this.running) {
        const into = (elapsed % interval) / interval;
        if (into > 0.6 && !reduced()) {
          x += rand(-1, 1) * into;
          y += rand(-1, 1) * into;
        }
        color = mix(P.accent, P.shine, into);
        alpha = 1;
      }
      this.dot(x - 1.5, y - 1.5, color, alpha, 3);
    }
  }

  /** Write the remaining time and the status line when they change. */
  private updateReadout(done: boolean, elapsed: number): void {
    const remaining = Math.max(0, Math.ceil(this.duration - elapsed));
    const text = done ? "Done" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
    if (text !== this.lastText) {
      this.lastText = text;
      const numeral = this.$(".num");
      numeral.textContent = text;
      numeral.classList.toggle("done", done);
    }
    const status = done ? "Session complete" : this.running ? "Focus" : elapsed > 0 ? "Paused" : "Ready";
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.$(".status").textContent = status;
    }
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    const { w, h } = this;
    const cx = w / 2;
    const interval = this.duration / RING;
    const floor = h - 4;
    this.columns ??= new Array<number>(Math.ceil(w / COLUMN)).fill(0);
    if (this.running && this.elapsed >= this.duration) this.finish();
    const elapsed = this.elapsed;
    this.dropDue(cx, interval, elapsed);
    this.fall(this.columns, dt, w, floor);
    this.flyBack(t, dt);

    this.clear();
    this.drawRing(cx, interval, elapsed);
    for (const p of this.returning) this.dot(p.x - 1.5, p.y - 1.5, mix(P.accent, P.shine, 0.4), 1, 3);
    const done = this.finished;
    for (const p of this.pile) this.dot(p.x, p.y, done ? P.ok : mix(P.accent, P.fg, 0.3), done ? 0.9 : 0.75, 2.6);
    for (const p of this.falling) this.dot(p.x - 1.5, p.y - 1.5, P.shine, 1, 3);

    this.updateReadout(done, elapsed);
    const sparking = this.sparks.step(g, dt);
    return this.running || this.falling.length > 0 || this.returning.length > 0 || sparking;
  }
}

define("px-focus", Focus);

export { Focus };

declare global {
  interface HTMLElementTagNameMap {
    "px-focus": Focus;
  }
}
