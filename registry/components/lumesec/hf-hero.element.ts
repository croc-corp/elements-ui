/**
 * <hf-hero> · Hero
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/hero
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-hero.tsx.
 */
import {
  HF,
  bayer,
  clamp,
  define,
  fbm,
  h2,
  localPoint,
  mix,
  now,
  reduced,
  rrSdf,
  type Point,
  type RGB,
} from "@/lib/lumesec/pixel";

// elements rendered inside this one
import "@/components/lumesec/hf-button.element";

/** Events fired by `<hf-hero>`. */
export interface HHeroEventMap {
  /** Fires when the primary button is clicked. */
  primary: CustomEvent<Record<string, never>>;
  /** Fires when the secondary button is clicked. */
  secondary: CustomEvent<Record<string, never>>;
}

/** A click shockwave: its origin in canvas pixels and start time. */
interface Shock {
  x: number;
  y: number;
  t0: number;
}

const WHITE: RGB = [255, 255, 255];

/** Seconds a shockwave runs. */
const SHOCK_LIFE = 1.2;

/** Distance in CSS pixels over which the field fades in around the headline. */
const CLEARING = 22;

/**
 * Hero section whose headline sits in a dot grid: it is revealed behind a bright front, the pointer pushes the dots
 * aside and a click sends a shockwave through them.
 */
class HHero extends HF {
  static observedAttributes = ["headline", "primary", "secondary"];

  /** Pointer position in canvas pixels; null when it is outside. */
  private ptr: Point | null = null;
  /** Eased 0–1 pointer presence. */
  private pv = 0;
  /** Time the headline started to reveal. */
  private t0 = 0;
  private shock: Shock | null = null;

  constructor() {
    super(
      `
      :host { display: block; text-align: center; }
      .eb { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 99px; background: color-mix(in srgb, var(--_accent) 13%, transparent); color: var(--_accent); }
      .stage { position: relative; display: grid; place-items: center; min-height: 128px; margin: 10px 0 6px; padding: 18px 0; container-type: inline-size; touch-action: pan-y; }
      .stage canvas.px { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
      h2 {
        position: relative; margin: 0; max-width: 100%; padding: 0 4px; color: var(--_fg);
        font: 700 clamp(28px, 10cqi, 60px)/1.04 var(--_font); letter-spacing: -.03em; text-wrap: balance; overflow-wrap: break-word;
      }
      .sub { max-width: 46ch; margin: 0 auto 18px; font-size: 14.5px; line-height: 1.5; color: var(--_muted); }
      .cta { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; align-items: center; }
      .sec { border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); border-radius: 12px; height: 48px; padding: 0 20px; font: 600 14px var(--_font); cursor: pointer; }
      .sec:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
      `,
      `<span class="eb"><slot name="eyebrow">New · Pixel HD</slot></span><div class="stage"><canvas class="px" aria-hidden="true"></canvas><h2></h2></div><p class="sub"><slot>Thirty controls where every state change is drawn in light. Move your pointer through the headline.</slot></p>
        <div class="cta"><hf-button class="pri"></hf-button><button class="sec" type="button"></button></div>`,
      2.5,
      0.7,
    );
    const stage = this.$(".stage");
    const canvas = this.$("canvas");
    stage.addEventListener("pointermove", (e) => {
      this.ptr = localPoint(canvas, e);
      this.kick();
    });
    stage.addEventListener("pointerleave", () => {
      this.ptr = null;
      this.kick();
    });
    stage.addEventListener("pointerdown", (e) => {
      const [x, y] = localPoint(canvas, e);
      this.shock = { x, y, t0: now() };
      this.kick();
    });
  }

  /** The headline text. */
  get headline(): string {
    return this.getAttribute("headline") || "Think in pixels.";
  }

  attributeChangedCallback(): void {
    // before the first connect, init() reads every attribute
    if (!this.initialized) return;
    this.renderText();
    this.kick();
  }

  protected override init(): void {
    this.renderText();
    const primary = this.$("hf-button");
    const secondary = this.$(".sec");
    primary.addEventListener("click", () => this.emit("primary"));
    secondary.addEventListener("click", () => this.emit("secondary"));
    this.t0 = now();
    // hidden until the first frame starts the reveal, so the headline does not flash in
    if (!reduced()) this.$("h2").style.clipPath = "inset(0 100% 0 0)";
  }

