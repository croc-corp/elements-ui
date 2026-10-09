/**
 * <px-radar> · Service radar
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/radar
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-radar.tsx.
 *
 * Demo data: The six service nodes and their latencies are invented; nothing can be set. It cannot show your
 * own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { PxBase, TAU, define, mix, now, reduced, rollText, type Point, type RGB } from "@/lib/lumesec/pixel";

/** Events fired by `<px-radar>`. */
export interface RadarEventMap {
  /** Fires when the Ping button is pressed. */
  ping: CustomEvent<Record<string, never>>;
}

/** A demo service node in polar coordinates. */
interface ServiceNode {
  name: string;
  /** Distance from the centre as a fraction of the radius. */
  r: number;
  /** Angle in radians. */
  a: number;
  /** Latency in ms. */
  ms: number;
  degraded?: boolean;
}

/** A node on screen: when the beam last crossed it and its ping flash. */
interface Blip extends ServiceNode {
  hit: number;
  flash: number;
}

const NODES: readonly ServiceNode[] = [
  { name: "api-eu-1", r: 0.36, a: 0.6, ms: 42 },
  { name: "api-us-2", r: 0.62, a: 2.1, ms: 88 },
  { name: "edge-tokyo", r: 0.82, a: 3.7, ms: 131, degraded: true },
  { name: "worker-7", r: 0.52, a: 4.6, ms: 27 },
  { name: "db-primary", r: 0.22, a: 5.5, ms: 9 },
  { name: "queue-3", r: 0.9, a: 1.25, ms: 64 },
];

/** Width of the fading beam trail in radians. */
const WEDGE = 1.3;
/** Lifetime of a ping ring in seconds. */
const PING_TIME = 0.9;

/** Angle from `b` forward to `a`, in `[0, TAU)`. */
const angleAfter = (a: number, b: number): number => (((a - b) % TAU) + TAU) % TAU;

/**
 * Sweeping pixel radar where each service node lights up as the beam passes; Ping sends out a ring that flashes every
 * node it touches.
 */
