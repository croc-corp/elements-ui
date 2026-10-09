/**
 * <px-diffusion> · Diffusion preview
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/diffusion
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-diffusion.tsx.
 *
 * Demo data: The prompts and images are painted procedurally and no model is involved; nothing can be set. It
 * cannot show your own data yet; use it as a template and replace the invented data before it shows anything
 * real.
 */
import {
  PxBase,
  checkRadio,
  define,
  hash,
  mix,
  now,
  radioKeys,
  reduced,
  rollText,
  type RGB,
} from "@/lib/lumesec/pixel";

const SCENES = ["Mountain dusk", "Moonlit sea", "Neon city"] as const;

/** A prompt of `<px-diffusion>`: the scene being generated. */
export type DiffusionPrompt = (typeof SCENES)[number];

/** Events fired by `<px-diffusion>`. */
export interface DiffusionEventMap {
  /**
   * Fires when a generation starts, including the automatic first one. `prompt` is `Mountain dusk`,
   * `Moonlit sea` or `Neon city`.
   */
  start: CustomEvent<{ prompt: DiffusionPrompt }>;
  /** Fires when the last denoising step completes. */
  done: CustomEvent<Record<string, never>>;
}

/** Image size in cells. */
const COLS = 60;
const ROWS = 40;
/** Number of denoising steps. */
const STEPS = 30;

/** A mountain ridge: top as a fraction of the height, colour and wave frequency. */
type Ridge = readonly [base: number, color: RGB, freq: number];

const RIDGES: readonly Ridge[] = [
  [0.42, [92, 46, 120], 4],
  [0.58, [58, 30, 92], 3],
  [0.74, [30, 18, 58], 2],
];

/**
 * Paint one of the demo scenes into an RGB buffer of `W`×`H` cells (three floats per cell). `seed` varies the
 * sun, moon, ridges, stars and skyline.
 */
function paintScene(kind: number, seed: number, W: number, H: number): Float32Array {
  const img = new Float32Array(W * H * 3);
  const set = (x: number, y: number, c: RGB): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    img[i] = c[0];
    img[i + 1] = c[1];
    img[i + 2] = c[2];
  };
  const rnd = (k: number): number => hash(seed * 13.7 + k * 3.1);
  if (kind === 0) {
    // mountain dusk: gradient sky, a glowing sun, three ridges
    const sx = 30 + rnd(1) * 22;
    const sy = 14 + rnd(2) * 6;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = y / H;
        let c = mix([42, 26, 94], [255, 138, 92], Math.pow(v, 1.3));
        const d = Math.hypot(x - sx, y - sy);
        if (d < 6) c = mix([255, 220, 140], [255, 196, 110], d / 6);
        else c = mix(c, [255, 190, 120], Math.max(0, 0.35 - d / 60));
        set(x, y, c);
      }
    }
    RIDGES.forEach(([base, color, freq], layer) => {
      for (let x = 0; x < W; x++) {
        const top =
          H * base +
          Math.sin((x * 0.11 * freq) / 2 + rnd(layer + 5) * 9) * 5 +
          Math.sin(x * 0.29 + rnd(layer + 9) * 6) * 2.5 +
          (hash(x * 1.3 + layer * 77 + seed) - 0.5) * 2;
        for (let y = Math.max(0, Math.floor(top)); y < H; y++) set(x, y, color);
      }
    });
  } else if (kind === 1) {
    // moonlit sea: starry sky, a moon and its broken reflection
    const mx = 10 + rnd(1) * 40;
    const my = 6 + rnd(2) * 5;
    const horizon = Math.floor(H * 0.58);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let c: RGB;
        if (y < horizon) {
          c = mix([10, 22, 58], [44, 76, 128], y / horizon);
          if (hash(x * 7.1 + y * 13.3 + seed) > 0.985) c = [230, 236, 255];
          const d = Math.hypot(x - mx, y - my);
          if (d < 4.2) c = [244, 241, 222];
          else c = mix(c, [120, 150, 200], Math.max(0, 0.3 - d / 40));
        } else {
          const depth = (y - horizon) / (H - horizon);
          c = mix([22, 44, 84], [8, 18, 40], depth);
          const reflection =
            Math.abs(x - mx) < 3 + (y - horizon) * 0.2 && hash(y * 3.3 + Math.floor(x / 2) + seed) > 0.35;
          if (reflection) c = mix(c, [230, 226, 200], 0.75 - depth * 0.5);
        }
        set(x, y, c);
      }
    }
  } else {
    // neon city: skyline with lit windows over a street
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) set(x, y, mix([18, 10, 42], [70, 22, 96], y / H));
    }
    let x = 0;
    let k = 0;
    while (x < W) {
      const bw = 4 + Math.floor(rnd(k) * 7);
      const bh = 10 + Math.floor(rnd(k + 50) * 20);
      const top = H - 6 - bh;
      for (let xx = x; xx < x + bw - 1; xx++) {
        for (let y = top; y < H - 6; y++) {
          let c: RGB = [26, 16, 48];
          const lit = (xx - x) % 2 === 1 && (y - top) % 3 === 1 && hash(xx * 3.7 + y * 1.9 + seed) > 0.45;
          if (lit) c = hash(xx + y * 9 + seed) > 0.5 ? [255, 207, 90] : [110, 240, 255];
          set(xx, y, c);
        }
      }
      x += bw;
      k++;
    }
    for (let y = H - 6; y < H; y++) {
      for (let xx = 0; xx < W; xx++) set(xx, y, hash(xx * 2.1 + y + seed) > 0.8 ? [110, 60, 140] : [14, 8, 30]);
    }
  }
  return img;
}