  private renderText(): void {
    this.$("h2").textContent = this.headline;
    const primary = this.$("hf-button");
    primary.textContent = this.getAttribute("primary") || "Get started";
    // the inner button picks up text changes on its own, a moment later; read it now so it never shows stale text
    if (primary.initialized) primary.init();
    this.$(".sec").textContent = this.getAttribute("secondary") || "View components";
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const C = F.cols;
    const R = F.rows;
    const W = this.w;
    this.pv += ((this.ptr ? 1 : 0) - this.pv) * Math.min(1, dt * 6);
    const heading = this.$("h2");
    // the headline's box in canvas pixels; the field clears around it so the text stays legible
    const bx = heading.offsetLeft + heading.offsetWidth / 2;
    const by = heading.offsetTop + heading.offsetHeight / 2;
    const bw = heading.offsetWidth / 2;
    const bh = heading.offsetHeight / 2;
    // reveal from the left behind a ragged, bright front
    const intro = reducedMotion ? 2 : (t - this.t0) * 1.3;
    const frontU = intro * 1.2 - 0.1;
    const revealX = frontU * W - heading.offsetLeft;
    const clip = revealX < heading.offsetWidth ? `inset(0 ${heading.offsetWidth - Math.max(0, revealX)}px 0 0)` : "";
    if (heading.style.clipPath !== clip) heading.style.clipPath = clip;
    const shockAge = this.shock && !reducedMotion ? t - this.shock.t0 : 9;
    if (shockAge > SHOCK_LIFE) this.shock = null;
    const shock = this.shock;
    const ptr = this.ptr;
    F.clear();
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const [x, y] = F.xy(i, j);
        const u = i / C;
        const v = j / R;
        // print in from the left
        if (u > intro * 1.2 - h2(i, j) * 0.2) continue;
        const front = Math.exp(-(((u - frontU) * 14) ** 2));
        let ox = 0;
        let oy = 0;
        let hot = 0;
        if (ptr && this.pv > 0.01) {
          const dx = x - ptr[0];
          const dy = y - ptr[1];
          const d = Math.hypot(dx, dy) + 0.01;
          const f = Math.exp(-(d * d) / 1400) * this.pv;
          ox += (dx / d) * f * 16;
          oy += (dy / d) * f * 16;
          hot = f;
        }
        if (shock) {
          const dx = x - shock.x;
          const dy = y - shock.y;
          const d = Math.hypot(dx, dy) + 0.01;
          const wave = Math.exp(-((d - shockAge * 380) ** 2) / 300) * (1 - shockAge / SHOCK_LIFE);
          ox += (dx / d) * wave * 14;
          oy += (dy / d) * wave * 14;
          hot = Math.max(hot, wave);
        }
        const shimmer = reducedMotion ? 0 : Math.max(0, Math.sin(u * 9 - t * 1.6 + v * 2)) ** 8;
        // density: a drifting noise texture that thins out towards the edges and clears around the headline
        const clearing = clamp(rrSdf(x, y, bx, by, bw + 6, bh + 4, 10) / CLEARING, 0, 1);
        const edge = Math.min(1, x / 64, (W - x) / 64, y / 30, (this.h - y) / 30);
        const density = (0.12 + 0.3 * fbm(x * 0.012 + t * 0.05, y * 0.03)) * clearing * clamp(edge, 0, 1);
        const lit = clamp(hot + shimmer * 0.6 + front, 0, 1);
        if (bayer(i, j) > density + lit * 0.5) continue;
        const col = mix(mix(P.muted, P.accent, 0.25 + v * 0.55), P.shine, lit * 0.8);
        const bright = hot > 0.1 || front > 0.2;
        F.plot(
          x + ox,
          y + oy,
          bright ? mix(col, WHITE, this.dark ? 0.4 * Math.max(hot, front) : 0) : col,
          (this.dark ? 0.7 : 0.55) + lit * 0.3,
          0.04 + hot * 0.9 + shimmer * 0.35 + front * 0.8,
        );
      }
    }
    this.flush(0.9, 5);
    return !reducedMotion;
  }
}

define("hf-hero", HHero);

declare global {
  interface HTMLElementTagNameMap {
    "hf-hero": HHero;
  }
}

export { HHero };
