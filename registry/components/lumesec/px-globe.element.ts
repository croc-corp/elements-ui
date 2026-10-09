/**
 * <px-globe> · Request globe
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/globe
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-globe.tsx.
 *
 * Demo data: The regions, the traffic between them, the latencies and the request counter are simulated;
 * nothing can be set. It cannot show your own data yet; use it as a template and replace the invented data
 * before it shows anything real.
 */
import { PxBase, TAU, clamp, define, fmtInt, hash, mix, now, reduced, rollText, type Point } from "@/lib/lumesec/pixel";

/** A point in 3D: on the unit sphere for surface points. */
type Vec3 = [x: number, y: number, z: number];

/** A region: name, latitude and longitude in degrees. */
type City = readonly [name: string, lat: number, lon: number];

const CITIES: readonly City[] = [
  ["San Francisco", 37.77, -122.42],
  ["New York", 40.71, -74],
  ["São Paulo", -23.55, -46.63],
  ["London", 51.5, -0.12],
  ["Frankfurt", 50.11, 8.68],
  ["Mumbai", 19.07, 72.88],
  ["Singapore", 1.35, 103.82],
  ["Tokyo", 35.68, 139.69],
  ["Sydney", -33.87, 151.21],
];

/** Dots on the globe surface. */
const SURFACE_DOTS = 1100;
/** Idle spin in rad/s. */
const IDLE_SPIN = 0.25;

/** A region on the sphere. */
interface RegionNode {
  name: string;
  v: Vec3;
}

/** A request travelling from node `from` to node `to`; `angle` is their great-circle distance in radians. */
interface Arc {
  from: number;
  to: number;
  start: number;
  duration: number;
  angle: number;
  arrived: boolean;
}

/** Where the last drag sample was taken. */
interface DragSample {
  x: number;
  y: number;
  time: number;
}

/** The region under the pointer and its screen position. */
interface HoveredNode {
  node: RegionNode;
  index: number;
  sx: number;
  sy: number;
}

/** Unit vector for a latitude and longitude in degrees. */
function toVector(lat: number, lon: number): Vec3 {
  const a = (lat * Math.PI) / 180;
  const b = (lon * Math.PI) / 180;
  return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
}

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Spherical interpolation between two unit vectors. */
function slerp(a: Vec3, b: Vec3, u: number): Vec3 {
  const omega = Math.acos(clamp(dot3(a, b), -1, 1));
  const sinOmega = Math.sin(omega);
  if (sinOmega < 1e-4) return a;
  const k0 = Math.sin((1 - u) * omega) / sinOmega;
  const k1 = Math.sin(u * omega) / sinOmega;
  return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
}

/** Evenly spread points on the unit sphere (Fibonacci lattice). */
function fibonacciSphere(n: number): Vec3[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i): Vec3 => {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    return [Math.cos(theta) * r, y, Math.sin(theta) * r];
  });
}

/**
 * Dotted pixel globe with nine regions; requests arc between them as glowing packets, each arrival flashes its node.
 * Drag to spin it.
 */
