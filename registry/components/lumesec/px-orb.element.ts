/**
 * <px-orb> · Status orb
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/orb
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-orb.tsx.
 */
import { PxBase, TAU, clamp, define, hash, lerp, mix, reduced, rollText, segDist, type RGB } from "@/lib/lumesec/pixel";

/** The six agent states, in the order Enter, Space and clicks cycle through them. */
const ORB_STATES = ["idle", "listening", "thinking", "working", "error", "done"] as const;

/** An agent state shown by `<px-orb>`. */
export type OrbState = (typeof ORB_STATES)[number];

/** Events fired by `<px-orb>`. */
export interface OrbEventMap {
  /** The state changed through a click, a key or `set()`; not for the initial state or the `state` attribute. */
  change: CustomEvent<{ state: OrbState }>;
}

/** Cells per side of the square grid the disc is cut from. */
const GRID = 31;
/** Index of the centre cell. */
const CENTER = 15;

/** One cell of the disc, in grid and in unit-disc coordinates. */
interface OrbCell {
  gx: number;
  gy: number;
  /** Position in `[-1, 1]` from the centre. */
  u: number;
  v: number;
  /** Distance from the centre, 1 at the rim. */
  r: number;
  angle: number;
  /** Stable random value that staggers this cell's dissolve. */
  seed: number;
}

/** Brightness and colour of a cell. */
type Shade = [intensity: number, color: RGB];

const isOrbState = (value: string): value is OrbState => ORB_STATES.some((state) => state === value);

const capitalize = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** Gaussian falloff of `x` around `center`, 1 at the centre. */
const gauss = (x: number, center: number, width: number): number => Math.exp(-(((x - center) / width) ** 2));

/** Pixel disc showing an agent's state, dissolving cell by cell between states. */
class Orb extends PxBase {
  static readonly observedAttributes = ["state"] as const;

