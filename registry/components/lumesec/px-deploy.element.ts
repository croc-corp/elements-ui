/**
 * <px-deploy> · Slide to deploy
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/deploy
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-deploy.tsx.
 *
 * Demo data: The deploy run and the Live state are simulated on a timer, not on your deploy; only `version`
 * can be set. It cannot show your own data yet; use it as a template and replace the invented data before it
 * shows anything real.
 */
import { PxBase, Sparks, clamp, define, hash, mix, pixelBurst, rand, reduced, rollText } from "@/lib/lumesec/pixel";

/** Phase of the control; the host carries `data-state` while deploying or live. */
export type DeployState = "idle" | "deploying" | "live";

/** Events fired by `<px-deploy>`. */
export interface DeployEventMap {
  /** Fires when the slide is committed and the deploy sequence starts. */
  deploy: CustomEvent<Record<string, never>>;
  /** Fires 1.6 seconds after `deploy`, when the label switches to Live. */
  live: CustomEvent<Record<string, never>>;
}

/** Inner SVG of the thumb's arrow icon. */
const ARROW = '<path d="M4 9h10M10 5l4 4-4 4"/>';

/** Inner SVG of the thumb's check icon, shown while live. */
const TICK = '<path d="M4 9.5l3.2 3.2L14 5.5"/>';

/** Seconds of the deploy scan. */
const DEPLOY_TIME = 1.6;
/** Seconds the Live state is shown before the control resets. */
const LIVE_TIME = 2.6;
/** Half the thumb's width plus its inset: the thumb centre sits this far right of `x`. */
const THUMB_CENTER = 28;

/** Slide-to-deploy control whose pixel trail heats up as you drag. */
class Deploy extends PxBase {
  private phase: DeployState = "idle";
  /** Thumb offset from the start of the track in px. */
  private x = 0;
  private vx = 0;
  /** Active pointer drag; `x0` is the pointer x minus the thumb offset at the start. */
  private drag: { x0: number } | null = null;
  /** True while Enter or Space slides the thumb to the end. */
  private auto = false;
  /** Progress of the deploy scan from 0 to 1. */
  private progress = 0;
  /** Time the deploy started. */
  private deployedAt = 0;
  /** Time the deploy went live. */
  private liveAt = 0;
  private readonly sparks = new Sparks();

