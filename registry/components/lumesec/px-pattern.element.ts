/**
 * <px-pattern> · Pattern lock
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/pattern
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-pattern.tsx.
 */
import { PxBase, Sparks, TAU, define, mix, rand, reduced, rollText, type Point } from "@/lib/lumesec/pixel";

/** Phase of the lock; the host carries `data-state="ok"` or `data-state="wrong"` after a check. */
export type PatternState = "idle" | "drawing" | "ok" | "wrong";

/** Events fired by `<px-pattern>`. */
export interface PatternEventMap {
  /** Fires when the drawn pattern matches `pattern`. */
  unlock: CustomEvent<Record<string, never>>;
  /** Fires when a pattern of two or more nodes does not match. */
  fail: CustomEvent<Record<string, never>>;
}

/** Distance in px within which the pointer picks up a node. */
const HIT_RADIUS = 22;
/** Trail dots keep this far from the nodes they connect. */
const NODE_GAP = 14;
const IDLE_TEXT = "Draw to unlock";
/** The L shape used when `pattern` is missing or invalid. */
const DEFAULT_PATTERN: readonly number[] = [0, 3, 6, 7, 8];

/** Node indexes of a `pattern` value: whole numbers 0 to 8, each at most once; null unless at least two. */
function parsePattern(value: string | null): number[] | null {
  if (!value) return null;
  const nodes = value.split(",").map((part) => Number(part.trim()));
  const valid = nodes.every((n) => Number.isInteger(n) && n >= 0 && n <= 8) && new Set(nodes).size === nodes.length;
  return valid && nodes.length >= 2 ? nodes : null;
}

/** A pixel of a shattered trail, falling. */
interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Lifetime in seconds. */
  max: number;
}

/** 3×3 pattern lock with a pixel trail. */
class Pattern extends PxBase {
  static readonly observedAttributes = ["pattern"] as const;

