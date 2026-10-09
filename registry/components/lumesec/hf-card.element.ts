/**
 * <hf-card> · Media card
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/card
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-card.tsx.
 */
import {
  HF,
  bayer,
  clamp,
  define,
  escapeHtml,
  fbm,
  h2,
  hsl,
  mix,
  reduced,
  strHash,
  type Point,
  type RGB,
} from "@/lib/lumesec/pixel";

/** One ridge of the landscape. */
interface Layer {
  /** Parallax depth: 0.18 far to 1 near. */
  depth: number;
  col: RGB;
  /** Mean ridge height as a fraction of the canvas height from the top. */
  base: number;
  /** Ridge amplitude as a fraction of the canvas height. */
  amp: number;
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

/** Media card with a generated dithered landscape whose ridges shift at different depths as the card tilts. */
class HCard extends HF {
  static observedAttributes = ["tags", "alt", "hue", "seed"];

  /** Eased pointer position as 0–1 fractions of the card. */
  private readonly ptr: Point = [0.5, 0.5];
  /** Pointer position the eased one follows. */
  private tg: Point = [0.5, 0.5];
  /** Eased 0–1 hover amount. */
  private hov = 0;
  /** Whether the pointer is over the card. */
  private on = false;

  constructor() {
    super(
      `
      :host { display: block; perspective: 900px; }
      .c { position: relative; border: 1px solid var(--_border); border-radius: 16px; background: var(--_raised); overflow: hidden; transform-style: preserve-3d; transition: transform .5s cubic-bezier(.2,.8,.2,1), box-shadow .3s; }
      .c.on { transition: transform .08s linear, box-shadow .3s; box-shadow: 0 18px 40px rgba(0,0,0,.22); }
      canvas.px { display: block; width: 100%; height: 150px; }
      .b { padding: 14px 16px 16px; display: grid; gap: 6px; }
      .t { font-weight: 650; font-size: 15px; }
      .d { font-size: 13px; color: var(--_muted); line-height: 1.45; }
      .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
      .tags span { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 99px; background: var(--_track); color: var(--_muted); }
      @media (prefers-reduced-motion: reduce) { .c { transform: none !important; } }
      `,
      `<div class="c"><canvas class="px" role="img"></canvas><div class="b"><span class="t"><slot name="title">Pixel Valley</slot></span><span class="d"><slot>A generated landscape that drifts with your pointer. Every layer is a dithered noise ridge.</slot></span><div class="tags"></div></div></div>`,
      2,
      0.74,
    );
    const card = this.$(".c");
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      this.tg = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
      this.on = true;
      card.classList.add("on");
      if (!reduced()) {
        card.style.transform = `rotateX(${(0.5 - this.tg[1]) * 9}deg) rotateY(${(this.tg[0] - 0.5) * 11}deg)`;
      }
      this.kick();
    });
    card.addEventListener("pointerleave", () => {
      this.tg = [0.5, 0.5];
      this.on = false;
      card.classList.remove("on");
      card.style.transform = "";
      this.kick();
    });
  }

  attributeChangedCallback(name: string): void {
    if (name === "tags") this.renderTags();
    else if (name === "alt") this.renderAlt();
    // hue and seed are read while drawing
    else this.kick();
  }

  protected override init(): void {
    this.renderTags();
    this.renderAlt();
  }

  /** Tag chips from the comma-separated `tags`; an empty value shows none. */
  private renderTags(): void {
    this.$(".tags").innerHTML = (this.getAttribute("tags") ?? "Generative,Dither,Parallax")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `<span>${escapeHtml(s)}</span>`)
      .join("");
  }

  private renderAlt(): void {
    this.$("canvas").setAttribute("aria-label", this.getAttribute("alt") || "Pixel landscape illustration");
  }

  protected override render(t: number, dt: number): boolean {
    const F = this.F;
    const reducedMotion = reduced();
    const dark = this.dark;
    const C = F.cols;
    const R = F.rows;
    const seed = strHash(this.getAttribute("seed") || "valley") % 50;
    for (let k = 0; k < 2; k++) this.ptr[k] += (this.tg[k] - this.ptr[k]) * Math.min(1, dt * 7);
    this.hov += ((this.on ? 1 : 0) - this.hov) * Math.min(1, dt * 6);
    const px = this.ptr[0] - 0.5;
    const py = this.ptr[1] - 0.5;
    const drift = reducedMotion ? 0 : t * 0.02;
    const hue = this.num("hue", 262);
    const sky0 = hsl(hue + 20, 0.55, dark ? 0.16 : 0.9);
    const sky1 = hsl(hue - 30, 0.75, dark ? 0.55 : 0.72);
    const sun: Point = [C * (0.68 - px * 0.04), R * (0.42 - py * 0.05)];
    const layers: Layer[] = [0.18, 0.4, 0.7, 1].map((depth, L) => ({
      depth,
      col: hsl(hue + L * 14, 0.45 + L * 0.1, dark ? 0.46 - L * 0.1 : 0.8 - L * 0.15),
      base: 0.42 + L * 0.14,
      amp: 0.2 - L * 0.025,
    }));
    F.clear();
    for (let i = 0; i < C; i++) {
      // ridge height per layer in rows; nearer layers move further with the pointer
      const ridge = layers.map((ly) => {
        const x = (i / C) * 3 + px * ly.depth * 1.4 + drift * ly.depth + seed + ly.depth * 9;
        return (ly.base + ly.amp * (fbm(x, ly.depth * 4) - 0.5) * 2 - py * ly.depth * 0.06) * R;
      });
      for (let j = 0; j < R; j++) {
        const b = bayer(i, j);
        // top ridge line wins visually
        let q = layers.length - 1;
        while (q >= 0 && j < ridge[q]) q--;
        if (q >= 0) {
          const ly = layers[q];
          const v = (j - ridge[q]) / (R - ridge[q] + 1);
          const rim = j - ridge[q] < 1.2;
          const c = mix(ly.col, sky1, rim ? 0.45 : (1 - ly.depth) * 0.35);
          F.put(i, j, b < 0.75 - v * 0.4 ? c : mix(c, BLACK, dark ? 0.35 : 0.12), 1, rim ? 0.25 * (1 - q / 4) : 0);
          continue;
        }
        const ds = Math.hypot(i - sun[0], (j - sun[1]) * 1.1);
        const sunR = R * 0.13;
        if (ds < sunR) {
          F.put(i, j, mix(hsl(hue - 50, 0.9, dark ? 0.75 : 0.8), WHITE, (1 - ds / sunR) * 0.4), 1, 0.7);
          continue;
        }
        const v = j / R;
        const glow = Math.exp(-(ds * ds) / (R * R * 0.12));
        const sky = mix(sky0, sky1, clamp(v * 1.1 + glow * 0.5, 0, 1));
        // stars twinkle in the upper sky, dark theme only
        const twinkle = dark && v < 0.4 && h2(i, j) > 0.992 ? 0.6 + 0.4 * Math.sin(t * 3 + i) : 0;
        F.put(
          i,
          j,
          twinkle ? WHITE : sky,
          twinkle || (b < 0.55 + v * 0.45 + glow * 0.3 ? 1 : 0.75),
          twinkle ? 0.8 : glow * 0.2,
        );
      }
    }
    // pointer glare
    if (this.hov > 0.01) {
      const gx = this.ptr[0] * this.w;
      const gy = this.ptr[1] * (this.h + 120);
      for (let j = 0; j < R; j++) {
        for (let i = 0; i < C; i++) {
          const [x, y] = F.xy(i, j);
          const d = Math.hypot(x - gx, y - gy);
          if (d < 70 && h2(i, j) < (1 - d / 70) * 0.25 * this.hov) F.put(i, j, WHITE, 0.9, 0.6);
        }
      }
    }
    this.flush(0.7, 5);
    // the landscape drifts, so the card animates every frame unless motion is reduced
    return !reducedMotion;
  }
}

define("hf-card", HCard);

declare global {
  interface HTMLElementTagNameMap {
    "hf-card": HCard;
  }
}

export { HCard };
