/**
 * <px-fader> · Fader & meter
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/fader
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-fader.tsx.
 *
 * Demo data: The meter signal is simulated; only the fader position is a real control. It cannot show your own
 * data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { PxBase, clamp, css, define, mix, rand, reduced } from "@/lib/lumesec/pixel";

/** Events fired by `<px-fader>`. */
export interface FaderEventMap {
  /**
   * Fires when a drag on the fader ends, on each handled key press and on the double-click snap to 0 dB. `db` is
   * the target level in decibels, `-Infinity` at the bottom, about +6 dB at the top.
   */
  change: CustomEvent<{ db: number }>;
}

/** Fader position (0 to 1) for a level in dB; the inverse of {@link Fader.db}. */
const dbToV = (db: number): number => Math.sqrt(Math.pow(10, db / 20) / 2);

/** Levels marked on the fader scale, in dB. */
const TICKS_DB = [6, 0, -6, -12, -24, -48];

/** Fader travel per key, as a fraction of the full travel. */
const KEY_STEPS: Partial<Record<string, number>> = {
  ArrowUp: 0.02,
  ArrowRight: 0.02,
  ArrowDown: -0.02,
  ArrowLeft: -0.02,
  PageUp: 0.1,
  PageDown: -0.1,
};

/** Meter height in px, and its number of segments. */
const METER_H = 190;
const SEGMENTS = 30;

/** Mixing-desk fader beside a stereo pixel meter with peak hold and a clip light. */
class Fader extends PxBase {
  /** Fader position from 0 to 1; the gain is `2v²`, so 0.707 is 0 dB. */
  private v = 0.72;
  /** Where the cap glides to after a track click, a key or the double-click snap. */
  private target = 0.72;
  private velocity = 0;
  private gliding = false;
  /** Active pointer drag; `offset` keeps the grab point on the cap. */
  private drag: { offset: number } | null = null;
  private muted = false;
  /** Mute fade, from 1 (live) to 0 (muted). */
  private live = 0;
  /** Displayed level per channel, as a fraction of the meter. */
  private readonly level: [number, number] = [0, 0];
  private readonly peak: [number, number] = [0, 0];
  private readonly peakAt: [number, number] = [0, 0];
  private readonly noise: [number, number] = [0, 0];
  /** Time the meter last clipped. */
  private clipAt = -9;
  private lastDbText = "";