  constructor() {
    super(
      `
      :host { display: block; }
      .track { position: relative; height: 56px; border-radius: 28px; background: var(--_track); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_fg) 8%, transparent); touch-action: none; -webkit-user-select: none; user-select: none; }
      canvas.px { position: absolute; inset: 0; height: 100%; border-radius: 28px; }
      .lbl { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; font-size: 14px; font-weight: 500; color: var(--_muted); padding-left: 40px; }
      .lbl .rollslot { justify-items: center; }
      :host(:not([data-state])) .lbl .roll {
        color: transparent; background: linear-gradient(100deg, var(--_muted) 0%, var(--_muted) 40%, var(--_fg) 50%, var(--_muted) 60%, var(--_muted) 100%);
        background-size: 260% 100%; -webkit-background-clip: text; background-clip: text; animation: sh 2.2s linear infinite;
      }
      @keyframes sh { from { background-position: 100% 0; } to { background-position: 0% 0; } }
      :host([data-state="deploying"]) .lbl { color: var(--_fg); }
      :host([data-state="live"]) .lbl { color: var(--_ok); }
      .thumb {
        position: absolute; left: 6px; top: 6px; width: 44px; height: 44px; border-radius: 50%; background: var(--_surface);
        box-shadow: 0 2px 8px -2px rgba(0,0,0,.45), inset 0 0 0 1px var(--_border); display: grid; place-items: center;
        cursor: grab; touch-action: none; z-index: 2; color: var(--_accent); will-change: transform;
      }
      .thumb:active { cursor: grabbing; }
      .thumb svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      :host([data-state="live"]) .thumb { color: var(--_ok); }
      @media (prefers-reduced-motion: reduce) { :host(:not([data-state])) .lbl .roll { animation: none; } }
      `,
      `<div class="track"><canvas class="px"></canvas><div class="lbl"><span class="rollslot l" aria-live="polite"></span></div>
        <div class="thumb" tabindex="0" role="slider" aria-label="Slide to deploy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><svg viewBox="0 0 18 18" aria-hidden="true">${ARROW}</svg></div><span class="fxl"></span></div>`,
    );
    const thumb = this.$(".thumb");
    thumb.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.phase !== "idle") return;
      thumb.setPointerCapture(e.pointerId);
      this.drag = { x0: e.clientX - this.x };
      this.kick();
    });
    thumb.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      this.x = clamp(e.clientX - this.drag.x0, 0, this.maxX());
      this.vx = 0;
      this.kick();
    });
    const up = (): void => {
      if (!this.drag) return;
      this.drag = null;
      if (this.x / this.maxX() > 0.9) this.commit();
      else this.kick();
    };
    thumb.addEventListener("pointerup", up);
    thumb.addEventListener("pointercancel", up);
    thumb.addEventListener("keydown", (e) => {
      if (this.phase !== "idle") return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.auto = true;
        this.kick();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        this.x = Math.min(this.maxX(), this.x + this.maxX() * 0.1);
        if (this.x >= this.maxX() * 0.99) this.commit();
        this.kick();
      }
    });
  }

  /** Version shown in the Live label: the `version` attribute, or `v2.14.0`. */
  get version(): string {
    return this.getAttribute("version") || "v2.14.0";
  }

  set version(value: string) {
    this.setAttribute("version", value);
  }

  protected override init(): void {
    rollText(this.$(".l"), "Slide to deploy", 1, false);
  }

  /** Thumb travel in px. */
  private maxX(): number {
    return Math.max(1, this.$(".track").clientWidth - 56);
  }

  private setIcon(svg: string): void {
    this.$(".thumb svg").innerHTML = svg;
  }

  /** Runs the deploy sequence immediately, as if the thumb had reached the end. Ignored while deploying or live. */
  commit(): void {
    if (this.phase !== "idle") return;
    this.phase = "deploying";
    this.dataset.state = "deploying";
    this.auto = false;
    this.x = this.maxX();
    this.vx = 0;
    this.deployedAt = this.t;
    this.progress = 0;
    const P = this.P;
    const thumb = this.$(".thumb");
    rollText(this.$(".l"), "Deploying…", 1);
    pixelBurst(this, this.$(".fxl"), thumb, {
      count: 46,
      speed: [80, 300],
      angle: Math.PI,
      spread: Math.PI * 1.4,
      life: [0.4, 0.9],
    });
    this.sparks.add(this.x + THUMB_CENTER, 28, 20, [P.shine, P.accent], {
      speed: [120, 380],
      angle: Math.PI,
      spread: 0.5,
      life: [0.25, 0.5],
    });
    if (!reduced()) {
      thumb.animate([{ scale: "1" }, { scale: "1.25" }, { scale: "1" }], {
        duration: 480,
        easing: "cubic-bezier(.2,1.4,.4,1)",
      });
    }
    this.emit("deploy");
    this.kick();
  }

  /** Move the thumb: auto-slide, spring back after an early release, and the deploying → live → idle sequence. */
  private step(t: number, dt: number, maxX: number): void {
    const P = this.P;
    if (this.auto) {
      this.x = Math.min(maxX, this.x + dt * maxX * 2.2);
      if (this.x >= maxX) this.commit();
    }
    if (!this.drag && !this.auto && this.phase === "idle" && this.x > 0) {
      if (reduced()) {
        this.x = 0;
      } else {
        const stiffness = 300;
        const damping = 2 * Math.sqrt(stiffness) * 0.7;
        this.vx += (stiffness * (0 - this.x) - damping * this.vx) * dt;
        this.x = Math.max(0, this.x + this.vx * dt);
        if (this.x < 0.3 && Math.abs(this.vx) < 2) {
          this.x = 0;
          this.vx = 0;
        }
      }
    }
    if (this.phase === "deploying") {
      this.progress = Math.min(1, (t - this.deployedAt) / DEPLOY_TIME);
      if (this.progress >= 1) {
        this.phase = "live";
        this.dataset.state = "live";
        this.liveAt = t;
        this.setIcon(TICK);
        rollText(this.$(".l"), `Live · ${this.version}`, 1);
        this.sparks.add(this.w / 2, this.h / 2, 34, [P.ok, P.shine], { speed: [40, 160] });
        this.emit("live");
      }
    }
    if (this.phase === "live" && t - this.liveAt > LIVE_TIME) {
      this.phase = "idle";
      delete this.dataset.state;
      this.setIcon(ARROW);
      rollText(this.$(".l"), "Slide to deploy", -1);
    }
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    const { w, h } = this;
    const still = reduced();
    const maxX = this.maxX();
    this.step(t, dt, maxX);
    const thumb = this.$(".thumb");
    thumb.style.transform = `translateX(${this.x}px)`;
    thumb.setAttribute("aria-valuenow", String(Math.round((this.x / maxX) * 100)));
    const p = this.x / maxX;
    this.$(".lbl").style.opacity = this.phase === "idle" ? String(clamp(1 - p * 1.5, 0, 1)) : "1";
    this.clear();
    const thumbCenter = this.x + THUMB_CENTER;
    for (let x = 8; x < w - 6; x += 4) {
      for (let y = 9; y < h - 8; y += 4) {
        const n = hash(x * 1.31 + y * 7.7);
        let alpha = 0;
        let color = P.accent;
        if (this.phase === "idle") {
          // the trail behind the thumb gets denser, brighter and hotter as it nears the end
          if (x > thumbCenter - 18) continue;
          const u = x / Math.max(1, thumbCenter);
          if (n > Math.pow(u, 1.4) * (0.3 + 0.7 * p)) continue;
          alpha = (0.25 + 0.75 * u) * (0.55 + 0.45 * Math.sin(t * (3 + n * 5) + n * 30)) * Math.min(1, p * 4);
          color = mix(P.accent, P.shine, u * p * 0.9);
          if (p > 0.75 && !still) {
            const jitter = (p - 0.75) * 6;
            this.dot(x + rand(-jitter, jitter), y + rand(-jitter, jitter), color, alpha, 2.2);
            continue;
          }
        } else if (this.phase === "deploying") {
          // a scan front sweeps left to right
          const front = this.progress * w;
          if (x > front + 6) {
            if (n >= 0.5) continue;
            alpha = 0.12;
            color = P.fg;
          } else {
            const edge = Math.max(0, 1 - (front - x) / 30);
            alpha = 0.35 + 0.6 * edge;
            color = mix(P.accent, P.shine, edge * 0.7);
            if (n > 0.85 - edge * 0.5) alpha *= 0.4;
          }
        } else {
          // live: the green field dissolves
          const f = clamp((t - this.liveAt) / 1.4, 0, 1);
          if (n < f) continue;
          alpha = 0.5 * (1 - f);
          color = P.ok;
        }
        this.dot(x, y, color, alpha, 2.2);
      }
    }
    this.sparks.step(g, dt);
    return this.drag !== null || this.auto || this.phase !== "idle" || this.x > 0 || this.sparks.list.length > 0;
  }
}

define("px-deploy", Deploy);

export { Deploy };

declare global {
  interface HTMLElementTagNameMap {
    "px-deploy": Deploy;
  }
}
