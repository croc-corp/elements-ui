/**
 * <px-charge> · Charge to generate
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/charge
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-charge.tsx.
 */
import { PxBase, Sparks, TAU, clamp, define, mix, now, rand, reduced, rollText } from "@/lib/lumesec/pixel";

/** Events fired by `<px-charge>`. */
export interface ChargeEventMap {
  /**
   * Fires on release after a long enough hold. `count` is 1 to 4 variations; `charge` is the fill level from 0 to
   * 1, rounded to two decimals.
   */
  generate: CustomEvent<{ count: number; charge: number }>;
}

/** Phase of the button: `fired` lasts 2.4 seconds after a release, during which a new charge is ignored. */
type ChargePhase = "idle" | "charging" | "fired";

/** Seconds for a full charge. */
const FULL_CHARGE = 1.6;
/** Releases below this charge show "Hold longer" and fire nothing. */
const MIN_CHARGE = 0.18;
/** Button label per charging stage. */
const STAGE_LABELS = ["Charging…", "Keep holding…", "Release!"] as const;
const IDLE_LABEL = "Hold to generate";
const IDLE_HINT = "Hold longer for more variations";

/** A pixel spiralling in towards the button while charging. */
interface Inflow {
  angle: number;
  radius: number;
  /** Angular speed in radians per second; the sign sets the direction. */
  spin: number;
  /** Inward speed in px/s. */
  speed: number;
}

/** A shockwave ring after firing. */
interface Shockwave {
  t0: number;
  /** Charge that fired it; sets how far it travels. */
  p: number;
}

