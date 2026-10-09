/**
 * <px-tuner> · Radio tuner
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/tuner
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-tuner.tsx.
 *
 * Demo data: The four radio stations are invented; nothing can be set. It cannot show your own data yet; use
 * it as a template and replace the invented data before it shows anything real.
 */
import { PxBase, clamp, css, define, hash, mix, reduced, rollText, rrect } from "@/lib/lumesec/pixel";

/** Events fired by `<px-tuner>`. */
export interface TunerEventMap {
  /** Fires each time the dial locks onto a station, with its name and frequency in MHz. */
  lock: CustomEvent<{ station: string; frequency: number }>;
}

/** A demo station on the dial. */
interface Station {
  /** Frequency in MHz. */
  freq: number;
  /** Name shown on the dial and sent with `lock`. */
  name: string;
  /** Name in the status line. */
  label: string;
}

const STATIONS: readonly Station[] = [
  { freq: 89.3, name: "LOFI BEATS", label: "Lofi Beats" },
  { freq: 94.7, name: "NEWS 24", label: "News 24" },
  { freq: 101.1, name: "OPUS FM", label: "Opus FM" },
  { freq: 105.5, name: "DEEP CUTS", label: "Deep Cuts" },
];

const FMIN = 87.5;
const FMAX = 108;

/** Where a drag started: pointer x and the frequency at that moment. */
interface DragStart {
  x: number;
  freq: number;
}

/**
 * FM radio tuner where static thins out near a station, a waveform appears and the name resolves on lock; release
 * nearby springs onto it.
 */
