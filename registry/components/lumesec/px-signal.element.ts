/**
 * <px-signal> · Latency scope
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/signal
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-signal.tsx.
 *
 * Demo data: The latency samples, spikes and p50/p95 readout are simulated; nothing can be set. It cannot show
 * your own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { PxBase, clamp, css, define, hash, mix, rand, reduced, rollText } from "@/lib/lumesec/pixel";

/** Events fired by `<px-signal>`. */
export interface SignalEventMap {
  /** Fires when the "Simulate outage" button is pressed. */
  outage: CustomEvent<Record<string, never>>;
}

/** One latency sample. */
interface LatencySample {
  /** Latency in ms. */
  v: number;
  /** Sequence number; seeds the dithered tail so it stays put while the trace scrolls. */
  id: number;
}

/** The sample under the pointer. */
interface HoveredSample {
  x: number;
  v: number;
  /** Seconds since the sample was taken. */
  age: number;
}

/** Horizontal distance between samples in px. */
const PITCH = 4;
/** Seconds between samples. */
const INTERVAL = 0.12;

/** Scrolling pixel oscilloscope for latency with a rolling p50/p95 readout. */
class Signal extends PxBase {
  private samples: LatencySample[] = [];
  private seq = 0;
  /** Random walk around the 160 ms baseline. */
  private walk = 0;
  /** Decaying spike added on top of the walk. */
  private spike = 0;
  /** End of the simulated outage; the initial history is sampled at a negative time, so this starts lower. */
  private outageUntil = -Infinity;
  /** Time of the last sample. */
  private lastSampleAt = 0;
  /** Pointer x over the canvas; null when the pointer is outside. */
  private mouseX: number | null = null;
  /** Samples taken; the readout updates every fourth. */
  private sampleCount = 0;
  /** Last value shown in the readout; 0 before the first. */
  private lastValue = 0;
  /** Monospace font stack for the threshold label, read on layout. */
  private mono = "monospace";