class Globe extends PxBase {
  private yaw = 0.4;
  private pitch = 0.32;
  /** Spin speed in rad/s. */
  private spin = IDLE_SPIN;
  private arcs: Arc[] = [];
  /** Requests counted so far. */
  private routed = 128403;
  /** Arrival flash per node, 1 on arrival, fading to 0. */
  private readonly flash: number[] = new Array<number>(CITIES.length).fill(0);
  /** Time the last arc was sent. */
  private lastArc = 0;
  private readonly surface = fibonacciSphere(SURFACE_DOTS);
  private readonly nodes: readonly RegionNode[] = CITIES.map(([name, lat, lon]) => ({ name, v: toVector(lat, lon) }));
  private drag: DragSample | null = null;
  /** Pointer position on the canvas, or null when outside. */
  private pointer: Point | null = null;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; position: relative; }
      .wrap { display: grid; justify-items: center; gap: 8px; }
      canvas.px { width: 236px; height: 236px; touch-action: none; cursor: grab; border-radius: 50%; }
      canvas.px:active { cursor: grabbing; }
      .st { font-size: 12.5px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      .tip { position: absolute; pointer-events: none; padding: 4px 8px; border-radius: 6px; background: var(--_fg); color: var(--_surface); font-size: 11.5px; white-space: nowrap; transform: translate(-50%, calc(-100% - 8px)); z-index: 3; }
      `,
      `<div class="wrap"><canvas class="px" role="img" aria-label="Spinning globe with requests routed between 9 regions. Drag to spin."></canvas><span class="rollslot st" aria-live="off"></span></div><div class="tip" hidden></div>`,
    );
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, time: now() };
      this.spin = 0;
      this.kick();
    });
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer = [e.clientX - r.left, e.clientY - r.top];
      if (!this.drag) {
        this.kick();
        return;
      }
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      const time = now();
      const elapsed = Math.max(0.008, time - this.drag.time);
      this.yaw += dx * 0.01;
      this.pitch = clamp(this.pitch + dy * 0.008, -0.8, 0.8);
      // the release speed carries on as spin
      this.spin = (dx * 0.01) / elapsed;
      this.drag = { x: e.clientX, y: e.clientY, time };
      this.kick();
    });
    const up = (): void => {
      this.drag = null;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.$(".tip").hidden = true;
    });
  }

  protected override init(): void {
    rollText(this.$(".st"), `${fmtInt(this.routed)} requests routed`, 1, false);
  }

  /** Rotate a point by yaw, then pitch; `z > 0` faces the viewer. */
  private project(v: Vec3): Vec3 {
    const cosYaw = Math.cos(this.yaw);
    const sinYaw = Math.sin(this.yaw);
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);
    const x1 = v[0] * cosYaw - v[2] * sinYaw;
    const z1 = v[0] * sinYaw + v[2] * cosYaw;
    const y2 = v[1] * cosPitch - z1 * sinPitch;
    const z2 = v[1] * sinPitch + z1 * cosPitch;
    return [x1, y2, z2];
  }

  /** Send a request between two random regions. */
  private sendArc(t: number): void {
    const count = this.nodes.length;
    const from = (Math.random() * count) | 0;
    let to = (Math.random() * count) | 0;
    if (to === from) to = (to + 3) % count;
    const angle = Math.acos(clamp(dot3(this.nodes[from].v, this.nodes[to].v), -1, 1));
    this.arcs.push({ from, to, start: t, duration: 0.8 + angle * 0.5, angle, arrived: false });
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const still = reduced();
    const c = this.w / 2;
    const R = c - 10;
    if (!this.drag) {
      this.spin += ((still ? 0 : IDLE_SPIN) - this.spin) * Math.min(1, dt * 1.2);
      this.yaw += this.spin * dt;
    }
    if (!still && t - this.lastArc > 0.45) {
      this.lastArc = t;
      this.sendArc(t);
    }

    this.clear();
    for (let k = 0; k < 90; k++) {
      const a = (TAU * k) / 90;
      this.dot(c + Math.cos(a) * (R + 3) - 1, c + Math.sin(a) * (R + 3) - 1, P.fg, 0.12, 2);
    }
    for (const v of this.surface) {
      const [x, y, z] = this.project(v);
      if (z <= 0) continue;
      // nearer dots are larger and brighter
      this.dot(c + x * R - 0.9, c - y * R - 0.9, P.fg, 0.08 + 0.42 * Math.pow(z, 1.4), 1.2 + z * 1.1);
    }

    let hovered: HoveredNode | null = null;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const [x, y, z] = this.project(node.v);
      this.flash[i] = Math.max(0, this.flash[i] - dt * 1.6);
      if (z <= 0.05) continue;
      const sx = c + x * R;
      const sy = c - y * R;
      const f = this.flash[i];
      const color = mix(P.accent, P.shine, f);
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          this.dot(sx + xx * 3 - 1.3, sy + yy * 3 - 1.3, color, z * (xx || yy ? 0.6 : 1), 2.6);
        }
      }
      if (f > 0) {
        const rr = 6 + (1 - f) * 12;
        for (let k = 0; k < 12; k++) {
          const a = (TAU * k) / 12;
          this.dot(sx + Math.cos(a) * rr - 1, sy + Math.sin(a) * rr - 1, P.accent, f * z, 2);
        }
      }
      if (this.pointer && Math.hypot(this.pointer[0] - sx, this.pointer[1] - sy) < 10) {
        hovered = { node, index: i, sx, sy };
      }
    }

    this.arcs = this.arcs.filter((arc) => {
      const u = (t - arc.start) / arc.duration;
      if (u > 1.25) return false;
      const va = this.nodes[arc.from].v;
      const vb = this.nodes[arc.to].v;
      // longer routes fly higher
      const altitude = 0.12 + arc.angle * 0.12;
      const pointAt = (q: number): Vec3 => {
        const s = slerp(va, vb, q);
        const m = 1 + altitude * Math.sin(Math.PI * q);
        return this.project([s[0] * m, s[1] * m, s[2] * m]);
      };
      /** Whether a projected point is hidden behind the globe. */
      const occluded = ([x, y, z]: Vec3): boolean => z < -0.05 && Math.hypot(x, y) < 1;
      const trailAlpha = 0.22 * (u > 1 ? (1.25 - u) / 0.25 : 1);
      for (let q = 0; q <= 1; q += 0.04) {
        const p = pointAt(q);
        if (occluded(p)) continue;
        this.dot(c + p[0] * R - 0.8, c - p[1] * R - 0.8, P.accent, trailAlpha, 1.6);
      }
      if (u <= 1) {
        // the packet: a bright head and a fading tail
        for (let k = 0; k < 8; k++) {
          const p = pointAt(clamp(u - k * 0.025, 0, 1));
          if (occluded(p)) continue;
          this.dot(c + p[0] * R - 1.3, c - p[1] * R - 1.3, k ? P.accent : P.shine, 1 - k * 0.11, k ? 2.2 : 2.8);
        }
      }
      if (u >= 1 && !arc.arrived) {
        arc.arrived = true;
        this.flash[arc.to] = 1;
        this.routed += 1 + Math.floor(Math.random() * 40);
        rollText(this.$(".st"), `${fmtInt(this.routed)} requests routed`, 1);
      }
      return true;
    });

    const tip = this.$(".tip");
    if (hovered) {
      const latency = Math.round(18 + hash(hovered.index * 9.1 + Math.floor(t)) * 70);
      tip.hidden = false;
      tip.textContent = `${hovered.node.name} · ${latency} ms`;
      tip.style.left = `${this.canvas.offsetLeft + hovered.sx}px`;
      tip.style.top = `${this.canvas.offsetTop + hovered.sy}px`;
    } else if (this.pointer) {
      tip.hidden = true;
    }
    if (!still) return true;
    // under reduced motion the globe comes to rest: draw until the release spin, arcs and flashes are done
    return this.drag !== null || Math.abs(this.spin) > 0.002 || this.arcs.length > 0 || this.flash.some((f) => f > 0);
  }
}

define("px-globe", Globe);

export { Globe };

declare global {
  interface HTMLElementTagNameMap {
    "px-globe": Globe;
  }
}
