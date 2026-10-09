/**
 * <px-launch> · Release rocket
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/launch
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-launch.tsx.
 *
 * Demo data: The countdown and the live state run on a timer, not on your release; only `version` can be set.
 * It cannot show your own data yet; use it as a template and replace the invented data before it shows
 * anything real.
 */
import { PxBase, bitmap, clamp, css, define, ease3, mix, now, rand, reduced, rollText } from "@/lib/lumesec/pixel";

/** Events fired by `<px-launch>`. */
export interface LaunchEventMap {
  /** The countdown reached zero and the rocket lifts off. */
  liftoff: CustomEvent<Record<string, never>>;
  /** The rocket has left the frame. */
  launched: CustomEvent<Record<string, never>>;
}

/** Flight phase: on the pad, counting down, climbing, out of frame, landing. */
type LaunchState = "idle" | "count" | "lift" | "gone" | "return";

/** A background star; `x` and `y` are fractions of the sky. */
interface Star {
  x: number;
  y: number;
  speed: number;
  phase: number;
}

/** An exhaust flame pixel or a puff of pad smoke. */
interface Particle {
  kind: "flame" | "smoke";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

const ROCKET = bitmap([
  "....#....",
  "...###...",
  "...###...",
  "..##.##..",
  "..#####..",
  "..#####..",
  "..#####..",
  ".#######.",
  "##.###.##",
  "#..###..#",
  "...#.#...",
]);

/** Pixel size of the rocket bitmap. */
const PS = 4;
/** Height the rocket climbs past the canvas before it counts as gone. */
const EXIT = 60;
/** Duration of the landing in seconds. */
const LANDING = 1.8;

/**
 * Release animation with a pixel rocket: a three-second countdown, smoke on the pad, then liftoff while the stars
 * streak past.
 */
class Launch extends PxBase {
  private state: LaunchState = "idle";
  /** Rocket offset from the pad in px (negative is up). */
  private ry = 0;
  /** Vertical speed in px/s. */
  private vy = 0;
  private particles: Particle[] = [];
  /** Countdown digit pop, 1 when a digit appears, easing to 0. */
  private pop = 0;
  /** Digit currently shown by the countdown. */
  private countdown = 3;
  /** Countdown start. */
  private t0 = 0;
  /** Liftoff time. */
  private t1 = 0;
  /** Time the rocket left the frame. */
  private t2 = 0;
  /** Landing start. */
  private t3 = 0;
  private readonly stars: Star[] = Array.from({ length: 46 }, () => ({
    x: Math.random(),
    y: Math.random(),
    speed: rand(1, 4),
    phase: rand(0, 9),
  }));
  /** Font stacks for the countdown, read on layout. */
  private mono = "monospace";
  private sans = "sans-serif";
  private readonly button = this.$<HTMLButtonElement>(".go");
  private readonly status = this.$(".st");

  constructor() {
    super(
      `
      :host { display: block; }
      .pbtn[aria-disabled="true"] { opacity: .45; pointer-events: none; }
      canvas.px { height: 236px; border-radius: 12px; }
      .bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px; }
      .st { font-size: 13px; color: var(--_muted); }
      :host([data-state="gone"]) .st { color: var(--_ok); }
      `,
      `<canvas class="px" role="img" aria-label="Rocket on the launch pad"></canvas><div class="bar"><span class="rollslot st" aria-live="polite"></span><button class="pbtn go" type="button">Launch</button></div>`,
    );
    this.button.addEventListener("click", () => this.go());
  }

  /** Version shown in the "Launched · <version> is live" status: the `version` attribute, or `v2.14`. */
  get version(): string {
    return this.getAttribute("version") || "v2.14";
  }

  set version(value: string) {
    this.setAttribute("version", value);
  }

  protected override init(): void {
    rollText(this.status, "Ready on the pad", 1, false);
  }

