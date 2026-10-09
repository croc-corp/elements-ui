/**
 * <hf-carousel> · Carousel
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/carousel
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-carousel.tsx.
 *
 * Demo data: The four slides, generated scenes with built-in captions, cannot be replaced; nothing can be set.
 * It cannot show your own data yet; use it as a template and replace the invented data before it shows
 * anything real.
 */
import { HF, bayer, clamp, define, fbm, h2, hash, mix, now, reduced, rollText, type RGB } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-carousel>`. */
export interface HCarouselEventMap {
  /** The slide changed, by user action or autoplay. `index` is zero-based. */
  change: CustomEvent<{ index: number }>;
}

/** A slide: title and caption. */
interface Scene {
  t: string;
  d: string;
}

const SCENES: readonly Scene[] = [
  { t: "Aurora over the ridge", d: "fbm bands, star field, silhouette" },
  { t: "Harbour at dusk", d: "sun disc and shimmering reflections" },
  { t: "Pixel dunes", d: "layered sine ridges in warm dither" },
  { t: "Night city", d: "towers with windows that switch on and off" },
];

/** Colour and opacity of one cell. */
type Shade = [color: RGB, alpha: number];

/**
 * Paints one cell of a scene: `u` and `v` are the cell position in `[0, 1)`, `t` the time (0 under reduced
 * motion), `i` and `j` the cell, `b` its ordered-dither threshold.
 */
type ScenePainter = (u: number, v: number, t: number, i: number, j: number, b: number) => Shade;

const WHITE: RGB = [255, 255, 255];

/** fbm bands, star field, silhouette. */
const aurora: ScenePainter = (u, v, t, i, j, b) => {
  const ridge = 0.78 - 0.12 * fbm(u * 3, 1.2);
  if (v > ridge) return [[14, 16, 30], 1];
  const sky = mix([10, 12, 34], [40, 30, 90], v);
  // a wavy aurora band around v = 0.32
  const offset = v - 0.32 - 0.12 * Math.sin(u * 5 + t * 0.4) - 0.08 * fbm(u * 4 - t * 0.2, 2);
  const band = Math.exp(-(offset ** 2) / 0.006);
  if (h2(i, j) > 0.993 && v < 0.6) return [WHITE, 0.7 + 0.3 * Math.sin(t * 3 + i)];
  if (b < band * (0.6 + 0.4 * fbm(u * 8 + t * 0.3, v * 4))) return [mix([80, 240, 170], [170, 120, 255], v * 1.6), 1];
  return [sky, 1];
};

/** Sun disc and shimmering reflections. */
const harbour: ScenePainter = (u, v, t, _i, _j, b) => {
  const horizon = 0.6;
  const sun = Math.hypot((u - 0.62) * 1.8, v - 0.45);
  if (v < horizon) {
    if (sun < 0.12) return [mix([255, 230, 160], [255, 255, 230], 1 - sun / 0.12), 1];
    const g = v / horizon;
    return [b < 0.5 + 0.5 * g ? mix([250, 120, 90], [255, 190, 120], g) : mix([90, 60, 140], [250, 120, 90], g), 1];
  }
  const w = (v - horizon) / (1 - horizon);
  const reflection = Math.abs(u - 0.62) < 0.08 * (1 - w * 0.4) && Math.sin(v * 90 + t * 3 + u * 10) > 0.2;
  if (reflection) return [[255, 210, 150], 1];
  return [mix([60, 50, 110], [20, 24, 60], w), b < 0.75 ? 1 : 0.7];
};

/** Layered sine ridges in warm dither. */
const dunes: ScenePainter = (u, v, t, _i, _j, b) => {
  const layers = [0.55, 0.68, 0.82];
  for (let q = 2; q >= 0; q--) {
    const y = layers[q] + 0.05 * Math.sin(u * (6 + q * 3) + q * 2 + t * 0.15 * (q + 1));
    if (v > y) {
      // farther ridges are lighter; each darkens below its crest
      const shade = (v - y) * 8;
      const color = mix([235, 160, 90], [150, 70, 50], clamp(q * 0.3 + shade * 0.2, 0, 1));
      return [color, b < 0.85 - shade * 0.2 ? 1 : 0.75];
    }
  }
  return [mix([255, 220, 170], [250, 150, 110], v * 1.6), b < 0.6 + v ? 1 : 0.85];
};

/** Towers with windows that switch on and off. */
const city: ScenePainter = (u, v, t, i, j, b) => {
  const cols = 14;
  const height = 0.35 + 0.45 * hash(Math.floor(u * cols) * 3.1);
  if (v > 1 - height && (u * cols) % 1 > 0.08) {
    const wx = Math.floor(u * cols * 4);
    const wy = Math.floor(v * 40);
    const lit =
      hash(wx * 7.7 + wy * 1.3 + Math.floor(t * 0.5 + hash(wx + wy) * 10)) > 0.62 &&
      (u * cols * 4) % 1 > 0.35 &&
      (v * 40) % 1 > 0.4;
    return [lit ? [255, 214, 120] : [24, 22, 44], 1];
  }
  if (h2(i, j) > 0.995) return [WHITE, 0.8];
  return [mix([16, 14, 40], [60, 40, 110], v), b < 0.8 ? 1 : 0.7];
};

const PAINTERS: readonly ScenePainter[] = [aurora, harbour, dunes, city];

const PAUSE_SVG =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M4.5 2.5v9M9.5 2.5v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const PLAY_SVG =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M4.5 2.5l7 4.5-7 4.5z" fill="currentColor"/></svg>';

/** Carousel of four procedural pixel scenes with an ordered-dither dissolve between slides. */
class HCarousel extends HF {
  static observedAttributes = ["autoplay"];

  private index = 0;
  private prev = 0;
  /** Start of the last transition. */
  private t0 = -9;
  /** Direction of the last change: 1 forward, -1 back. */
  private dirn = 1;
  /** Autoplay pauses while the slide area is hovered or focused. */
  private paused = false;
  /** Autoplay was stopped with the rotation button; it stays stopped until started again. */
  private stopped = false;
  /** Autoplay progress towards the next slide, 0..1. */
  private progress = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      .w { position: relative; border-radius: 14px; overflow: hidden; touch-action: pan-y; outline: none; background: #0d0c12; }
      .w:focus-visible { box-shadow: 0 0 0 2px var(--_accent); }
      canvas.px { height: 210px; }
      .cap { position: absolute; left: 14px; bottom: 16px; right: 110px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
      .cap b { display: grid; font-size: 15px; font-weight: 650; }
      .cap span { font-size: 12px; opacity: .85; }
      :host([autoplay]) .cap { right: 150px; }
      .nav { position: absolute; right: 10px; bottom: 12px; display: flex; gap: 6px; }
      .nav button { width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(10,10,20,.55); color: #fff; cursor: pointer; display: grid; place-items: center; backdrop-filter: blur(4px); }
      .nav button:focus-visible { outline: 2px solid #fff; }
      .dots { display: flex; justify-content: center; gap: 6px; margin-top: 10px; }
      .dots button { width: 22px; height: 6px; border-radius: 3px; border: 0; padding: 0; background: var(--_track); cursor: pointer; transition: background .2s, width .25s; }
      .dots button[aria-current="true"] { background: var(--_accent); width: 34px; }
      `,
      `<div class="w" tabindex="0" role="region" aria-roledescription="carousel" aria-label="Pixel scenes"><canvas class="px" role="img"></canvas><div class="cap" aria-live="polite"><b class="rollslot ct"></b><span class="cd"></span></div><div class="nav"><button type="button" class="pp" hidden></button><button type="button" class="pv" aria-label="Previous slide"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2L4 7l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="nx" aria-label="Next slide"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div><div class="dots">${SCENES.map((s, k) => `<button type="button" aria-label="Slide ${k + 1}: ${s.t}"></button>`).join("")}</div>`,
      2.5,
      0.74,
    );
    this.$(".pp").addEventListener("click", () => {
      this.stopped = !this.stopped;
      this.syncRotation();
    });
    this.$(".pv").addEventListener("click", () => this.go(this.index - 1));
    this.$(".nx").addEventListener("click", () => this.go(this.index + 1));
    this.$$(".dots button").forEach((button, k) => button.addEventListener("click", () => this.go(k)));
    const area = this.$(".w");
    area.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") this.go(this.index - 1);
      if (e.key === "ArrowRight") this.go(this.index + 1);
    });
    area.addEventListener("pointerenter", () => {
      this.paused = true;
    });
    area.addEventListener("pointerleave", () => {
      this.paused = false;
    });
    area.addEventListener("focusin", () => {
      this.paused = true;
    });
    area.addEventListener("focusout", () => {
      this.paused = false;
    });
    // a horizontal swipe of more than 40px changes the slide
    let swipeX: number | null = null;
    area.addEventListener("pointerdown", (e) => {
      if (e.target instanceof Element && e.target.closest("button")) return;
      swipeX = e.clientX;
    });
    area.addEventListener("pointerup", (e) => {
      if (swipeX == null) return;
      const d = e.clientX - swipeX;
      swipeX = null;
      if (Math.abs(d) > 40) this.go(this.index + (d < 0 ? 1 : -1));
    });
  }

  attributeChangedCallback(): void {
    this.syncRotation();
  }

  protected override init(): void {
    this.sync(false);
    this.syncRotation();
  }

  /** Shows the slide at `index`; values outside 0–3 wrap around. */
  go(index: number): void {
    this.show(index, true);
  }

  /**
   * Show slide `index` (wrapping). The dissolve comes from the side the request points to, so Next on the last
   * slide still moves forward. `announce` is false for autoplay: a rotating caption is not read out.
   */
  private show(index: number, announce: boolean): void {
    const n = SCENES.length;
    const k = ((index % n) + n) % n;
    if (k === this.index) return;
    this.dirn = index > this.index ? 1 : -1;
    this.prev = this.index;
    this.index = k;
    this.t0 = now();
    this.progress = 0;
    this.$(".cap").setAttribute("aria-live", announce ? "polite" : "off");
    this.sync(true);
    this.emit<{ index: number }>("change", { index: k });
    this.kick();
  }

  /** Show the rotation button while `autoplay` is set, labelled for what pressing it does. */
  private syncRotation(): void {
    const button = this.$(".pp");
    button.hidden = !this.hasAttribute("autoplay");
    button.innerHTML = this.stopped ? PLAY_SVG : PAUSE_SVG;
    button.setAttribute("aria-label", this.stopped ? "Start autoplay" : "Stop autoplay");
  }

  /** Update the caption, the dots and the canvas label for the current slide. */
  private sync(anim: boolean): void {
    const scene = SCENES[this.index];
    rollText(this.$(".ct"), scene.t, this.dirn, anim);
    this.$(".cd").textContent = scene.d;
    this.$$(".dots button").forEach((button, i) => button.setAttribute("aria-current", String(i === this.index)));
    this.$("canvas").setAttribute("aria-label", `Slide ${this.index + 1} of ${SCENES.length}: ${scene.t}`);
  }

  protected override render(t: number, dt: number): boolean {
    const F = this.F;
    const R0 = reduced();
    const C = F.cols;
    const R = F.rows;
    const e = R0 ? 1 : clamp((t - this.t0) / 0.7, 0, 1);
    // scenes are static under reduced motion
    const sceneTime = R0 ? 0 : t;
    if (!this.paused && !this.stopped && !R0 && this.hasAttribute("autoplay")) {
      this.progress += dt / 5;
      if (this.progress >= 1) this.show(this.index + 1, false);
    }
    F.clear();
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const u = i / C;
        const v = j / R;
        // the new slide dissolves in from the side it came from, through the dither pattern
        const s = this.dirn > 0 ? u : 1 - u;
        const b = bayer(i, j);
        const threshold = e * 1.35 - s * 0.35 - b * 0.3;
        const useNew = e >= 1 || threshold > 0;
        const [c, a] = PAINTERS[useNew ? this.index : this.prev](u, v, sceneTime, i, j, b);
        const front = e < 1 && threshold > 0 && threshold < 0.08;
        F.put(i, j, front ? WHITE : c, a, front ? 0.9 : 0);
      }
    }
    // autoplay progress line
    if (this.hasAttribute("autoplay")) {
      for (let i = 0; i < C * this.progress; i++) F.put(i, R - 1, WHITE, 0.85, 0.4);
    }
    this.flush(this.dark ? 0.7 : 0.5, 5);
    return !R0;
  }
}

define("hf-carousel", HCarousel);

export { HCarousel };

declare global {
  interface HTMLElementTagNameMap {
    "hf-carousel": HCarousel;
  }
}