  constructor() {
    super(
      `
      :host { display: block; }
      .mixer { display: flex; align-items: stretch; justify-content: center; gap: 18px; }
      canvas.px { width: 44px; height: 190px; }
      .fader { position: relative; width: 46px; height: 190px; touch-action: none; cursor: ns-resize; border-radius: 8px; }
      .slot { position: absolute; left: 50%; top: 10px; bottom: 10px; width: 4px; margin-left: -2px; border-radius: 2px; background: var(--_track); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_fg) 12%, transparent); }
      .ticks { position: absolute; left: 0; right: 0; top: 10px; bottom: 10px; pointer-events: none; }
      .ticks i { position: absolute; left: 6px; right: 6px; height: 1px; background: color-mix(in srgb, var(--_fg) 20%, transparent); }
      .ticks i.zero { background: color-mix(in srgb, var(--_fg) 45%, transparent); }
      .cap {
        position: absolute; left: 50%; top: 0; width: 40px; height: 22px; margin: -11px 0 0 -20px; border-radius: 5px;
        background: linear-gradient(var(--_raised), var(--_surface)); box-shadow: 0 3px 8px -2px rgba(0,0,0,.4), inset 0 0 0 1px var(--_border); will-change: transform;
      }
      .cap::after { content: ""; position: absolute; left: 6px; right: 6px; top: 50%; height: 2px; margin-top: -1px; border-radius: 1px; background: var(--_accent); }
      .side { display: grid; align-content: space-between; justify-items: start; padding-block: 2px; }
      .db { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; min-width: 3.4ch; }
      .unit { font-size: 11px; color: var(--_muted); font-family: var(--_mono); }
      .clip { font-family: var(--_mono); font-size: 10.5px; letter-spacing: .08em; padding: 2px 6px; border-radius: 4px; color: var(--_muted); background: var(--_track); transition: background-color .08s, color .08s; }
      :host([data-clip]) .clip { background: var(--_danger); color: #fff; }
      `,
      `<div class="mixer"><canvas class="px" role="img" aria-label="Stereo level meter"></canvas>
          <div class="fader" tabindex="0" role="slider" aria-label="Volume" aria-valuemin="0" aria-valuemax="100"><div class="ticks"></div><div class="slot"></div><div class="cap"></div></div>
          <div class="side"><span class="clip">CLIP</span><div><div class="db"></div><div class="unit">dB</div></div><button class="pbtn mute" type="button" aria-pressed="false">Mute</button></div></div>`,
    );
    const ticks = this.$(".ticks");
    for (const db of TICKS_DB) {
      const tick = document.createElement("i");
      tick.style.top = `${(1 - dbToV(db)) * 100}%`;
      if (db === 0) tick.className = "zero";
      ticks.appendChild(tick);
    }
    const fader = this.$(".fader");
    const at = (e: PointerEvent): number => {
      const r = fader.getBoundingClientRect();
      return clamp(1 - (e.clientY - r.top - 10) / (r.height - 20), 0, 1);
    };
    fader.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      // no focus() here: the browser focuses the fader itself, without a focus ring after mouse use
      fader.setPointerCapture(e.pointerId);
      const v = at(e);
      // grabbing the cap drags it from the grab point; pressing the track glides the cap there
      const onCap = Math.abs(v - this.v) < 0.07;
      this.drag = { offset: onCap ? this.v - v : 0 };
      if (onCap) {
        this.v = this.target = clamp(v + this.drag.offset, 0, 1);
      } else {
        this.target = v;
        this.gliding = true;
      }
      this.kick();
    });
    fader.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      this.gliding = false;
      this.v = this.target = clamp(at(e) + this.drag.offset, 0, 1);
      this.velocity = 0;
      this.kick();
    });
    const up = (): void => {
      if (!this.drag) return;
      this.drag = null;
      // report the target, so a quick click on the track does not report the level mid-glide
      this.reportChange();
    };
    fader.addEventListener("pointerup", up);
    fader.addEventListener("pointercancel", up);
    fader.addEventListener("keydown", (e) => {
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        this.glideTo(e.key === "End" ? 1 : 0);
        return;
      }
      const step = KEY_STEPS[e.key];
      if (step == null) return;
      e.preventDefault();
      this.glideTo(clamp(this.target + step, 0, 1));
    });
    fader.addEventListener("dblclick", () => this.glideTo(dbToV(0)));
    const mute = this.$(".mute");
    mute.addEventListener("click", () => {
      this.muted = !this.muted;
      mute.setAttribute("aria-pressed", String(this.muted));
    });
  }

  /** Returns the fader level in dB: of position `v` (0 to 1) when given, otherwise the current level. */
  db(v: number = this.v): number {
    const gain = v * v * 2;
    return gain <= 0.0005 ? -Infinity : 20 * Math.log10(gain);
  }

  /** Spring the cap to `target` and report the new level. */
  private glideTo(target: number): void {
    this.target = target;
    this.gliding = true;
    this.kick();
    this.reportChange();
  }

  /** Fire `change` with the target level; rounding noise around 0 dB is reported as 0. */
  private reportChange(): void {
    const db = this.db(this.target);
    this.emit<{ db: number }>("change", { db: Math.abs(db) < 1e-9 ? 0 : db });
  }

  /** Move the cap towards its target on a damped spring. */
  private glide(dt: number): void {
    if (reduced()) {
      this.v = this.target;
      this.gliding = false;
      return;
    }
    const stiffness = 260;
    const damping = 2 * Math.sqrt(stiffness) * 0.75;
    this.velocity += (stiffness * (this.target - this.v) - damping * this.velocity) * dt;
    this.v += this.velocity * dt;
    if (Math.abs(this.target - this.v) < 0.001 && Math.abs(this.velocity) < 0.01) {
      this.v = this.target;
      this.gliding = false;
    }
  }

  /** Update the cap position, the dB readout and the slider values. */
  private updateFader(): void {
    const fader = this.$(".fader");
    const travel = fader.clientHeight - 20;
    this.$(".cap").style.transform = `translateY(${10 + (1 - clamp(this.v, 0, 1)) * travel}px)`;
    const db = this.db();
    const text = db === -Infinity ? "−∞" : (db > 0 ? "+" : "") + db.toFixed(1);
    if (text !== this.lastDbText) {
      this.lastDbText = text;
      this.$(".db").textContent = text;
      fader.setAttribute("aria-valuenow", String(Math.round(this.v * 100)));
      fader.setAttribute("aria-valuetext", `${text} dB`);
    }
  }

  /** Advance channel `ch` of the simulated signal: its displayed level, peak hold and the clip light. */
  private sampleChannel(ch: number, t: number, dt: number, gain: number): void {
    // a kick every half second, a hi-hat tick and some noise; the right channel lags slightly
    const phase = t + ch * 0.013;
    this.noise[ch] += (rand(0, 1) - this.noise[ch]) * Math.min(1, dt * 20);
    const source =
      Math.exp(-(phase % 0.5) * 6) * 0.5 + ((phase * 4) % 1 < 0.12 ? 0.12 : 0) + this.noise[ch] * 0.22 + 0.08;
    const level = source * gain;
    // -48 dB to +6 dB across the meter
    const fraction = clamp((20 * Math.log10(Math.max(level, 1e-4)) + 48) / 54, 0, 1);
    this.level[ch] = Math.max(fraction, this.level[ch] - dt * 1.6);
    if (fraction >= this.peak[ch]) {
      this.peak[ch] = fraction;
      this.peakAt[ch] = t;
    } else if (t - this.peakAt[ch] > 0.7) {
      const fall = 0.15 + (t - this.peakAt[ch] - 0.7) * 1.4;
      this.peak[ch] = Math.max(0, this.peak[ch] - dt * fall);
    }
    if (fraction > 0.97) this.clipAt = t;
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    if (this.gliding) this.glide(dt);
    this.updateFader();
    this.live += ((this.muted ? 0 : 1) - this.live) * Math.min(1, dt * 10);
    const gain = this.v * this.v * 2 * this.live;
    this.clear();
    const segmentH = METER_H / SEGMENTS;
    for (let ch = 0; ch < 2; ch++) {
      this.sampleChannel(ch, t, dt, gain);
      const level = this.level[ch];
      const peak = this.peak[ch];
      const x = ch * 24;
      for (let s = 0; s < SEGMENTS; s++) {
        const u = (s + 0.5) / SEGMENTS;
        const y = METER_H - (s + 1) * segmentH;
        const zone = u >= 0.89 ? P.danger : u >= 0.78 ? P.warn : P.accent;
        const on = u <= level;
        const isPeak = Math.abs(u - peak) < 0.5 / SEGMENTS && peak > 0.02;
        g.globalAlpha = on ? 0.95 : isPeak ? 0.9 : u >= 0.78 ? 0.16 : 0.1;
        let color = u >= 0.78 ? zone : P.fg;
        if (on) color = mix(zone, P.shine, u > level - 1 / SEGMENTS ? 0.3 : 0);
        else if (isPeak) color = P.shine;
        g.fillStyle = css(color);
        g.fillRect(x, y + 0.9, 20, segmentH - 1.8);
      }
    }
    g.globalAlpha = 1;
    this.toggleAttribute("data-clip", t - this.clipAt < 0.9);
    return true;
  }
}

define("px-fader", Fader);

export { Fader };

declare global {
  interface HTMLElementTagNameMap {
    "px-fader": Fader;
  }
}