/**
 * Image preview that resolves the way diffusion models do: noise and large blocks sharpen over 30 steps into a scene,
 * different each variation.
 */
class Diffusion extends PxBase {
  /** Index of the scene in {@link SCENES}. */
  private kind = 0;
  private seed = 1;
  /** Denoising progress in steps, fractional. */
  private progress = STEPS;
  private running = false;
  /** Whether the first generation has started; it starts on the first frame with a size. */
  private started = false;
  /** Whether the status line has been shown once, so later updates roll. */
  private statusShown = false;
  private startTime = 0;
  /** Step number last written. */
  private lastStep = -1;
  private image: Float32Array = new Float32Array(0);
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
      .chips .pbtn { height: 26px; font-size: 12px; }
      .chips .pbtn[aria-checked="true"] { border-color: color-mix(in srgb, var(--_accent) 55%, var(--_border)); color: var(--_accent); }
      canvas.px { height: 160px; border-radius: 10px; }
      .bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; }
      .info { font-size: 12.5px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      .step { font-size: 11.5px; opacity: .8; margin-left: 6px; }
      `,
      `<div class="chips" role="radiogroup" aria-label="Prompt"></div><canvas class="px" role="img"></canvas><div class="bar"><span class="info"><span class="rollslot st" aria-live="polite"></span> <span class="mono step"></span></span><button class="pbtn gen" type="button">New variation</button></div>`,
    );
    SCENES.forEach((scene, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pbtn";
      button.textContent = scene;
      button.setAttribute("role", "radio");
      button.addEventListener("click", () => this.pick(i));
      this.$(".chips").appendChild(button);
    });
    radioKeys(
      this.$(".chips"),
      () => this.$$(".chips .pbtn"),
      () => this.kind,
      (index) => this.pick(index),
    );
    this.$(".gen").addEventListener("click", () => {
      this.seed++;
      this.run();
    });
  }

  protected override init(): void {
    this.image = paintScene(this.kind, this.seed, COLS, ROWS);
    this.progress = 0;
    this.started = false;
    this.syncChips();
    rollText(this.$(".st"), "Queued", 1, false);
  }

  private syncChips(): void {
    checkRadio(this.$$(".chips .pbtn"), this.kind);
  }

  /** Generate a new variation of scene `index`. */
  private pick(index: number): void {
    this.kind = index;
    this.seed++;
    this.run();
  }

  /** Paint a new image and denoise it from step 0. */
  private run(): void {
    const scene = SCENES[this.kind];
    this.image = paintScene(this.kind, this.seed, COLS, ROWS);
    this.progress = 0;
    this.startTime = now();
    this.running = true;
    this.started = true;
    this.syncChips();
    this.canvas.setAttribute("aria-label", `Generated image: ${scene}`);
    rollText(this.$(".st"), `Denoising · ${scene.toLowerCase()}`, 1, this.statusShown);
    this.statusShown = true;
    this.emit<{ prompt: DiffusionPrompt }>("start", { prompt: scene });
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    if (!this.started && this.w) this.run();
    const still = reduced();
    if (this.running) {
      this.progress = still ? STEPS : Math.min(STEPS, this.progress + dt * 15);
      const shownStep = Math.floor(this.progress);
      if (shownStep !== this.lastStep) {
        this.lastStep = shownStep;
        this.$(".step").textContent = `step ${shownStep}/${STEPS}`;
      }
      if (this.progress >= STEPS) {
        this.running = false;
        rollText(this.$(".st"), `Done in ${(t - this.startTime).toFixed(1)}s`, 1);
        this.emit("done");
      }
    }
    const done = this.progress / STEPS;
    const step = Math.floor(this.progress);
    // noise fades and the blocks shrink from 8 cells to 1 as the steps advance
    const sigma = Math.pow(1 - done, 1.6);
    const block = Math.max(1, Math.round(8 * Math.pow(1 - done, 2)));
    const cw = this.w / COLS;
    const ch = this.h / ROWS;
    const size = Math.min(cw, ch) * 0.86;
    const img = this.image;
    this.clear();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const qx = Math.min(COLS - 1, Math.floor(x / block) * block + (block >> 1));
        const qy = Math.min(ROWS - 1, Math.floor(y / block) * block + (block >> 1));
        const i = (qy * COLS + qx) * 3;
        let c: RGB = [img[i], img[i + 1], img[i + 2]];
        if (sigma > 0.002) {
          const n = hash(x * 12.9 + y * 78.2 + step * 3.7 + this.seed);
          const n2 = hash(x * 3.3 + y * 5.1 + step * 9.1);
          const noise: RGB = [n * 255, (n * 0.6 + n2 * 0.4) * 255, n2 * 255];
          c = mix(c, noise, sigma);
        }
        this.dot(x * cw + (cw - size) / 2, y * ch + (ch - size) / 2, c, 1, size);
      }
    }
    return this.running;
  }
}

define("px-diffusion", Diffusion);

export { Diffusion };

declare global {
  interface HTMLElementTagNameMap {
    "px-diffusion": Diffusion;
  }
}
