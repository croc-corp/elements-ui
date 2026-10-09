/**
 * <hf-progress> · Progress
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/progress
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-progress.tsx.
 */
import { HF, clamp, define, fbm, mix, now, rand, reduced, rollText } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-progress>`. */
export interface HProgressEventMap {
  /** Fires when `value` reaches 100. Fires again only after the value drops below 100 and returns. */
  complete: CustomEvent<Record<string, never>>;
}

/** A bubble rising through the fluid; position as fractions of the bar, `s` its size and speed. */
interface Bubble {
  x: number;
  y: number;
  s: number;
}

/**
 * Progress bar drawn as a fluid with rising bubbles; at 100% the label rolls to its done text. Omit `value` for
 * indeterminate.
 */
class HProgress extends HF {
  static readonly observedAttributes = ["value", "label", "done-label"] as const;

  /** Eased fill fraction, 0 to 1. */
  private f = 0;
  /** Time the bar reached 100%; starts the done sweep. */
  private doneT = -9;
  private readonly bubbles: Bubble[] = Array.from({ length: 22 }, () => ({
    x: Math.random(),
    y: Math.random(),
    s: rand(0.3, 1),
  }));

  constructor() {
    super(
      `
      :host { display: block; }
      .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 10px; }
      .lab { font-size: 13px; font-weight: 500; }
      .pct { font-family: var(--_mono); font-size: 12.5px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      :host([data-done]) .pct { color: var(--_ok); }
      canvas.px { height: 30px; border-radius: 15px; }
      `,
      `<div class="head"><span class="rollslot lab"></span><span class="pct"></span></div><canvas class="px" role="progressbar" aria-valuemin="0" aria-valuemax="100"></canvas>`,
      2,
      0.72,
    );
  }

  /** `true` when there is no `value` attribute. */
  get indeterminate(): boolean {
    return !this.hasAttribute("value");
  }

  /** Clamped value. Setting `null` removes the attribute and makes the bar indeterminate. */
  get value(): number {
    return clamp(this.num("value", 0), 0, 100);
  }

  set value(value: number | null) {
    if (value == null) this.removeAttribute("value");
    else this.setAttribute("value", String(value));
  }

  protected override init(): void {
    this.apply(true);
  }

  attributeChangedCallback(): void {
    if (this.initialized) this.apply(false);
  }

  /**
   * Update the label, the percentage and the ARIA values; reaching 100 rolls in the done label and fires
   * `complete`.
   */
  private apply(first: boolean): void {
    const canvas = this.$("canvas");
    const label = this.getAttribute("label") || "Uploading";
    const indeterminate = this.indeterminate;
    const v = this.value;
    const done = !indeterminate && v >= 100;
    const wasDone = this.hasAttribute("data-done");
    canvas.setAttribute("aria-label", label);
    if (indeterminate) {
      canvas.removeAttribute("aria-valuenow");
      this.$(".pct").textContent = "";
    } else {
      canvas.setAttribute("aria-valuenow", String(Math.round(v)));
      this.$(".pct").textContent = `${Math.round(v)}%`;
      if (first) this.f = v / 100;
    }
    // the label rolls only when the done state flips; a new label text is swapped in place
    const text = done ? this.getAttribute("done-label") || "Complete" : label;
    rollText(this.$(".lab"), text, done ? 1 : -1, done !== wasDone && !first);
    if (done && !wasDone) {
      this.dataset.done = "";
      this.doneT = now();
      this.emit("complete");
    } else if (!done && wasDone) {
      delete this.dataset.done;
    }
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const w = this.w;
    const h = this.h;
    const r = h / 2;
    const indeterminate = this.indeterminate;
    const done = this.hasAttribute("data-done");
    const target = indeterminate ? 0 : this.value / 100;
    this.f = reducedMotion ? target : this.f + (target - this.f) * Math.min(1, dt * 5);
    const base = done ? P.ok : P.accent;
    const sweep = done ? (t - this.doneT) * 1.4 : -9;
    for (const b of this.bubbles) {
      b.y -= dt * 0.25 * b.s;
      b.x -= dt * 0.04 * b.s;
      if (b.y < 0) {
        b.y = 1;
        b.x = Math.random();
      }
      if (b.x < 0) b.x = 1;
    }
    F.clear();
    // centre of the blob that travels along an indeterminate bar
    const blob = indeterminate ? ((t * 0.45) % 1.4) - 0.2 : 0;
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        // pill-shaped bar
        const dx = x - clamp(x, r, w - r);
        if (Math.hypot(dx, y - r) > r - 0.5) continue;
        let inside: boolean;
        let edge: number;
        if (indeterminate) {
          const c = blob * w;
          const half = w * 0.14 + Math.sin(y * 0.4 + t * 6) * 2;
          inside = Math.abs(x - c) < half;
          edge = Math.max(0, 1 - Math.abs(Math.abs(x - c) - half) / 6);
        } else {
          // the fluid surface wobbles
          const wobble = reducedMotion ? 0 : Math.sin(y * 0.45 + t * 7) * 2.5 + (fbm(y * 0.15, t * 1.5) - 0.5) * 5;
          const fx = this.f * w + wobble;
          inside = x < fx;
          edge = Math.max(0, 1 - Math.abs(x - fx) / 7);
        }
        if (!inside) {
          F.put(i, j, P.fg, 0.1);
          continue;
        }
        const shade = 1 - (y / h) * 0.55;
        let light = 0.45 + shade * 0.4;
        let glow = edge * 0.7;
        for (const b of this.bubbles) {
          const bx = b.x * w;
          const by = b.y * h;
          if (Math.abs(x - bx) < 1.6 && Math.abs(y - by) < 1.6) {
            light += 0.5 * b.s;
            glow += 0.3;
          }
        }
        if (sweep > -9) {
          const k = Math.max(0, 1 - Math.abs(x / w - sweep) * 5);
          light += k * 0.4;
          glow += k * 0.6;
        }
        const col = mix(base, P.shine, clamp(edge * 0.5 + (light - 0.8) * 0.6, 0, 0.6));
        F.put(i, j, col, clamp(light, 0, 1), clamp(glow, 0, 1));
      }
    }
    this.flush(0.85, 5);
    return !reducedMotion;
  }
}

define("hf-progress", HProgress);

declare global {
  interface HTMLElementTagNameMap {
    "hf-progress": HProgress;
  }
}

export { HProgress };