  constructor() {
    super(
      `
      :host { display: block; position: relative; }
      .pbtn[aria-disabled="true"] { opacity: .45; pointer-events: none; }
      .head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      .now { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .chip { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 5px; background: color-mix(in srgb, var(--_danger) 18%, transparent); color: var(--_danger); }
      .p50 { font-family: var(--_mono); font-size: 12px; color: var(--_muted); margin-left: auto; }
      canvas.px { height: 106px; cursor: crosshair; }
      .bar { display: flex; justify-content: flex-end; margin-top: 10px; }
      .tip { position: absolute; pointer-events: none; padding: 4px 8px; border-radius: 6px; background: var(--_fg); color: var(--_surface); font-size: 11.5px; white-space: nowrap; transform: translate(-50%, calc(-100% - 6px)); z-index: 3; }
      `,
      `<div class="head"><span class="lab">Latency</span><span class="rollslot now"></span><span class="chip" hidden>Spike</span><span class="p50"></span></div>
        <canvas class="px" role="img" aria-label="Live latency chart"></canvas><div class="tip" hidden></div>
        <div class="bar"><button class="pbtn out" type="button">Simulate outage</button></div>`,
    );
    const button = this.$<HTMLButtonElement>(".out");
    button.addEventListener("click", () => {
      // aria-disabled rather than disabled, so a keyboard user keeps focus on the button
      if (button.getAttribute("aria-disabled") === "true") return;
      this.outageUntil = this.t + 3;
      button.setAttribute("aria-disabled", "true");
      setTimeout(() => button.removeAttribute("aria-disabled"), 4200);
      this.emit("outage");
    });
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.mouseX = null;
      this.$(".tip").hidden = true;
    });
  }

  protected override resized(): void {
    this.mono = this.monoFont;
  }

  /** Simulated latency at time `t`: a random walk with occasional spikes, or an outage. */
  private sample(t: number): LatencySample {
    this.walk += rand(-1, 1) * 12 - this.walk * 0.08;
    if (this.spike <= 1 && Math.random() < 0.012) this.spike = rand(280, 520);
    this.spike *= 0.7;
    let v = 160 + this.walk + rand(-12, 12) + this.spike;
    if (t < this.outageUntil) v = rand(820, 1300);
    return { v: Math.max(20, v), id: this.seq++ };
  }

  /** Update the current value, the Spike chip and the percentiles. */
  private updateReadout(): void {
    const v = Math.round(this.samples[this.samples.length - 1].v);
    rollText(this.$(".now"), `${v} ms`, v >= this.lastValue ? 1 : -1, !!this.lastValue);
    this.lastValue = v;
    const sorted = this.samples.map((s) => s.v).sort((a, b) => a - b);
    const p50 = Math.round(sorted[sorted.length >> 1]);
    const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)]);
    this.$(".p50").textContent = `p50 ${p50} ms · p95 ${p95} ms`;
    this.$(".chip").hidden = v < 600;
  }

  protected override render(t: number): boolean {
    const g = this.ctx;
    const canvas = this.cv;
    if (!g || !canvas) return false;
    const P = this.P;
    const { w, h } = this;
    const capacity = Math.floor(w / PITCH) + 2;
    if (!this.samples.length) {
      for (let i = 0; i < capacity; i++) this.samples.push(this.sample(-9));
      this.lastSampleAt = t;
    }
    while (t - this.lastSampleAt >= INTERVAL) {
      this.lastSampleAt += INTERVAL;
      this.samples.push(this.sample(this.lastSampleAt));
      if (this.samples.length > capacity) this.samples.splice(0, this.samples.length - capacity);
      if (++this.sampleCount % 4 === 0) this.updateReadout();
    }
    // after a pause off screen, resume from now instead of catching up
    if (t - this.lastSampleAt > 1) this.lastSampleAt = t;
    const frac = reduced() ? 0 : (t - this.lastSampleAt) / INTERVAL;
    const yOf = (v: number): number => h - 5 - clamp(v / 1000, 0, 1) * (h - 12);

    this.clear();
    const thresholdY = yOf(400);
    for (let x = 2; x < w; x += 8) this.dot(x, thresholdY, P.warn, 0.4, 2);
    g.font = `10px ${this.mono}`;
    g.fillStyle = css(P.warn);
    g.globalAlpha = 0.8;
    g.textAlign = "right";
    g.fillText("400 ms", w - 4, thresholdY - 5);
    g.globalAlpha = 1;

    let hovered: HoveredSample | null = null;
    const last = this.samples.length - 1;
    for (let k = 0; k < this.samples.length; k++) {
      const sample = this.samples[k];
      const x = w - (last - k) * PITCH - frac * PITCH - 3;
      if (x < -3) continue;
      const y = yOf(sample.v);
      const color = sample.v > 600 ? P.danger : sample.v > 350 ? P.warn : P.accent;
      const near = this.mouseX != null && Math.abs(x + 1 - this.mouseX) < PITCH / 2;
      if (near) {
        hovered = { x, v: sample.v, age: (last - k) * INTERVAL };
        for (let yy = 4; yy < h; yy += 4) this.dot(x, yy, P.fg, 0.12, 2.4);
      }
      // dithered tail that thins out towards the bottom
      for (let yy = y + 4; yy < h - 2; yy += 4) {
        const depth = (yy - y) / (h - y);
        if (hash(sample.id * 7.3 + yy * 1.9) < 0.75 - depth * 0.85) this.dot(x, yy, color, 0.28 - depth * 0.2, 2.4);
      }
      this.dot(x - 0.3, y - 0.3, mix(color, P.shine, near ? 0.6 : 0.2), 1, 3);
    }

    const tip = this.$(".tip");
    if (hovered) {
      tip.hidden = false;
      tip.textContent = `${Math.round(hovered.v)} ms · ${hovered.age < 0.2 ? "now" : `${hovered.age.toFixed(1)}s ago`}`;
      tip.style.left = `${clamp(hovered.x, 50, w - 50)}px`;
      tip.style.top = `${canvas.offsetTop + yOf(hovered.v)}px`;
    } else {
      tip.hidden = true;
    }
    return true;
  }
}

define("px-signal", Signal);

export { Signal };

declare global {
  interface HTMLElementTagNameMap {
    "px-signal": Signal;
  }
}