  private current: OrbState = "thinking";
  private prev: OrbState = "idle";
  /** Time of the last change; far in the past so the first state shows at once. */
  private changedAt = -10;
  private cells: OrbCell[] = [];

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: grid; justify-items: center; gap: 12px; }
      canvas.px { width: 164px; height: 164px; cursor: pointer; border-radius: 50%; }
      .lab { font-size: 14px; font-weight: 500; }
      .states { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
      .states .pbtn { height: 26px; padding: 0 9px; font-size: 12px; }
      `,
      `<div class="wrap"><canvas class="px" tabindex="0" role="button"></canvas><span class="rollslot lab" aria-live="polite"></span><div class="states"></div></div>`,
    );
    const box = this.$(".states");
    for (const state of ORB_STATES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pbtn";
      button.textContent = capitalize(state);
      button.dataset.s = state;
      button.addEventListener("click", () => this.set(state));
      box.appendChild(button);
    }
    const canvas = this.$("canvas");
    const next = (): void => this.set(ORB_STATES[(ORB_STATES.indexOf(this.current) + 1) % ORB_STATES.length]);
    canvas.addEventListener("click", next);
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        next();
      }
    });
  }

  protected override init(): void {
    this.cells = [];
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const u = (gx - CENTER) / CENTER;
        const v = (gy - CENTER) / CENTER;
        const r = Math.hypot(u, v);
        if (r <= 1.02) this.cells.push({ gx, gy, u, v, r, angle: Math.atan2(v, u), seed: hash(gx * 31 + gy) });
      }
    }
    this.apply(this.stateAttribute(), true);
  }

  attributeChangedCallback(): void {
    // before the first connect, init() reads the attribute; later changes dissolve without firing `change`
    if (this.initialized) this.apply(this.stateAttribute(), false, false);
  }

  /** The `state` attribute when it names a state, otherwise `thinking`. */
  private stateAttribute(): OrbState {
    const value = this.getAttribute("state") ?? "";
    return isOrbState(value) ? value : "thinking";
  }

  /** The current state. Setting it works like {@link Orb.set}. */
  get state(): OrbState {
    return this.current;
  }

  set state(value: OrbState) {
    this.set(value);
  }

  /** Switches to one of the six states and fires `change`. Unknown values and the current state are ignored. */
  set(state: OrbState): void {
    this.apply(state, false);
  }

  /** Show `state`; the first call (from `init`) skips the dissolve and the roll. `notify` fires `change`. */
  private apply(state: string, first: boolean, notify = !first): void {
    if (!isOrbState(state) || (state === this.current && !first)) return;
    this.prev = first ? state : this.current;
    this.current = state;
    this.changedAt = first ? -10 : this.t;
    const name = capitalize(state);
    const dir = ORB_STATES.indexOf(state) >= ORB_STATES.indexOf(this.prev) ? 1 : -1;
    rollText(this.$(".lab"), name, dir, !first);
    this.$("canvas").setAttribute("aria-label", `Agent status: ${name}. Click to cycle.`);
    for (const button of this.$$(".states .pbtn")) {
      button.setAttribute("aria-pressed", String(button.dataset.s === state));
    }
    if (notify) this.emit<{ state: OrbState }>("change", { state });
    this.kick();
  }

  /** Brightness and colour of `cell` at time `t` in `state`. */
  private field(state: OrbState, cell: OrbCell, t: number): Shade {
    const P = this.P;
    const { u, v, r, angle } = cell;
    switch (state) {
      case "idle": {
        const breath = 0.5 + 0.5 * Math.sin(t * 1.6);
        return [0.12 + 0.38 * breath * (1 - r * 0.7), P.accent];
      }
      case "listening": {
        const k = Math.pow(Math.max(0, Math.cos((r * 3 - t * 1.6) * TAU)), 6);
        return [0.08 + 0.92 * k * (1 - r * 0.35), mix(P.accent, P.shine, k * 0.5)];
      }
      case "thinking": {
        const k = Math.pow(Math.max(0, Math.cos(angle * 3 + r * 7 - t * 3.2)), 4) * (0.35 + 0.65 * r);
        return [0.07 + 0.93 * k, mix(P.accent, P.shine, k * 0.6)];
      }
      case "working": {
        const diff = (((t * 3.2 - angle) % TAU) + TAU) % TAU;
        const comet = Math.exp(-diff * 1.3) * gauss(r, 0.8, 0.11);
        const scan = r < 0.62 ? gauss(v, Math.sin(t * 2.2) * 0.55, 0.07) * 0.55 : 0;
        return [0.06 + Math.max(comet, scan), mix(P.accent, P.shine, comet * 0.8)];
      }
      case "error": {
        // rows glitch sideways a few frames at a time
        const frame = Math.floor(t * 14);
        const shift = hash(cell.gy * 3.7 + frame) > 0.78 ? (hash(cell.gy + frame * 1.3) - 0.5) * 0.8 : 0;
        const su = u + shift;
        const cross = r < 0.66 && (Math.abs(su - v) < 0.17 || Math.abs(su + v) < 0.17);
        const noise = 0.1 + 0.22 * hash(cell.gx * 7 + cell.gy * 13 + Math.floor(t * 9));
        return [cross ? 0.95 : noise, P.danger];
      }
      case "done": {
        const d = Math.min(segDist(u, v, -0.46, 0, -0.12, 0.34), segDist(u, v, -0.12, 0.34, 0.5, -0.36));
        const ring = gauss(r, (t - this.changedAt) * 1.3, 0.1) * 0.6;
        return d < 0.12 ? [1, mix(P.ok, P.shine, 0.15)] : [0.09 + ring, P.ok];
      }
    }
  }

  protected override render(t: number): boolean {
    const still = reduced();
    const pitch = this.w / GRID;
    const size = pitch * 0.66;
    const inset = (pitch - size) / 2;
    const since = t - this.changedAt;
    // under reduced motion each state is a still frame, taken once its intro (the done ring) has passed
    const time = still ? this.changedAt + 10 : t;
    this.clear();
    for (const cell of this.cells) {
      const m = still ? 1 : clamp((since - cell.seed * 0.42) / 0.16, 0, 1);
      let [intensity, color] = this.field(this.current, cell, time);
      if (m < 1) {
        const [prevIntensity, prevColor] = this.field(this.prev, cell, time);
        intensity = lerp(prevIntensity, intensity, m);
        color = mix(prevColor, color, m);
      }
      this.dot(cell.gx * pitch + inset, cell.gy * pitch + inset, color, Math.min(1, intensity), size);
    }
    return !still;
  }
}

define("px-orb", Orb);

export { Orb };

declare global {
  interface HTMLElementTagNameMap {
    "px-orb": Orb;
  }
}