class Tuner extends PxBase {
  /** Current frequency in MHz. */
  private freq = 97.6;
  /** Station frequency the dial springs to, or null. */
  private targetFreq: number | null = null;
  /** Spring velocity in MHz/s. */
  private velocity = 0;
  private drag: DragStart | null = null;
  /** Name of the locked station, or null while searching. */
  private lockName: string | null = null;
  /** Last frequency text written to the readout. */
  private lastReadout = "";
  /** Font stacks for the canvas labels, read on layout. */
  private mono = "monospace";
  private sans = "sans-serif";
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      canvas.px { height: 176px; touch-action: none; cursor: ew-resize; border-radius: 10px; }
      .bar { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-top: 10px; }
      .fq { font-family: var(--_mono); font-size: 18px; font-weight: 500; font-variant-numeric: tabular-nums; }
      .st { font-size: 12.5px; color: var(--_muted); }
      :host([data-locked]) .st { color: var(--_accent); font-weight: 500; }
      `,
      `<canvas class="px" tabindex="0" role="slider" aria-label="Radio frequency" aria-valuemin="87.5" aria-valuemax="108"></canvas><div class="bar"><span class="fq"></span><span class="rollslot st" aria-live="polite"></span></div>`,
    );
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, freq: this.freq };
      this.targetFreq = null;
      this.kick();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const pxPerMHz = (canvas.clientWidth - 40) / (FMAX - FMIN);
      this.freq = clamp(this.drag.freq + (e.clientX - this.drag.x) / pxPerMHz, FMIN, FMAX);
      this.kick();
    });
    const up = (): void => {
      if (!this.drag) return;
      this.drag = null;
      this.settle();
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        this.targetFreq = null;
        const step = e.key === "ArrowRight" ? 0.1 : -0.1;
        this.freq = clamp(Math.round((this.freq + step) * 10) / 10, FMIN, FMAX);
        this.settle();
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        this.targetFreq = null;
        this.freq = e.key === "End" ? FMAX : FMIN;
        this.settle();
      }
      if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        const upward = e.key === "PageUp";
        const list = upward ? STATIONS : [...STATIONS].reverse();
        const next = list.find((s) => (upward ? s.freq > this.freq + 0.05 : s.freq < this.freq - 0.05)) || list[0];
        this.targetFreq = next.freq;
        this.kick();
      }
    });
  }

  protected override init(): void {
    rollText(this.$(".st"), "Searching…", 1, false);
  }

  protected override resized(): void {
    this.mono = this.monoFont;
    this.sans = getComputedStyle(this).fontFamily || "sans-serif";
  }

  /** Spring onto a station within 0.6 MHz. */
  private settle(): void {
    const near = STATIONS.find((s) => Math.abs(s.freq - this.freq) < 0.6);
    if (near) this.targetFreq = near.freq;
    this.kick();
  }

  /** Signal strength from 0 to 1: a narrow bell around each station. */
  private signal(): number {
    return Math.max(...STATIONS.map((s) => Math.exp(-(((this.freq - s.freq) / 0.22) ** 2))));
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const still = reduced();
    const w = this.w;
    if (this.targetFreq != null && !this.drag) {
      if (still) {
        this.freq = this.targetFreq;
        this.velocity = 0;
      } else {
        const stiffness = 90;
        const damping = 2 * Math.sqrt(stiffness) * 0.7;
        this.velocity += (stiffness * (this.targetFreq - this.freq) - damping * this.velocity) * dt;
        this.freq += this.velocity * dt;
      }
      if (Math.abs(this.targetFreq - this.freq) < 0.002 && Math.abs(this.velocity) < 0.01) {
        this.freq = this.targetFreq;
        this.targetFreq = null;
        this.velocity = 0;
      }
    }

    const sig = this.signal();
    const station = STATIONS.reduce((a, b) => (Math.abs(b.freq - this.freq) < Math.abs(a.freq - this.freq) ? b : a));
    const locked = sig > 0.9;
    const readout = `${this.freq.toFixed(1)} MHz`;
    if (readout !== this.lastReadout) {
      this.lastReadout = readout;
      this.$(".fq").textContent = readout;
      this.canvas.setAttribute("aria-valuenow", this.freq.toFixed(1));
      this.canvas.setAttribute("aria-valuetext", locked ? `${readout}, ${station.label}` : readout);
    }
    const name = locked ? station.name : null;
    if (name !== this.lockName) {
      this.lockName = name;
      this.toggleAttribute("data-locked", !!name);
      const text = name ? `Locked · ${station.label}` : "Searching…";
      rollText(this.$(".st"), text, name ? 1 : -1);
      if (name) this.emit<{ station: string; frequency: number }>("lock", { station: name, frequency: station.freq });
    }

    this.clear();
    const screenH = 92;
    const frame = Math.floor(t * 24);
    ctx.save();
    rrect(ctx, 0, 0, w, screenH, 10);
    ctx.clip();
    // static fades out as the signal comes in
    for (let y = 2; y < screenH; y += 4) {
      for (let x = 2; x < w; x += 4) {
        const n = hash(x * 3.7 + y * 17.1 + (still ? 0 : frame) * 0.913);
        const a = (1 - sig) * n * 0.75;
        if (a > 0.04) this.dot(x - 1.4, y - 1.4, P.fg, a, 2.8);
      }
    }
    if (sig > 0.05) {
      const fr = 0.04 + (station.freq % 7) * 0.006;
      for (let x = 2; x < w; x += 4) {
        // the waveform holds still under reduced motion
        const time = still ? 0 : t;
        const y = screenH / 2 + Math.sin(x * fr + time * 5) * Math.sin(x * fr * 0.31 + time) * 22 * sig;
        this.dot(x - 1.4, Math.round(y / 4) * 4 - 1.4, mix(P.accent, P.shine, 0.3), sig, 2.8);
      }
    }
    if (sig > 0.8) {
      ctx.globalAlpha = (sig - 0.8) / 0.2;
      ctx.fillStyle = css(P.fg);
      ctx.font = `600 13px ${this.sans}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(station.name, w / 2, 24);
      ctx.globalAlpha = 1;
    }
    for (let k = 0; k < 5; k++) {
      const on = k < Math.round(sig * 5);
      for (let r = 0; r <= k; r++)
        this.dot(w - 34 + k * 5, screenH - 10 - r * 4, on ? P.accent : P.fg, on ? 1 : 0.2, 3);
    }
    ctx.restore();

    const by = 128;
    const x0 = 20;
    const span = w - 40;
    const xOf = (f: number): number => x0 + ((f - FMIN) / (FMAX - FMIN)) * span;
    ctx.font = `10px ${this.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let f = 88; f <= 108; f += 0.5) {
      const major = f % 2 === 0;
      const x = xOf(f);
      this.dot(x - 1, by - (major ? 6 : 3), P.fg, major ? 0.55 : 0.25, 2);
      if (major) this.dot(x - 1, by - 3, P.fg, 0.55, 2);
      if (major && f % 4 === 0) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = css(P.muted);
        ctx.fillText(String(f), x, by + 16);
      }
    }
    for (const s of STATIONS) this.dot(xOf(s.freq) - 1.5, by - 14, P.accent, 0.9, 3);
    const needleX = xOf(this.freq);
    for (let y = by - 26; y <= by + 4; y += 3) this.dot(needleX - 1.5, y, locked ? P.accent : P.danger, 1, 3);
    ctx.globalAlpha = 1;
    // static and waveform animate; under reduced motion only a drag or the jump onto a station needs frames
    return !still || this.drag !== null || this.targetFreq !== null;
  }
}

define("px-tuner", Tuner);

export { Tuner };

declare global {
  interface HTMLElementTagNameMap {
    "px-tuner": Tuner;
  }
}