class Radar extends PxBase {
  private readonly blips: Blip[] = NODES.map((node) => ({ ...node, hit: -9, flash: 0 }));
  /** Start times of the ping rings. */
  private rings: number[] = [];
  /** Node nearest the pointer, or -1. */
  private hover = -1;
  /** Node selected with the keyboard, or -1. */
  private selected = -1;
  /** Pointer position on the canvas, or null when outside. */
  private pointer: Point | null = null;
  /** Polar positions `[r, angle]` of the beam trail dots; null until the first layout. */
  private lattice: Point[] | null = null;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; position: relative; }
      .wrap { display: grid; justify-items: center; gap: 10px; }
      canvas.px { width: 232px; height: 232px; border-radius: 50%; cursor: crosshair; }
      .row { display: flex; align-items: center; gap: 10px; }
      .st { font-size: 12.5px; color: var(--_muted); }
      .tip { position: absolute; pointer-events: none; padding: 4px 8px; border-radius: 6px; background: var(--_fg); color: var(--_surface); font-size: 11.5px; white-space: nowrap; transform: translate(-50%, calc(-100% - 10px)); z-index: 3; }
      `,
      `<div class="wrap"><canvas class="px" tabindex="0" role="img" aria-label="Radar of 6 service nodes. Arrow keys step through them."></canvas><div class="row"><span class="rollslot st" aria-live="polite"></span><button class="pbtn ping" type="button">Ping</button></div></div><div class="tip" hidden></div><span class="sr" aria-live="polite"></span>`,
    );
    const canvas = this.canvas;
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer = [e.clientX - r.left, e.clientY - r.top];
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.hover = -1;
      this.updateTip();
    });
    canvas.addEventListener("keydown", (e) => {
      const n = this.blips.length;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        this.selected = (this.selected + 1) % n;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        this.selected = (this.selected - 1 + n) % n;
      } else {
        return;
      }
      // the tooltip is drawn for sighted users; assistive technology hears the node from a live region
      this.$(".sr").textContent = this.describe(this.blips[this.selected]);
      this.kick();
    });
    canvas.addEventListener("blur", () => {
      this.selected = -1;
      this.updateTip();
    });
    this.$(".ping").addEventListener("click", () => {
      this.rings.push(now());
      this.emit("ping");
      this.kick();
    });
  }

  protected override init(): void {
    const degraded = this.blips.filter((blip) => blip.degraded).length;
    rollText(this.$(".st"), `${this.blips.length} nodes · ${degraded} degraded`, 1, false);
  }

  protected override resized(): void {
    const radius = this.w / 2 - 8;
    this.lattice = [];
    for (let r = 8; r <= radius; r += 6) {
      const n = Math.floor((TAU * r) / 6);
      for (let k = 0; k < n; k++) this.lattice.push([r, (TAU * k) / n]);
    }
  }

  /** Canvas position of a node. */
  private position(blip: Blip): Point {
    const c = this.w / 2;
    const radius = c - 8;
    return [c + Math.cos(blip.a) * blip.r * radius, c + Math.sin(blip.a) * blip.r * radius];
  }

  /** Name, latency and state of a node, as shown in its tooltip. */
  private describe(blip: Blip): string {
    return `${blip.name} · ${blip.ms} ms${blip.degraded ? " · degraded" : ""}`;
  }

  /** Show the tooltip for the selected or hovered node, or hide it. */
  private updateTip(): void {
    const i = this.selected >= 0 ? this.selected : this.hover;
    const tip = this.$(".tip");
    if (i < 0) {
      tip.hidden = true;
      return;
    }
    const blip = this.blips[i];
    const [x, y] = this.position(blip);
    tip.textContent = this.describe(blip);
    tip.style.left = `${this.canvas.offsetLeft + x}px`;
    tip.style.top = `${this.canvas.offsetTop + y}px`;
    tip.hidden = false;
  }

  /** Draw a ring of `n` evenly spaced dots. */
  private ring(c: number, r: number, n: number, color: RGB, alpha: number, size: number): void {
    const offset = size / 2;
    for (let k = 0; k < n; k++) {
      const a = (TAU * k) / n;
      this.dot(c + Math.cos(a) * r - offset, c + Math.sin(a) * r - offset, color, alpha, size);
    }
  }

  protected override render(t: number, dt: number): boolean {
    const lattice = this.lattice;
    if (!lattice) return false;
    const P = this.P;
    const still = reduced();
    const c = this.w / 2;
    const radius = c - 8;
    const sweep = still ? 1.2 : (t * 1.6) % TAU;
    this.clear();
    for (const f of [0.33, 0.66, 1]) {
      const r = radius * f;
      this.ring(c, r, Math.floor((TAU * r) / 7), P.fg, 0.18, 2);
    }
    for (let d = -radius; d <= radius; d += 7) {
      this.dot(c + d - 1, c - 1, P.fg, 0.12, 2);
      this.dot(c - 1, c + d - 1, P.fg, 0.12, 2);
    }
    // the trail behind the beam fades with its angular distance
    for (const [r, a] of lattice) {
      const behind = angleAfter(sweep, a);
      if (behind > WEDGE) continue;
      const k = 1 - behind / WEDGE;
      this.dot(c + Math.cos(a) * r - 1.2, c + Math.sin(a) * r - 1.2, P.accent, k * k * 0.55, 2.4);
    }
    const beam = mix(P.accent, P.shine, 0.5);
    for (let r = 6; r <= radius; r += 4) {
      this.dot(c + Math.cos(sweep) * r - 1.3, c + Math.sin(sweep) * r - 1.3, beam, 0.95, 2.6);
    }
    this.rings = this.rings.filter((start) => {
      const age = t - start;
      const rr = (age / PING_TIME) * radius;
      if (age > PING_TIME) return false;
      this.ring(c, rr, Math.floor((TAU * rr) / 5) + 6, P.shine, (1 - age / PING_TIME) * 0.8, 2.4);
      for (const blip of this.blips) {
        if (Math.abs(blip.r * radius - rr) < 6) blip.flash = 1;
      }
      return true;
    });

    let nearest = -1;
    let nearestDistance = 14;
    this.blips.forEach((blip, i) => {
      // nodes drift slowly, alternately clockwise and counter-clockwise
      if (!still) blip.a = (blip.a + dt * 0.02 * (i % 2 ? 1 : -1) + TAU) % TAU;
      if (angleAfter(sweep, blip.a) < 0.12) blip.hit = t;
      blip.flash = Math.max(0, blip.flash - dt * 1.5);
      const brightness = Math.max(still ? 0.8 : Math.exp(-(t - blip.hit) * 0.9), blip.flash);
      const [x, y] = this.position(blip);
      const color = mix(blip.degraded ? P.warn : P.ok, P.shine, blip.flash * 0.6);
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          const alpha = 0.15 + 0.85 * brightness * (xx || yy ? 0.7 : 1);
          this.dot(x + xx * 3 - 1.3, y + yy * 3 - 1.3, color, alpha, 2.6);
        }
      }
      if (i === this.selected || i === this.hover) {
        for (let k = 0; k < 12; k++) {
          const a = (TAU * k) / 12 + (still ? 0 : t * 2);
          this.dot(x + Math.cos(a) * 9 - 1, y + Math.sin(a) * 9 - 1, P.fg, 0.8, 2);
        }
      }
      if (this.pointer) {
        const d = Math.hypot(this.pointer[0] - x, this.pointer[1] - y);
        if (d < nearestDistance) {
          nearestDistance = d;
          nearest = i;
        }
      }
    });
    if (this.pointer && nearest !== this.hover) {
      this.hover = nearest;
      this.updateTip();
    }
    // the selected node keeps drifting, so its tooltip follows it
    if (this.selected >= 0) this.updateTip();
    // under reduced motion nothing sweeps or drifts: draw only until ping rings and flashes are done
    return !still || this.rings.length > 0 || this.blips.some((blip) => blip.flash > 0);
  }
}

define("px-radar", Radar);

export { Radar };

declare global {
  interface HTMLElementTagNameMap {
    "px-radar": Radar;
  }
}