  private phase: PatternState = "idle";
  /** Selected node indices in order. */
  private selected: number[] = [];
  /** Pointer position while drawing; the trail follows it. */
  private pointer: Point | null = null;
  /** True while Show me draws the pattern. */
  private auto = false;
  /** Set after a wrong pattern: the trail is hidden while its debris falls. */
  private broken = false;
  private debris: Debris[] = [];
  /** Highlight flash per node, decaying from 1. */
  private readonly flash: number[] = new Array<number>(9).fill(0);
  private readonly sparks = new Sparks();
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  /** Next step of Show me. */
  private demoTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: grid; justify-items: center; gap: 10px; }
      canvas.px { width: 216px; height: 216px; touch-action: none; cursor: pointer; border-radius: 16px; }
      :host([data-state="wrong"]) canvas.px { animation: shake .42s ease-out; }
      @keyframes shake { 20% { transform: translateX(-7px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(2px); } }
      .lab { font-size: 14px; font-weight: 500; }
      .lab .rollslot { justify-items: center; }
      :host([data-state="ok"]) .lab { color: var(--_ok); }
      :host([data-state="wrong"]) .lab { color: var(--_danger); }
      .row { display: flex; gap: 10px; align-items: center; }
      .hint { font-size: 12px; color: var(--_muted); }
      @media (prefers-reduced-motion: reduce) { :host([data-state="wrong"]) canvas.px { animation: none; } }
      `,
      `<div class="wrap"><canvas class="px" role="img" aria-label="Pattern lock. Use Show me to watch the right pattern."></canvas>
        <span class="lab"><span class="rollslot l" aria-live="polite"></span></span>
        <div class="row"><span class="hint">Hint: draw an L</span><button class="pbtn demo" type="button">Show me</button></div></div>`,
    );
    const canvas = this.$("canvas");
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.phase === "ok" || this.auto) return;
      canvas.setPointerCapture(e.pointerId);
      clearTimeout(this.resetTimer);
      this.phase = "drawing";
      delete this.dataset.state;
      this.selected = [];
      this.broken = false;
      this.debris = [];
      this.track(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.phase === "drawing" && !this.auto) this.track(e);
    });
    const up = (): void => {
      if (this.phase === "drawing" && !this.auto) this.finish();
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    this.$(".demo").addEventListener("click", () => this.demo());
  }

  /** The `pattern` attribute parsed into node indexes; the default L when it is missing or invalid. */
  get secret(): number[] {
    return parsePattern(this.getAttribute("pattern")) ?? [...DEFAULT_PATTERN];
  }

  protected override init(): void {
    rollText(this.$(".l"), IDLE_TEXT, 1, false);
    this.syncHint();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // a removed lock starts over at the prompt
    this.stopTimers();
    if (this.phase !== "idle") this.clearPattern(false);
  }

  attributeChangedCallback(): void {
    this.syncHint();
  }

  /** The hint describes the default L only. */
  private syncHint(): void {
    this.$(".hint").hidden = parsePattern(this.getAttribute("pattern")) !== null;
  }

  /** Cancel Show me and the pending return to the prompt. */
  private stopTimers(): void {
    clearTimeout(this.resetTimer);
    clearTimeout(this.demoTimer);
    this.auto = false;
  }

  /** Centre of node `i`, row by row from the top left. */
  private node(i: number): Point {
    const cell = this.w / 3;
    return [cell * (i % 3) + cell / 2, cell * Math.floor(i / 3) + cell / 2];
  }

  /** Select node `i`; a node skipped in a straight line between the last one and `i` joins first. */
  private add(i: number): void {
    if (this.selected.includes(i)) return;
    const last: number | undefined = this.selected[this.selected.length - 1];
    if (last != null) {
      const ax = last % 3;
      const ay = Math.floor(last / 3);
      const bx = i % 3;
      const by = Math.floor(i / 3);
      if ((ax + bx) % 2 === 0 && (ay + by) % 2 === 0) {
        const mid = ((ay + by) / 2) * 3 + (ax + bx) / 2;
        if (!this.selected.includes(mid)) {
          this.selected.push(mid);
          this.flash[mid] = 1;
        }
      }
    }
    this.selected.push(i);
    this.flash[i] = 1;
  }

  private track(e: PointerEvent): void {
    const canvas = this.cv;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    this.pointer = [x, y];
    for (let i = 0; i < 9; i++) {
      const [nx, ny] = this.node(i);
      if (Math.hypot(nx - x, ny - y) < HIT_RADIUS) this.add(i);
    }
    this.kick();
  }

  /** Check the drawn pattern: green sparks and `unlock`, or a shattering trail and `fail`. */
  private finish(): void {
    this.pointer = null;
    if (this.selected.length < 2) {
      this.phase = "idle";
      this.selected = [];
      this.kick();
      return;
    }
    const P = this.P;
    const ok = this.selected.join(",") === this.secret.join(",");
    if (ok) {
      this.phase = "ok";
      this.dataset.state = "ok";
      rollText(this.$(".l"), "Unlocked", 1);
      this.selected.forEach((i, k) => {
        setTimeout(() => {
          const [x, y] = this.node(i);
          this.sparks.add(x, y, 16, [P.ok, P.shine], { speed: [40, 160] });
          this.flash[i] = 1;
          this.kick();
        }, k * 70);
      });
      this.emit("unlock");
      this.resetTimer = setTimeout(() => this.reset(), 2400);
    } else {
      this.phase = "wrong";
      this.dataset.state = "wrong";
      this.broken = true;
      rollText(this.$(".l"), "Wrong pattern", 1);
      for (const [x, y] of this.trail(true)) {
        this.debris.push({ x, y, vx: rand(-60, 60), vy: rand(-140, -20), age: 0, max: rand(0.5, 1) });
      }
      this.emit("fail");
      this.resetTimer = setTimeout(() => this.reset(), 1200);
    }
    this.kick();
  }

  /** Clears the current pattern, stops Show me and returns to the idle prompt. */
  reset(): void {
    this.stopTimers();
    this.clearPattern(true);
  }

  /** Back to the idle prompt; `animate` rolls the label. */
  private clearPattern(animate: boolean): void {
    this.phase = "idle";
    delete this.dataset.state;
    this.selected = [];
    this.pointer = null;
    this.debris = [];
    this.broken = false;
    rollText(this.$(".l"), IDLE_TEXT, -1, animate);
    this.kick();
  }

  /**
   * Draws the correct pattern node by node, then checks it. Ignored while already running or after a correct
   * pattern.
   */
  demo(): void {
    if (this.auto || this.phase === "ok") return;
    clearTimeout(this.resetTimer);
    this.auto = true;
    delete this.dataset.state;
    this.phase = "drawing";
    this.selected = [];
    this.debris = [];
    this.broken = false;
    const secret = this.secret;
    let k = 0;
    const step = (): void => {
      if (k < secret.length) {
        this.add(secret[k]);
        this.pointer = this.node(secret[k]);
        k++;
        this.kick();
        this.demoTimer = setTimeout(step, 260);
      } else {
        this.auto = false;
        this.finish();
      }
    };
    step();
  }

  /** Dots along the trail between selected nodes; unless `all`, also to the pointer while drawing. */
  private trail(all = false): Point[] {
    const pts: Point[] = [];
    const stops = this.selected.map((i) => this.node(i));
    if (!all && this.pointer && this.phase === "drawing" && stops.length) stops.push(this.pointer);
    for (let k = 1; k < stops.length; k++) {
      const [ax, ay] = stops[k - 1];
      const [bx, by] = stops[k];
      const n = Math.max(1, Math.floor(Math.hypot(bx - ax, by - ay) / 5));
      for (let j = 1; j < n; j++) {
        const u = j / n;
        const x = ax + (bx - ax) * u;
        const y = ay + (by - ay) * u;
        if (Math.hypot(x - ax, y - ay) < NODE_GAP || Math.hypot(x - bx, y - by) < NODE_GAP) continue;
        pts.push([x, y]);
      }
    }
    return pts;
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    const phase = this.phase;
    const still = reduced();
    const color = phase === "ok" ? P.ok : phase === "wrong" ? P.danger : P.accent;
    this.clear();
    if (!this.broken) {
      for (const [x, y] of this.trail()) this.dot(x - 1.2, y - 1.2, mix(color, P.shine, 0.25), 0.9, 2.4);
    }
    for (let i = 0; i < 9; i++) {
      const [x, y] = this.node(i);
      const on = this.selected.includes(i);
      this.flash[i] = Math.max(0, this.flash[i] - dt * 3);
      const f = this.flash[i];
      const nodeColor = on ? color : P.fg;
      const spread = 4 * (1 + f * 0.35);
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          this.dot(x + xx * spread - 1.6, y + yy * spread - 1.6, mix(nodeColor, P.shine, f * 0.6), on ? 1 : 0.35, 3.2);
        }
      }
      // a slowly turning ring around selected or flashing nodes
      if (on || f > 0) {
        const R = 17 + f * 6;
        for (let k = 0; k < 16; k++) {
          const a = (TAU * k) / 16 + (still ? 0 : t * 0.8);
          this.dot(x + Math.cos(a) * R - 1, y + Math.sin(a) * R - 1, nodeColor, (on ? 0.5 : 0) + f * 0.5, 2);
        }
      }
    }
    this.debris = this.debris.filter((d) => {
      d.age += dt;
      d.vy += 520 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.age > d.max) return false;
      this.dot(d.x, d.y, P.danger, 1 - d.age / d.max, 2.4);
      return true;
    });
    const sparking = this.sparks.step(g, dt);
    return phase === "drawing" || phase === "ok" || this.debris.length > 0 || sparking || this.flash.some((f) => f > 0);
  }
}

define("px-pattern", Pattern);

export { Pattern };

declare global {
  interface HTMLElementTagNameMap {
    "px-pattern": Pattern;
  }
}