/** Press-and-hold generate button: pixels spiral in as a ring fills, and release fires a shockwave. */
class Charge extends PxBase {
  /** Charge level from 0 to 1. */
  private charge = 0;
  private charging = false;
  private phase: ChargePhase = "idle";
  private inflow: Inflow[] = [];
  private rings: Shockwave[] = [];
  private readonly sparks = new Sparks();
  /** Fractional inflow pixels owed to the clock. */
  private pending = 0;
  /** Index of the label shown while charging; -1 before the first. */
  private stage = -1;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { position: relative; height: 196px; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .btn {
        position: absolute; left: 50%; top: 46%; translate: -50% -50%; min-width: 196px; height: 52px; padding: 0 24px;
        border: 0; border-radius: 14px; cursor: pointer; touch-action: none; font-size: 15px; font-weight: 600;
        display: grid; place-items: center; background: var(--_accent); color: var(--_on-accent);
        box-shadow: 0 0 calc(var(--c, 0) * 36px) calc(var(--c, 0) * 7px) color-mix(in srgb, var(--_accent) 55%, transparent), 0 8px 18px -10px rgba(0,0,0,.55);
      }
      .btn .rollslot { justify-items: center; }
      .sub { position: absolute; left: 0; right: 0; bottom: 4px; justify-items: center; font-size: 12px; color: var(--_muted); }
      `,
      `<div class="wrap"><canvas class="px" aria-hidden="true"></canvas><button class="btn" type="button"><span class="rollslot l"></span></button><span class="rollslot sub" aria-live="polite"></span></div>`,
    );
    const button = this.$(".btn");
    button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      this.start();
    });
    for (const type of ["pointerup", "pointercancel"]) button.addEventListener(type, () => this.release());
    button.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        this.start();
      }
    });
    button.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        this.release();
      }
    });
    // focus leaving mid-hold (another window, a tab key) ends the hold without firing
    button.addEventListener("blur", () => this.cancel());
    button.addEventListener("click", (e) => e.preventDefault());
    button.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  protected override init(): void {
    this.showIdle(false);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // a removed button cannot be released; start over when it comes back
    clearTimeout(this.resetTimer);
    this.charging = false;
    this.charge = 0;
    this.inflow = [];
    this.rings = [];
    this.phase = "idle";
    this.showIdle(false);
  }

  /** Restore the resting label and hint. */
  private showIdle(animate: boolean): void {
    rollText(this.$(".l"), IDLE_LABEL, -1, animate);
    rollText(this.$(".sub"), IDLE_HINT, -1, animate);
  }

  /**
   * Begins charging, as if the button were pressed. Ignored while charging or during the 2.4 seconds after a
   * release fires.
   */
  start(): void {
    if (this.phase === "fired" || this.charging) return;
    clearTimeout(this.resetTimer);
    this.charging = true;
    this.phase = "charging";
    this.stage = -1;
    this.kick();
  }

  /** Ends charging. Below 18% it shows "Hold longer" and fires nothing; otherwise it fires `generate`. */
  release(): void {
    if (!this.charging) return;
    this.charging = false;
    if (this.charge < MIN_CHARGE) {
      this.phase = "idle";
      rollText(this.$(".l"), "Hold longer", 1);
      clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => rollText(this.$(".l"), IDLE_LABEL, -1), 1200);
      this.kick();
      return;
    }
    this.fire();
  }

  /** End a hold without firing; the ring drains back to empty. */
  private cancel(): void {
    if (!this.charging) return;
    this.charging = false;
    this.phase = "idle";
    clearTimeout(this.resetTimer);
    this.showIdle(true);
    this.kick();
  }

  /** Burst, send a shockwave sized to the charge and report one to four variations. */
  private fire(): void {
    const P = this.P;
    const c = this.charge;
    const count = Math.max(1, Math.round(c * 4));
    const cx = this.w / 2;
    const cy = this.h * 0.46;
    this.sparks.add(cx, cy, Math.round(30 + c * 150), [P.accent, P.shine, P.accent], {
      speed: [60, 160 + 320 * c],
      life: [0.4, 1.1],
      jitter: 34,
    });
    for (const p of this.inflow) {
      const x = cx + Math.cos(p.angle) * p.radius;
      const y = cy + Math.sin(p.angle) * p.radius * 0.55;
      this.sparks.add(x, y, 1, [P.shine], { speed: [80, 220], life: [0.3, 0.6] });
    }
    this.inflow = [];
    const t = now();
    this.rings.push({ t0: t, p: c });
    if (c > 0.75) this.rings.push({ t0: t + 0.12, p: c * 0.7 });
    this.phase = "fired";
    rollText(this.$(".l"), `${count} variation${count > 1 ? "s" : ""} ready`, 1);
    rollText(this.$(".sub"), `Charged to ${Math.round(c * 100)}%`, 1);
    if (!reduced()) {
      this.$(".btn").animate([{ scale: "1.14" }, { scale: "1" }], {
        duration: 520,
        easing: "cubic-bezier(.2,1.4,.4,1)",
      });
    }
    this.charge = 0;
    this.emit<{ count: number; charge: number }>("generate", { count, charge: +c.toFixed(2) });
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.phase = "idle";
      this.showIdle(true);
    }, 2400);
    this.kick();
  }

  /** Fill or drain the charge, update the label and the button glow, and spawn inflowing pixels. */
  private step(dt: number, still: boolean): void {
    if (this.charging) this.charge = Math.min(1, this.charge + dt / FULL_CHARGE);
    else if (this.phase !== "fired") this.charge = Math.max(0, this.charge - dt * 1.8);
    if (this.charging) {
      const stage = this.charge >= 1 ? 2 : this.charge > 0.55 ? 1 : 0;
      if (stage !== this.stage) {
        this.stage = stage;
        rollText(this.$(".l"), STAGE_LABELS[stage], 1);
      }
    }
    const button = this.$(".btn");
    button.style.setProperty("--c", this.charge.toFixed(3));
    // the button trembles in the last 30% of the charge
    const tremble = this.charging && this.charge > 0.7 && !still ? (this.charge - 0.7) * 6 : 0;
    const dx = tremble ? rand(-tremble, tremble) : 0;
    const dy = tremble ? rand(-tremble, tremble) : 0;
    button.style.transform = `translate(${dx}px, ${dy}px) scale(${1 + this.charge * 0.05})`;
    if (this.charging && !still) {
      this.pending += dt * (40 + 300 * this.charge);
      while (this.pending >= 1) {
        this.pending--;
        this.inflow.push({
          angle: rand(0, TAU),
          radius: rand(112, Math.max(140, this.w * 0.52)),
          spin: rand(1.2, 2.6) * (Math.random() < 0.5 ? -1 : 1),
          speed: rand(50, 110),
        });
      }
    }
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    const cx = this.w / 2;
    const cy = this.h * 0.46;
    this.step(dt, reduced());
    this.clear();

    // the charge ring around the button
    const dots = 56;
    for (let k = 0; k < dots; k++) {
      const a = -Math.PI / 2 + (TAU * k) / dots;
      const lit = k / dots < this.charge;
      const color = lit ? mix(P.accent, P.shine, this.charge * 0.6) : P.fg;
      this.dot(cx + Math.cos(a) * 118 - 1.2, cy + Math.sin(a) * 64 - 1.2, color, lit ? 0.9 : 0.1, 2.4);
    }

    // inflowing pixels spiral faster as they near the button
    this.inflow = this.inflow.filter((p) => {
      p.radius -= (p.speed + 260 * this.charge) * dt;
      p.angle += p.spin * dt * (1 + 40 / Math.max(20, p.radius));
      if (p.radius < 30) return false;
      const near = clamp(1 - (p.radius - 30) / 120, 0, 1);
      const x = cx + Math.cos(p.angle) * p.radius - 1.1;
      const y = cy + Math.sin(p.angle) * p.radius * 0.55 - 1.1;
      this.dot(x, y, mix(P.accent, P.shine, near * 0.8), 0.3 + 0.7 * near, 2.2);
      return true;
    });

    this.rings = this.rings.filter((ring) => {
      const age = t - ring.t0;
      if (age > 1) return false;
      if (age < 0) return true;
      const radius = 40 + age * (240 + 220 * ring.p);
      for (let k = 0; k < 72; k++) {
        const a = (TAU * k) / 72;
        const x = cx + Math.cos(a) * radius - 1.3;
        const y = cy + Math.sin(a) * radius * 0.55 - 1.3;
        this.dot(x, y, mix(P.accent, P.shine, 1 - age), (1 - age) * 0.9, 2.6);
      }
      return true;
    });
    const sparking = this.sparks.step(g, dt);
    return this.charging || this.charge > 0 || this.inflow.length > 0 || this.rings.length > 0 || sparking;
  }
}

define("px-charge", Charge);

export { Charge };

declare global {
  interface HTMLElementTagNameMap {
    "px-charge": Charge;
  }
}
