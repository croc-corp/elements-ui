/**
 * <px-theme> · Day / night switch
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/theme
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-theme.tsx.
 */
import {
  PxBase,
  bitmap,
  clamp,
  define,
  lerp,
  mix,
  now,
  reduced,
  rollText,
  rrect,
  type Point,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<px-theme>`. */
export interface ThemeEventMap {
  /** Fires on every toggle with the new state; not when the switch follows a page theme change. */
  change: CustomEvent<{ dark: boolean }>;
}

/** A pixel of the sun or moon shape, relative to the disc centre; `ray` marks the sun's rays. */
type ShapePoint = [x: number, y: number, ray: boolean];

/** A pixel that springs between the sun and moon shapes; it starts moving at time `delay`. */
interface MorphPixel {
  x: number;
  y: number;
  vx: number;
  vy: number;
  delay: number;
}

/** A drifting cloud: position and drift direction. */
type Cloud = readonly [x: number, y: number, dir: number];

const SKY_DAY: readonly [top: RGB, bottom: RGB] = [
  [120, 190, 255],
  [206, 234, 255],
];

const SKY_NIGHT: readonly [top: RGB, bottom: RGB] = [
  [12, 12, 40],
  [44, 32, 96],
];

const SUN: RGB = [255, 204, 64];
const SUN_RAY: RGB = [255, 178, 40];
const MOON: RGB = [236, 232, 255];
const WHITE: RGB = [255, 255, 255];

const CLOUD = bitmap(["..##....", ".####.##", "########"]);

const STARS: readonly Point[] = [
  [20, 18],
  [48, 12],
  [34, 52],
  [62, 28],
  [14, 40],
  [56, 54],
  [84, 16],
  [72, 44],
];

const CLOUDS: readonly Cloud[] = [
  [96, 42, 1],
  [114, 22, -1],
];

/** Whether the page shows its dark theme: `data-theme` on `<html>`, then the `.dark` class, then the OS setting. */
function pageIsDark(): boolean {
  const root = document.documentElement;
  const pageTheme = root.dataset.theme;
  if (pageTheme === "dark" || pageTheme === "light") return pageTheme === "dark";
  return root.classList.contains("dark") || matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Sun disc with eight rays, and a crescent moon, on a 3px grid. */
function buildShapes(): [sun: ShapePoint[], moon: ShapePoint[]] {
  const sun: ShapePoint[] = [];
  const moon: ShapePoint[] = [];
  for (let y = -12; y <= 12; y += 3) {
    for (let x = -12; x <= 12; x += 3) {
      const r = Math.hypot(x, y);
      if (r <= 10.5) sun.push([x, y, false]);
      if (r <= 12 && Math.hypot(x - 5, y + 4) > 9.5) moon.push([x, y, false]);
    }
  }
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    for (const rr of [15, 18.5]) sun.push([Math.cos(a) * rr, Math.sin(a) * rr, true]);
  }
  return [sun, moon];
}

/**
 * Day/night switch whose sun pixels rebuild as a crescent moon while night sweeps the sky; it can set the page theme.
 */
class Theme extends PxBase {
  static readonly observedAttributes = ["controls-page"] as const;

  private readonly parts: MorphPixel[] = [];
  private shapes: [sun: ShapePoint[], moon: ShapePoint[]] = [[], []];
  /** Night amount from 0 (day) to 1 (night), eased towards the state. */
  private m = 0;
  private night = false;
  /** Place the pixels on their shape without the spring on the next frame. */
  private snap = false;
  /** With `controls-page`, follows theme changes made elsewhere on the page. */
  private pageObserver: MutationObserver | null = null;
  private readonly switchButton = this.$<HTMLButtonElement>(".sw");

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: grid; justify-items: center; gap: 12px; }
      .sw { width: 156px; height: 72px; border: 0; padding: 0; background: none; border-radius: 36px; cursor: pointer; display: block; transition: transform .15s cubic-bezier(.2,.8,.2,1); }
      .sw:active { transform: scale(.96); }
      canvas.px { width: 156px; height: 72px; }
      .lab { font-size: 13.5px; font-weight: 500; }
      .lab .rollslot { justify-items: center; }
      .hint { font-size: 12px; color: var(--_muted); }
      `,
      `<div class="wrap"><button class="sw" type="button" role="switch" aria-checked="false" aria-label="Dark mode"><canvas class="px"></canvas></button><span class="lab"><span class="rollslot l" aria-live="polite"></span></span><span class="hint"></span></div>`,
    );
    this.switchButton.addEventListener("click", () => this.toggle());
  }

  protected override init(): void {
    const [sun, moon] = buildShapes();
    this.shapes = [sun, moon];
    const n = Math.max(sun.length, moon.length);
    for (let k = 0; k < n; k++) this.parts.push({ x: 36, y: 36, vx: 0, vy: 0, delay: 0 });
    this.night = pageIsDark();
    this.m = this.night ? 1 : 0;
    this.sync(false);
    this.snap = true;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.linkPage();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.pageObserver?.disconnect();
    this.pageObserver = null;
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.linkPage();
  }

  /** Show the hint and follow the page theme while `controls-page` is set. */
  private linkPage(): void {
    const controls = this.hasAttribute("controls-page");
    this.$(".hint").textContent = controls ? "Switches this page’s theme" : "";
    if (controls && !this.pageObserver) {
      this.pageObserver = new MutationObserver(() => this.followPage());
      this.pageObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "class"],
      });
    } else if (!controls && this.pageObserver) {
      this.pageObserver.disconnect();
      this.pageObserver = null;
    }
  }

  /** Move the switch when the page theme was changed by something else; fires no event. */
  private followPage(): void {
    const night = pageIsDark();
    if (night === this.night) return;
    this.setNight(night);
  }

  /** Start the morph to `night` and update the switch state and label. */
  private setNight(night: boolean): void {
    this.night = night;
    const start = now();
    for (const p of this.parts) p.delay = start + Math.random() * 0.18;
    this.sync(true);
    this.kick();
  }

  private sync(animate: boolean): void {
    this.switchButton.setAttribute("aria-checked", String(this.night));
    rollText(this.$(".l"), this.night ? "Dark" : "Light", this.night ? 1 : -1, animate);
  }

  /**
   * Switches between day and night and fires `change`. With `controls-page`, also sets `data-theme` and the
   * `.dark` class on `<html>`.
   */
  toggle(): void {
    this.setNight(!this.night);
    if (this.hasAttribute("controls-page")) {
      // data-theme for attribute-based themes, the class for shadcn's default `.dark` setup
      const root = document.documentElement;
      root.dataset.theme = this.night ? "dark" : "light";
      root.classList.toggle("dark", this.night);
    }
    this.emit<{ dark: boolean }>("change", { dark: this.night });
  }

  /** How far night has swept over column `x`: night enters from the left. */
  private nightAt(x: number): number {
    return clamp(this.m * 1.7 - (x / this.w) * 0.7, 0, 1);
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const still = reduced();
    const w = this.w;
    const h = this.h;
    const target = this.night ? 1 : 0;
    this.m = still ? target : this.m + clamp(target - this.m, -dt / 0.75, dt / 0.75);
    const e = this.m * this.m * (3 - 2 * this.m);
    this.clear();
    ctx.save();
    rrect(ctx, 0, 0, w, h, h / 2);
    ctx.clip();

    for (let y = 2; y < h; y += 4) {
      for (let x = 2; x < w; x += 4) {
        const v = y / h;
        const day = mix(SKY_DAY[0], SKY_DAY[1], v);
        const night = mix(SKY_NIGHT[0], SKY_NIGHT[1], v);
        this.dot(x - 1.7, y - 1.7, mix(day, night, this.nightAt(x)), 1, 3.6);
      }
    }
    for (const [sx, sy] of STARS) {
      const cover = this.nightAt(sx);
      const twinkle = still ? 0.75 : 0.5 + 0.5 * Math.abs(Math.sin(t * 2 + sx));
      if (cover > 0.05) this.dot(sx, sy, WHITE, cover * twinkle, 2);
    }
    const cloudAlpha = 1 - clamp(this.m * 1.7 - 0.45, 0, 1);
    if (cloudAlpha > 0.02) {
      for (const [ox, oy, dir] of CLOUDS) {
        const drift = still ? 0 : Math.sin(t * 0.6 + ox) * 3 * dir;
        for (const [x, y] of CLOUD) this.dot(ox + drift + x * 3, oy + y * 3, WHITE, cloudAlpha * 0.9, 2.8);
      }
    }

    const bx = lerp(36, w - 36, e);
    const by = h / 2;
    const shape = this.shapes[this.night ? 1 : 0];
    const n = shape.length;
    this.parts.forEach((p, k) => {
      const [sx, sy, ray] = shape[k % n];
      const tx = bx + sx;
      const ty = by + sy;
      if (this.snap || still) {
        p.x = tx;
        p.y = ty;
        p.vx = 0;
        p.vy = 0;
      } else if (t >= p.delay) {
        const stiffness = 220;
        const damping = 2 * Math.sqrt(stiffness) * 0.6;
        p.vx += (stiffness * (tx - p.x) - damping * p.vx) * dt;
        p.x += p.vx * dt;
        p.vy += (stiffness * (ty - p.y) - damping * p.vy) * dt;
        p.y += p.vy * dt;
      }
      const color = ray ? mix(SUN_RAY, MOON, e) : mix(SUN, MOON, e);
      // pixels beyond the smaller shape travel along but stay invisible
      this.dot(p.x - 1.4, p.y - 1.4, color, k < n ? 1 : 0, 2.8);
    });
    this.snap = false;
    ctx.restore();
    const moving = Math.abs(this.m - target) > 0.001 || this.parts.some((p) => Math.abs(p.vx) + Math.abs(p.vy) > 0.5);
    return moving || !still;
  }
}

define("px-theme", Theme);

export { Theme };

declare global {
  interface HTMLElementTagNameMap {
    "px-theme": Theme;
  }
}
