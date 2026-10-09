/**
 * <px-jog> · Jog wheel
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/jog
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-jog.tsx.
 *
 * Demo data: The filmstrip footage and its length are generated; nothing can be set. It cannot show your own
 * data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { PxBase, TAU, clamp, css, define, hash, mix, now, pad2, reduced, rollText } from "@/lib/lumesec/pixel";

/** Frames per revolution. */
const FPR = 48;

/** Last frame of the two-minute clip at 24 fps. */
const MAX_FRAME = 24 * 60 * 2;

/** Window in seconds over which the release speed is measured. */
const FLICK_WINDOW = 0.08;

/** A drag sample: time in seconds and the angle turned since the previous sample. */
type DragSample = [time: number, delta: number];

/**
 * Pixel jog wheel that keeps spinning with inertia after release, driving a running timecode and a filmstrip that
 * scrubs underneath.
 */
class Jog extends PxBase {
  /** Wheel angle in radians; one revolution is {@link FPR} frames. Starts at frame 60. */
  private rot = (TAU * 60) / FPR;
  /** Coasting speed in rad/s after a flick. */
  private spin = 0;
  /** Pointer angle at the last drag sample, or null when not dragging. */
  private dragAngle: number | null = null;
  private samples: DragSample[] = [];
  /** Last timecode written to the readout. */
  private lastTimecode = "";
  /** Playback rate last shown by the label. */
  private lastRate = 0;
  /** Monospace font stack for the filmstrip labels, read on layout. */
  private mono = "monospace";
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      canvas.px { height: 268px; touch-action: none; }
      .bar { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-top: 8px; }
      .tc { font-family: var(--_mono); font-size: 18px; font-weight: 500; font-variant-numeric: tabular-nums; }
      .sp { font-size: 12.5px; color: var(--_muted); }
      `,
      `<canvas class="px" tabindex="0" role="slider" aria-label="Jog wheel. Arrow keys step one frame, Shift steps one second." aria-valuemin="0" aria-valuemax="${MAX_FRAME}"></canvas><div class="bar"><span class="tc"></span><span class="rollslot sp"></span></div>`,
    );
    const canvas = this.canvas;
    /** Pointer angle around the wheel centre. */
    const angleOf = (e: PointerEvent): number => {
      const r = canvas.getBoundingClientRect();
      return Math.atan2(e.clientY - r.top - 100, e.clientX - r.left - r.width / 2);
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      // no focus() here: the browser focuses the wheel itself, without a focus ring after mouse use
      canvas.setPointerCapture(e.pointerId);
      this.dragAngle = angleOf(e);
      this.spin = 0;
      this.samples = [];
      this.kick();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.dragAngle === null) return;
      const a = angleOf(e);
      let d = a - this.dragAngle;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      this.dragAngle = a;
      this.rot += d;
      const time = now();
      this.samples.push([time, d]);
      this.samples = this.samples.filter(([sampleTime]) => time - sampleTime < FLICK_WINDOW);
      this.kick();
    });
    const up = (): void => {
      if (this.dragAngle === null) return;
      this.dragAngle = null;
      const sum = this.samples.reduce((total, [, d]) => total + d, 0);
      this.spin = this.samples.length ? clamp(sum / FLICK_WINDOW, -40, 40) : 0;
      this.kick();
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 24 : 1;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") this.stepFrames(e, step);
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") this.stepFrames(e, -step);
      if (e.key === "Home") this.stepFrames(e, -MAX_FRAME);
      if (e.key === "End") this.stepFrames(e, MAX_FRAME);
    });
  }

  protected override init(): void {
    rollText(this.$(".sp"), "Paused", 1, false);
  }

  protected override resized(): void {
    this.mono = this.monoFont;
  }

  /** Turn the wheel by `frames` for a key press and stop any coasting; the clip ends clamp it. */
  private stepFrames(e: KeyboardEvent, frames: number): void {
    e.preventDefault();
    this.rot += (TAU / FPR) * frames;
    this.spin = 0;
    this.kick();
  }

  protected override render(_t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const w = this.w;
    const cx = w / 2;
    const cy = 100;
    const still = reduced();
    const prevRot = this.rot;
    if (this.dragAngle === null && this.spin) {
      if (still) this.spin = 0;
      this.rot += this.spin * dt;
      this.spin *= Math.exp(-dt * 1.3);
      if (Math.abs(this.spin) < 0.05) this.spin = 0;
    }
    // bounce softly off both ends of the clip
    const maxRot = (MAX_FRAME / FPR) * TAU;
    if (this.rot < 0) {
      this.rot = 0;
      this.spin = Math.abs(this.spin) * 0.3;
    }
    if (this.rot > maxRot) {
      this.rot = maxRot;
      this.spin = -Math.abs(this.spin) * 0.3;
    }
    const omega = dt > 0 ? (this.rot - prevRot) / dt : 0;
    const pos = (this.rot / TAU) * FPR;
    // the epsilon keeps rounding error from showing the frame before an exact position, such as the last one
    const frame = Math.floor(pos + 1e-6);
    const timecode = `00:${pad2(Math.floor(frame / 1440))}:${pad2(Math.floor(frame / 24) % 60)}:${pad2(frame % 24)}`;
    if (timecode !== this.lastTimecode) {
      this.lastTimecode = timecode;
      this.$(".tc").textContent = timecode;
      this.canvas.setAttribute("aria-valuenow", String(frame));
      this.canvas.setAttribute("aria-valuetext", timecode);
    }
    const rate = (Math.abs(omega) / TAU) * FPR / 24;
    const label = rate < 0.05 ? "Paused" : `${omega < 0 ? "Rewind" : "Scrub"} ${rate.toFixed(1)}×`;
    if (Math.abs(rate - this.lastRate) > 0.25 || (rate < 0.05) !== (this.lastRate < 0.05)) {
      this.lastRate = rate;
      rollText(this.$(".sp"), label, omega < 0 ? -1 : 1);
    }

    this.clear();
    const light = -2.3;
    for (let k = 0; k < 64; k++) {
      const a = (TAU * k) / 64 + this.rot;
      const lit = 0.35 + 0.35 * Math.cos(a - light);
      for (const r of [72, 77, 82]) this.dot(cx + Math.cos(a) * r - 1.2, cy + Math.sin(a) * r - 1.2, P.fg, lit, 2.4);
      // fast spins leave ghosted teeth behind
      if (rate > 1.2 && !still) {
        for (let ghost = 1; ghost <= 3; ghost++) {
          const ga = a - omega * dt * ghost * 0.6;
          this.dot(cx + Math.cos(ga) * 77 - 1.2, cy + Math.sin(ga) * 77 - 1.2, P.accent, 0.12 * (4 - ghost), 2.4);
        }
      }
    }
    for (let k = 0; k < 40; k++) {
      const a = (TAU * k) / 40;
      this.dot(cx + Math.cos(a) * 60 - 1, cy + Math.sin(a) * 60 - 1, P.fg, 0.14, 2);
    }
    for (let k = 0; k < 18; k++) {
      const a = (TAU * k) / 18 + this.rot;
      this.dot(cx + Math.cos(a) * 18 - 1.2, cy + Math.sin(a) * 18 - 1.2, P.fg, 0.4, 2.4);
    }
    const dimpleAngle = this.rot - Math.PI / 2;
    const dimpleColor = mix(P.accent, P.shine, Math.min(1, rate / 4));
    for (let yy = -1; yy <= 1; yy++) {
      for (let xx = -1; xx <= 1; xx++) {
        const x = cx + Math.cos(dimpleAngle) * 44 + xx * 4 - 1.6;
        const y = cy + Math.sin(dimpleAngle) * 44 + yy * 4 - 1.6;
        this.dot(x, y, dimpleColor, 1, 3.2);
      }
    }

    // film strip: one thumbnail per frame, a new shot every 36 frames
    const sy = 206;
    const fw = 34;
    const gap = 4;
    const step = fw + gap;
    const first = Math.floor(pos - w / step / 2) - 1;
    const last = Math.ceil(pos + w / step / 2) + 1;
    for (let n = first; n <= last; n++) {
      if (n < 0 || n > MAX_FRAME) continue;
      const x = cx + (n - pos) * step - fw / 2;
      if (x > w || x + fw < 0) continue;
      const shot = Math.floor(n / 36);
      const hue = [P.accent, P.ok, P.warn, P.danger, P.muted][shot % 5];
      const horizon = 10 + hash(shot * 3.1) * 12;
      const sun = (n % 36) / 36;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = css(P.fg);
      ctx.fillRect(x, sy, fw, 26);
      ctx.globalAlpha = 1;
      for (let yy = 0; yy < 26; yy += 3) {
        for (let xx = 0; xx < fw; xx += 3) {
          if (yy > horizon) this.dot(x + xx, sy + yy, hue, 0.45, 2.2);
        }
      }
      this.dot(x + 4 + sun * (fw - 10), sy + 4, P.shine, 0.9, 3);
      if (n % 24 === 0) {
        ctx.font = `9px ${this.mono}`;
        ctx.fillStyle = css(P.muted);
        ctx.textAlign = "left";
        ctx.globalAlpha = 0.9;
        ctx.fillText(`${Math.floor(n / 24)}s`, x, sy + 38);
        ctx.globalAlpha = 1;
      }
    }
    for (let y = sy - 6; y < sy + 32; y += 3) this.dot(cx - 1, y, P.danger, 1, 2);
    return this.dragAngle !== null || this.spin !== 0;
  }
}

define("px-jog", Jog);

export { Jog };

declare global {
  interface HTMLElementTagNameMap {
    "px-jog": Jog;
  }
}