  protected override resized(): void {
    this.mono = this.monoFont;
    this.sans = getComputedStyle(this).fontFamily || "sans-serif";
  }

  /** Draw `text` with its ink centred on `(x, y)`. */
  private centredText(text: string, font: string, x: number, y: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText(text);
    ctx.fillText(text, x, y + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
  }

  /** Starts the countdown when the rocket is on the pad, or lands it again after a launch. Ignored mid-flight. */
  go(): void {
    if (this.state === "idle") {
      this.state = "count";
      this.t0 = now();
      this.countdown = 4;
      // aria-disabled rather than disabled, so a keyboard user keeps focus on the button
      this.button.setAttribute("aria-disabled", "true");
      rollText(this.status, "Countdown", 1);
    } else if (this.state === "gone") {
      this.state = "return";
      this.t3 = now();
      this.button.setAttribute("aria-disabled", "true");
      delete this.dataset.state;
      rollText(this.status, "Landing…", -1);
    }
    this.kick();
  }

  /** Advance the flight state machine. */
  private advance(t: number, dt: number): void {
    const h = this.h;
    if (this.state === "count") {
      const n = 3 - Math.floor(t - this.t0);
      if (n !== this.countdown) {
        this.countdown = n;
        this.pop = 1;
        if (n <= 0) {
          this.state = "lift";
          this.vy = 0;
          this.t1 = t;
          rollText(this.status, "Liftoff", 1);
          this.emit("liftoff");
        }
      }
    }
    if (this.state === "lift") {
      this.vy -= (60 + 900 * (t - this.t1)) * dt;
      this.ry += this.vy * dt;
      if (this.ry < -(h + EXIT)) {
        this.state = "gone";
        this.dataset.state = "gone";
        this.t2 = t;
        rollText(this.status, `Launched · ${this.version} is live`, 1);
        this.button.textContent = "Land it";
        this.button.removeAttribute("aria-disabled");
        this.emit("launched");
      }
    }
    if (this.state === "return") {
      const u = clamp((t - this.t3) / LANDING, 0, 1);
      this.ry = -(h + EXIT) * (1 - ease3(u));
      if (u >= 1) {
        this.state = "idle";
        this.ry = 0;
        rollText(this.status, "Ready on the pad", -1);
        this.button.textContent = "Launch";
        this.button.removeAttribute("aria-disabled");
      }
    }
  }

  /** How fast the stars scroll in px/s: they streak down during the climb and drift up while landing. */
  private starSpeed(t: number): number {
    switch (this.state) {
      case "lift":
        return Math.min(700, -this.vy * 0.6);
      case "gone":
        return Math.max(0, 700 * (1 - (t - this.t2) / 1.5));
      case "return":
        return -140 * (1 - clamp((t - this.t3) / LANDING, 0, 1));
      default:
        return 0;
    }
  }

  /** Engine thrust from 0 to 1, which sets how many exhaust pixels are emitted. */
  private thrust(): number {
    if (this.state === "lift") return 1;
    if (this.state === "return") return 0.35;
    if (this.state === "count" && this.countdown <= 1) return 0.22;
    return 0;
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const w = this.w;
    const h = this.h;
    const still = reduced();
    const padY = h - 26;
    const rx = Math.round(w * 0.38);
    this.advance(t, dt);
    this.pop = Math.max(0, this.pop - dt * 2.5);
    this.clear();

    const starSpeed = still ? 0 : this.starSpeed(t);
    const skyH = padY - 8;
    for (const star of this.stars) {
      star.y = (((star.y + (starSpeed * dt) / skyH) % 1) + 1) % 1;
      // the stars twinkle; under reduced motion each keeps a fixed brightness
      const twinkle = 0.3 + 0.5 * Math.abs(Math.sin((still ? 0 : t * star.speed) + star.phase));
      const x = star.x * w;
      const y = star.y * skyH;
      this.dot(x, y, P.fg, twinkle * 0.55, 1.6);
      const streak = starSpeed > 200 ? Math.min(16, starSpeed / 40) : 0;
      for (let k = 2; k < streak; k += 2) this.dot(x, y - k, P.fg, twinkle * 0.3 * (1 - k / streak), 1.6);
    }

    for (let x = 2; x < w; x += 6) this.dot(x, padY + 6, P.fg, 0.22, 2);
    for (let x = rx - 26; x <= rx + 24; x += 4) this.dot(x, padY + 1, P.muted, 0.7, 3);

    let shake = 0;
    if (!still) {
      if (this.state === "count") shake = (4 - this.countdown) * 0.6;
      else if (this.state === "lift" && t - this.t1 < 0.6) shake = 1.6;
    }
    const ox = rx - 18 + (shake ? rand(-shake, shake) : 0);
    const oy = padY - 11 * PS + this.ry;
    for (const [x, y] of ROCKET) {
      const fin = y >= 7 && (x <= 1 || x >= 7);
      this.dot(ox + x * PS, oy + y * PS, fin ? P.accent : P.fg, 0.95, PS * 0.85);
    }
    // the porthole
    this.dot(ox + 4 * PS, oy + 3 * PS, mix(P.accent, P.shine, 0.5), 1, PS * 0.85);

    const thrust = this.thrust();
    if (thrust && !still) {
      for (let k = 0; k < Math.round(thrust * 10); k++) {
        this.particles.push({
          kind: "flame",
          x: rx + rand(-5, 5),
          y: oy + 11 * PS,
          vx: rand(-30, 30),
          vy: rand(150, 320) * thrust + 40,
          age: 0,
          life: rand(0.25, 0.6),
        });
      }
      if (this.state === "lift" && t - this.t1 < 2) {
        for (let k = 0; k < 3; k++) {
          this.particles.push({
            kind: "smoke",
            x: rx + rand(-8, 8),
            y: padY - 2,
            vx: rand(-160, 160),
            vy: rand(-30, -5),
            age: 0,
            life: rand(0.8, 1.6),
          });
        }
      }
    }
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      if (p.age > p.life) return false;
      const f = p.age / p.life;
      if (p.kind === "flame") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // flames hitting the pad spread sideways
        if (p.y > padY) {
          p.y = padY;
          p.vy = 0;
          p.vx *= 1.5;
        }
        const color = f < 0.3 ? mix(P.shine, P.warn, f / 0.3) : mix(P.warn, P.danger, (f - 0.3) / 0.7);
        this.dot(p.x, p.y, color, 1 - f, 2.6);
      } else {
        p.vx *= Math.exp(-dt * 1.5);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        this.dot(p.x, p.y, P.muted, (1 - f) * 0.5, 3 + f * 3);
      }
      return true;
    });

    const tx = w * 0.72;
    const ty = h * 0.38;
    if (this.state === "count" && this.countdown > 0) {
      const size = 64 * (1 + this.pop * 0.35);
      ctx.globalAlpha = 0.4 + 0.6 * (1 - this.pop * 0.5);
      ctx.fillStyle = css(this.countdown === 1 ? P.accent : P.fg);
      this.centredText(String(this.countdown), `600 ${size.toFixed(1)}px ${this.mono}`, tx, ty);
    }
    if (this.state === "lift" && t - this.t1 < 1) {
      ctx.globalAlpha = 1 - (t - this.t1);
      ctx.fillStyle = css(P.accent);
      this.centredText("Go", `600 52px ${this.sans}`, tx, ty);
    }
    ctx.globalAlpha = 1;
    // on the pad or out of frame only the twinkle moves, which reduced motion turns off
    const resting = this.state === "idle" || this.state === "gone";
    return !resting || !still || this.particles.length > 0 || this.pop > 0 || starSpeed !== 0;
  }
}

define("px-launch", Launch);

export { Launch };

declare global {
  interface HTMLElementTagNameMap {
    "px-launch": Launch;
  }
}
