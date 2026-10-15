/**
 * LumeSec Elements · Pixel engine
 * https://elements.lumesec.ai
 *
 * Shared runtime for the Pixel Lab and Pixel HD custom elements: theme tokens, the custom-element base
 * classes, the animation loop and drawing helpers.
 * Importing this module has no side effects on the server. In the browser the page-wide watchers (theme, pixel
 * ratio, tab visibility, reduced motion) start when the first element connects.
 */

import { cancelTick, requestTick } from "@/lib/lumesec/ticker";

/** An sRGB colour as `[r, g, b]` channels in 0–255. */
export type RGB = [r: number, g: number, b: number];

/** A position or cell offset as `[x, y]`. */
export type Point = [x: number, y: number];

/** A `[min, max]` range; random values are drawn uniformly from it. */
export type Range = readonly [min: number, max: number];

/**
 * `HTMLElement` in the browser. On the server it is an inert class, so the element classes below can be
 * declared during SSR; it is never constructed there because tags are only defined in the browser.
 */
export const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as typeof HTMLElement) : HTMLElement;

/* core */

/** The `prefers-reduced-motion: reduce` query; null on the server. */
const reducedMotionQuery: MediaQueryList | null =
  typeof matchMedia === "undefined" ? null : matchMedia("(prefers-reduced-motion: reduce)");

/** True while the user asks for reduced motion. Read on every call, so it follows OS changes. */
export const reduced = (): boolean => reducedMotionQuery?.matches ?? false;

/** A full turn in radians. */
export const TAU = Math.PI * 2;

/** `value` limited to `[min, max]`. */
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A random number in `[min, max)`. */
export const rand = (min: number, max: number): number => min + Math.random() * (max - min);

/** Linear interpolation from `a` to `b`. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smoothstep: 0 below `edge0`, 1 above `edge1`, an S-curve in between. */
export const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Deterministic pseudo-random number in `[0, 1)` for an integer seed. */
export const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Per-channel interpolation between two colours. */
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** CSS `rgb()` for a colour, or `rgba()` when an alpha is given. */
export const css = (c: RGB, alpha?: number | null): string =>
  alpha == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;

/** 32-bit FNV-1a hash of a string, for stable per-label variation. */
export const strHash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** A rounded integer with thousands separators (`48,210`). */
export const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");

/**
 * Shadow-root CSS shared by every pixel element. Each private `--_x` token reads the `--ui-x` override first,
 * then the shadcn theme (or a LumeSec accent token), then a fallback for pages without a theme. The shared classes
 * include `.sr`, text that only screen readers read (an `aria-live` status line, a spoken form of a symbol).
 */
export const TOKENS = `
  :host {
    --_surface: var(--ui-surface, var(--card, #ffffff));
    --_raised: var(--ui-raised, var(--muted, #f4f4f5));
    --_border: var(--ui-border, var(--border, #e4e4e7));
    --_fg: var(--ui-fg, var(--foreground, #09090b));
    --_muted: var(--ui-muted, var(--muted-foreground, #71717b));
    --_track: var(--ui-track, var(--muted, #f4f4f5));
    --_accent: var(--ui-accent, var(--lumesec, #6219f3));
    --_on-accent: var(--ui-on-accent, var(--lumesec-foreground, #fafafa));
    --_shine: var(--ui-shine, var(--lumesec-shine, #3f12b0));
    --_danger: var(--ui-danger, var(--destructive, #e5484d));
    --_ok: var(--ui-ok, var(--lumesec-success, #00a14b));
    --_warn: var(--ui-warn, var(--lumesec-warning, #d97706));
    --_font: var(--ui-font, var(--font-sans, inherit));
    --_mono: var(--ui-mono, var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace));
    font-family: var(--_font);
    color: var(--_fg);
    -webkit-tap-highlight-color: transparent;
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --_surface: var(--ui-surface, var(--card, #18181b));
      --_raised: var(--ui-raised, var(--muted, #27272a));
      --_border: var(--ui-border, var(--border, #27272a));
      --_fg: var(--ui-fg, var(--foreground, #fafafa));
      --_muted: var(--ui-muted, var(--muted-foreground, #9f9fa9));
      --_track: var(--ui-track, var(--muted, #09090b));
      --_accent: var(--ui-accent, var(--lumesec, #8654fb));
      --_on-accent: var(--ui-on-accent, var(--lumesec-foreground, #fafafa));
      --_shine: var(--ui-shine, var(--lumesec-shine, #ffffff));
      --_danger: var(--ui-danger, var(--destructive, #ff6568));
      --_ok: var(--ui-ok, var(--lumesec-success, #00c758));
      --_warn: var(--ui-warn, var(--lumesec-warning, #eeb154));
    }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, input { font: inherit; color: inherit; }
  button { -webkit-user-select: none; user-select: none; }
  :focus { outline: none; }
  :focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
  canvas.px { display: block; width: 100%; image-rendering: pixelated; }
  .sr {
    position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%);
    white-space: nowrap;
  }
  .mono { font-family: var(--_mono); }
  .fxl { position: absolute; inset: -40px; pointer-events: none; z-index: 5; }
  .pbtn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px;
    border-radius: 8px; border: 1px solid var(--_border); background: var(--_surface); color: var(--_fg);
    font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap;
    transition: transform .15s cubic-bezier(.2,.8,.2,1), background-color .2s, border-color .2s, color .2s;
  }
  .pbtn:hover { background: var(--_raised); }
  .pbtn:active { transform: scale(.95); }
  .pbtn[aria-pressed="true"] { border-color: color-mix(in srgb, var(--_accent) 55%, var(--_border)); color: var(--_accent); }
  .rollslot {
    display: inline-grid; justify-items: start; perspective: 180px;
    padding-block: 5px; margin-block: -5px;
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 5px, #000 calc(100% - 5px), transparent 100%);
            mask-image: linear-gradient(to bottom, transparent 0, #000 5px, #000 calc(100% - 5px), transparent 100%);
  }
  .roll { grid-area: 1 / 1; white-space: nowrap; transform-origin: 50% 50% -10px; backface-visibility: hidden; }
  `;

/* colour reading */

/** The 1×1 canvas that resolves CSS colours to RGB; created on first use, null on the server. */
let colorProbe: CanvasRenderingContext2D | null | undefined;

function getColorProbe(): CanvasRenderingContext2D | null {
  if (colorProbe === undefined) {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorProbe = canvas.getContext("2d", { willReadFrequently: true });
  }
  return colorProbe;
}

const colorCache = new Map<string, RGB>();

/**
 * RGB of a CSS colour string. The colour is painted into the 1×1 probe and read back, so every syntax the
 * browser understands works (hex, `rgb()`, `oklch()`, `color-mix()`); an empty or invalid value paints
 * `fallback` instead. Cached per string.
 */
function paintColor(value: string, fallback: string): RGB {
  const key = `${value}|${fallback}`;
  const hit = colorCache.get(key);
  if (hit) return [hit[0], hit[1], hit[2]];
  const probe = getColorProbe();
  if (!probe) return [128, 128, 128];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = fallback;
  // the canvas ignores a colour it cannot parse, so the fallback stays
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  if (colorCache.size > 256) colorCache.clear();
  colorCache.set(key, [r, g, b]);
  return [r, g, b];
}

/**
 * Resolve the custom property `name` on `el` to RGB. `var()` chains are resolved by `getComputedStyle`, the
 * resulting colour by the canvas, so shadcn `oklch()` themes work. `fb` is used when the property is unset.
 */
export function rgb(el: Element, name: string, fb = "#888888"): RGB {
  return paintColor(getComputedStyle(el).getPropertyValue(name).trim(), fb);
}

/* text roll */

/** Timing of the {@link rollText} flip. */
export const ROLL: { readonly duration: number; readonly easing: string } = {
  duration: 380,
  easing: "cubic-bezier(.3,1.3,.5,1)",
};

/**
 * Replace the text of a `.rollslot` with a vertical flip: the old line rotates out, the new one in.
 * `dir` < 0 flips the other way. Without animation (or under reduced motion) the text is swapped.
 */
export function rollText(slot: Element, text: string, dir = 1, animate = true): void {
  const current = slot.lastElementChild;
  if (current && current.textContent === text) return;
  const next = document.createElement("span");
  next.className = "roll";
  next.textContent = text;
  slot.appendChild(next);
  if (!current) return;
  if (!animate || reduced() || typeof next.animate !== "function") {
    for (const child of [...slot.children]) {
      if (child !== next) child.remove();
    }
    return;
  }
  while (slot.children.length > 3) slot.firstElementChild?.remove();
  const d = dir < 0 ? -1 : 1;
  const out = current.animate(
    [
      { opacity: 1, transform: "rotateX(0deg)" },
      { opacity: 0.35, offset: 0.45 },
      { opacity: 0, transform: `rotateX(${d * 88}deg)` },
    ],
    { ...ROLL, fill: "forwards" },
  );
  const removeCurrent = (): void => current.remove();
  out.onfinish = removeCurrent;
  out.oncancel = removeCurrent;
  next.animate(
    [
      { opacity: 0, transform: `rotateX(${-d * 88}deg)` },
      { opacity: 1, offset: 0.55 },
      { opacity: 1, transform: "rotateX(0deg)" },
    ],
    ROLL,
  );
}

/* sparks */

/** Options for {@link Sparks.add}. */
export interface SparkOptions {
  /** Launch speed in px/s. */
  speed?: Range;
  /** Lifetime in seconds. */
  life?: Range;
  /** Mean launch direction in radians. */
  angle?: number;
  /** Spread around `angle` in radians; {@link TAU} sprays in every direction. */
  spread?: number;
  /** Square size `[usual, occasional]`: about 30% of sparks use the second. */
  size?: Range;
  /** Downward acceleration in px/s². */
  gravity?: number;
  /** Exponential velocity damping per second. */
  drag?: number;
  /** Random offset of the start position in px. */
  jitter?: number;
}

/** One live spark of a {@link Sparks} system. */
export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since launch. */
  age: number;
  /** Lifetime in seconds. */
  life: number;
  size: number;
  color: RGB;
  gravity: number;
  drag: number;
}

/** In-canvas square sparks. */
export class Sparks {
  /** Live sparks; empty once every spark has faded. */
  list: Spark[] = [];

  /** Launch `n` sparks from `(x, y)`, cycling through `cols`. Does nothing under reduced motion. */
  add(x: number, y: number, n: number, cols: readonly RGB[], o: SparkOptions = {}): void {
    if (reduced()) return;
    const {
      speed = [40, 170],
      life = [0.3, 0.75],
      angle = 0,
      spread = TAU,
      size = [1.5, 2.5],
      gravity = 0,
      drag = 4,
      jitter = 2,
    } = o;
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = rand(speed[0], speed[1]);
      this.list.push({
        x: x + rand(-jitter, jitter),
        y: y + rand(-jitter, jitter),
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        age: 0,
        life: rand(life[0], life[1]),
        size: Math.random() < 0.3 ? size[1] : size[0],
        color: cols[i % cols.length],
        gravity,
        drag,
      });
    }
  }

  /** Advance by `dt` seconds and draw into `g`. Returns whether any spark is still alive. */
  step(g: CanvasRenderingContext2D, dt: number): boolean {
    if (!this.list.length) return false;
    for (const p of this.list) {
      p.age += dt;
      const k = Math.exp(-dt * p.drag);
      p.vx *= k;
      p.vy = p.vy * k + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age < p.life) {
        g.globalAlpha = Math.pow(1 - p.age / p.life, 1.3);
        g.fillStyle = css(p.color);
        g.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    g.globalAlpha = 1;
    this.list = this.list.filter((p) => p.age < p.life);
    return this.list.length > 0;
  }
}

/* bitmaps */

/** Lit cells of an ASCII bitmap where `#` is on: `[".#.", "###"]` → `[[1, 0], [0, 1], [1, 1], [2, 1]]`. */
export const bitmap = (rows: readonly string[]): Point[] => {
  const pts: Point[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === "#") pts.push([x, y]);
    });
  });
  return pts;
};

/* page watchers: theme, pixel ratio, tab visibility and reduced motion for every connected element */

/** Connected canvas elements; {@link repaint} refreshes them after a theme change. */
const LIVE = new Set<PxBase>();

/**
 * Drop every cached palette and redraw. Runs on its own after theme switches (`.dark` or `data-theme` on `<html>`,
 * inline theme variables, the OS colour scheme); call it after changing theme variables anywhere else.
 */
export const repaint = (): void => {
  LIVE.forEach((el) => {
    el.pal = null;
    el.kick();
  });
};

/** The device pixel ratio the engine renders at (capped at 3). */
export const pixelRatio = (): number => Math.min(devicePixelRatio || 1, 3);

/**
 * Calls `onChange` on every change of the device pixel ratio: browser zoom, or the window moving to a screen with
 * another density. A canvas keeps its CSS size then, so no resize reports it.
 */
function watchPixelRatio(onChange: () => void): void {
  // the query matches the current ratio only, so it fires once on the next change and is then replaced;
  // optional call: Safari before 14 only has the deprecated addListener
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener?.(
    "change",
    () => {
      watchPixelRatio(onChange);
      onChange();
    },
    { once: true },
  );
}

let watchingPage = false;

/** Starts the page-wide watchers once, when the first element connects. They live as long as the page. */
function watchPage(): void {
  if (watchingPage) return;
  watchingPage = true;
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", repaint);
  // shadcn toggles `.dark` on <html>; other setups use data-theme or inline style variables
  new MutationObserver(repaint).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class", "style"],
  });
  // each element refits its canvas on its next frame when the ratio changed
  watchPixelRatio(() => LIVE.forEach((el) => el.kick()));
  // a hidden tab drops or holds animation frames; animations that were running carry on when it returns
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) LIVE.forEach((el) => el.resume());
  });
  // loops stop under reduced motion; a frame lets each element pick its loop up again when the user turns it off,
  // or settle into its still state when the user turns it on
  reducedMotionQuery?.addEventListener?.("change", () => LIVE.forEach((el) => el.kick()));
}

/** Palette keys; each colour is read from the `--_<key>` token. */
export const PAL = [
  "accent",
  "shine",
  "fg",
  "muted",
  "track",
  "danger",
  "ok",
  "warn",
  "surface",
  "raised",
  "border",
] as const;

/** A colour name of the {@link Palette}. */
export type PaletteKey = (typeof PAL)[number];

/** The theme colours a canvas element draws with, resolved to RGB. */
export type Palette = Record<PaletteKey, RGB>;

function readPalette(el: Element): Palette {
  const style = getComputedStyle(el);
  const read = (key: PaletteKey): RGB => paintColor(style.getPropertyValue(`--_${key}`).trim(), "#888888");
  return {
    accent: read("accent"),
    shine: read("shine"),
    fg: read("fg"),
    muted: read("muted"),
    track: read("track"),
    danger: read("danger"),
    ok: read("ok"),
    warn: read("warn"),
    surface: read("surface"),
    raised: read("raised"),
    border: read("border"),
  };
}

/* base classes */

/** Whether `key` is an accessor with a setter somewhere on the prototype chain. */
function hasSetter(prototype: object | null, key: string): boolean {
  for (let p = prototype; p; p = Object.getPrototypeOf(p)) {
    const descriptor = Object.getOwnPropertyDescriptor(p, key);
    if (descriptor) return descriptor.set !== undefined;
  }
  return false;
}

/**
 * A property set on an element before its tag was defined (`el.data = rows` ahead of a lazily loaded module) is an
 * own property that hides the class's accessor. Assign each such value again, through the setter.
 */
function upgradeProperties(el: HTMLElement): void {
  for (const key of Object.keys(el)) {
    if (!hasSetter(Object.getPrototypeOf(el), key)) continue;
    const value: unknown = Reflect.get(el, key);
    Reflect.deleteProperty(el, key);
    Reflect.set(el, key, value);
  }
}

/** Custom element with an open shadow root holding {@link TOKENS}, the component CSS and its template. */
export class Base extends HTMLElementBase {
  /** The shadow root with the component template. */
  readonly root: ShadowRoot;

  /**
   * @param style component CSS, appended to the shared tokens
   * @param html shadow template
   */
  constructor(style: string, html: string) {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${TOKENS}${style}</style>${html}`;
  }

  /** First match in the shadow root. Components only query their own template, so the node exists. */
  $<K extends keyof HTMLElementTagNameMap>(selector: K): HTMLElementTagNameMap[K];
  /**
   * First match in the shadow root, typed as `T` (an `HTMLElement` unless given). `NoInfer` keeps a parameter
   * type at the call site (`anchor?: HTMLElement`) from widening `T` to `Element`.
   */
  $<T extends Element = HTMLElement>(selector: string): NoInfer<T>;
  $(selector: string): Element {
    return this.root.querySelector(selector)!;
  }

  /** All matches in the shadow root. */
  $$<K extends keyof HTMLElementTagNameMap>(selector: K): HTMLElementTagNameMap[K][];
  /** All matches in the shadow root, typed as `T` (an `HTMLElement` unless given). */
  $$<T extends Element = HTMLElement>(selector: string): NoInfer<T>[];
  $$(selector: string): Element[] {
    return [...this.root.querySelectorAll(selector)];
  }

  /** Dispatch a `CustomEvent` that bubbles out of the shadow root. `detail` defaults to `{}`. */
  emit<D>(type: string, detail?: D, options?: EventInit): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail: detail === undefined ? {} : detail, bubbles: true, composed: true, ...options }),
    );
  }

  /** Numeric attribute, or `fallback` when it is missing or not a finite number. */
  num(name: string, fallback: number): number {
    const value = parseFloat(this.getAttribute(name) ?? "");
    return Number.isFinite(value) ? value : fallback;
  }
}

/**
 * Canvas component: DPR-aware sizing, palette from theme, rAF loop paused off-screen.
 * `render(t, dt)` draws a frame and returns whether to keep going; {@link PxBase.kick} restarts the loop.
 */
export class PxBase extends Base {
  /** Cached palette; null re-reads the tokens on the next {@link PxBase.P} access. */
  pal: Palette | null = null;
  /** Canvas width in CSS pixels; 0 until the first layout. */
  w = 0;
  /** Canvas height in CSS pixels; 0 until the first layout. */
  h = 0;
  /** Time of the current frame in seconds. */
  t = 0;
  /**
   * The most frames a second the loop draws. 60 draws on every display frame; an element whose motion looks the
   * same at 30 sets 30, which halves the main-thread work of its canvas animation. Between frames the loop sleeps.
   */
  protected frameRate = 60;
  private _drawnAt = -1e9;
  /** The template's `canvas.px`, found on connect; null for components that animate DOM only. */
  cv: HTMLCanvasElement | null = null;
  /** 2D context of {@link PxBase.cv}, scaled so drawing uses CSS pixels. */
  ctx: CanvasRenderingContext2D | null = null;
  private _inited = false;
  private _vis = true;
  /** Set by the resize observer: the next frame refits the canvas before it draws. */
  private _refit = false;
  private _raf = 0;
  private _last = 0;
  /** Device pixel ratio of the backing store; 0 until the first fit. */
  private _dpr = 0;
  private _ro: ResizeObserver | null = null;
  private _io: IntersectionObserver | null = null;

  /** One-time setup on the first connect, after attributes are available. */
  protected init?(): void;
  /**
   * Called when the element goes on or off screen, after the frame loop paused or resumed. Elements that also
   * animate with CSS or the Web Animations API pause those animations here.
   */
  protected visibilityChanged?(visible: boolean): void;
  /**
   * Called after the canvas was resized; `w` and `h` hold the new size. Runs at the start of a frame, before
   * `render`, so it may change the size of the canvas or its box.
   */
  protected resized?(): void;
  /** Draw one frame. `t` is the time in seconds, `dt` the clamped frame delta. Return true to keep animating. */
  protected render?(t: number, dt: number): boolean;

  /**
   * True once `init()` has run, on the first connect. Attribute and form callbacks can run before that, so guard
   * them with it. Public, so a composite element can check an element in its template (`hf-hero` does).
   */
  get initialized(): boolean {
    return this._inited;
  }

  /** Whether the element is on screen; the frame loop pauses while it is not. */
  protected get onScreen(): boolean {
    return this._vis;
  }

  connectedCallback(): void {
    watchPage();
    LIVE.add(this);
    this.cv = this.root.querySelector<HTMLCanvasElement>("canvas.px");
    if (this.cv && !this._ro) {
      this.ctx = this.cv.getContext("2d");
      this._ro = new ResizeObserver(() => {
        // refit on the next frame, not in this callback: resized() may change the canvas's own size (a height that
        // follows the width), and changing an observed element inside its resize callback is a ResizeObserver loop.
        // The frame also comes off screen, so `w`, `h` and the layout stay current there.
        this._refit = true;
        this._frame();
      });
    }
    if (this.cv) this._ro?.observe(this.cv);
    this._io = new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1].isIntersecting;
      const changed = visible !== this._vis;
      this._vis = visible;
      this.kick();
      if (changed) this.visibilityChanged?.(visible);
    });
    this._io.observe(this);
    if (!this._inited) {
      this._inited = true;
      this.init?.();
      // after init, so a value set on the element before its tag was defined wins over the attribute
      upgradeProperties(this);
    }
    this.kick();
  }

  disconnectedCallback(): void {
    LIVE.delete(this);
    this._ro?.disconnect();
    this._io?.disconnect();
    cancelTick(this._raf);
    this._raf = 0;
  }

  /**
   * Size the canvas backing store to its box at the device pixel ratio (capped at 3), then call `resized()`. The
   * engine calls it on the first frame after the canvas changed size.
   */
  protected fit(): void {
    const cv = this.cv;
    const g = this.ctx;
    if (!cv || !g) return;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = pixelRatio();
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._dpr = dpr;
    this.w = w;
    this.h = h;
    this.resized?.();
  }

  /** Theme colours, read once and cached until the theme changes. */
  get P(): Palette {
    this.pal ??= readPalette(this);
    return this.pal;
  }

  /** The resolved monospace font stack, for canvas text. */
  get monoFont(): string {
    return getComputedStyle(this).getPropertyValue("--_mono").trim() || "monospace";
  }

  /**
   * Restart the loop after the tab was hidden: drop a frame request the browser may have discarded and
   * re-read whether the element is on screen (observing again reports the current intersection).
   */
  resume(): void {
    cancelTick(this._raf);
    this._raf = 0;
    if (this._io) {
      this._io.unobserve(this);
      this._io.observe(this);
    }
    // a refit the hidden tab held back happens even off screen
    if (this._refit) this._frame();
    else this.kick();
  }

  /** Schedule a frame unless one is pending or the element is detached or off screen. */
  kick(): void {
    if (this._vis) this._frame();
  }

  /** Request a frame unless one is pending or the element is detached. */
  private _frame(): void {
    if (this._raf || !this.isConnected) return;
    this._last = performance.now();
    // frames come from the shared ticker: one requestAnimationFrame for every element on the page
    this._raf = requestTick(this._tick);
  }

  private readonly _tick = (now: number): void => {
    this._raf = 0;
    // the frame rate cap: the timer wakes the loop one interval after the last drawn frame, and an earlier extra
    // display frame is skipped, unless the canvas must refit
    const interval = 1000 / this.frameRate;
    if (!this._refit && now - this._drawnAt < interval / 2) {
      if (this.isConnected && this._vis) this._raf = requestTick(this._tick, this._drawnAt + interval - 2);
      return;
    }
    this._drawnAt = now;
    const dt = Math.min(0.05, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    this.t = now / 1000;
    // refit after the resize observer reported a new size, or after a pixel ratio change (zoom, another screen),
    // which keeps the CSS size so the observer does not report it
    if (this.cv && (this._refit || (this._dpr && this._dpr !== pixelRatio()))) {
      this._refit = false;
      this.fit();
    }
    // a frame that only refitted an off-screen canvas draws nothing
    if (!this._vis) return;
    if (this.cv && !this.w) return;
    const more = this.render?.(this.t, dt) ?? false;
    // continue from this frame's timestamp, so `dt` measures whole frames and not the time since the draw ended;
    // the render may have queued a frame through kick() already
    if (more && !this._raf && this.isConnected && this._vis)
      this._raf = requestTick(this._tick, this.frameRate < 60 ? now + 1000 / this.frameRate - 2 : 0);
  };

  /** Clear the whole canvas. */
  clear(): void {
    const g = this.ctx;
    if (!g) return;
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.w, this.h);
  }

  /** Fill an `s`×`s` square at `(x, y)` with colour `c` at opacity `a`. */
  dot(x: number, y: number, c: RGB, a = 1, s = 2): void {
    const g = this.ctx;
    if (!g) return;
    g.globalAlpha = clamp(a, 0, 1);
    g.fillStyle = css(c);
    g.fillRect(x, y, s, s);
  }
}

/** Registers a tag once, so several modules (or two copies of one) can share a page. Safe on the server. */
export const define = (name: string, ctor: CustomElementConstructor): void => {
  if (typeof customElements !== "undefined" && !customElements.get(name)) customElements.define(name, ctor);
};

/** Current time in seconds, on the same clock as `PxBase.t`. */
export const now = (): number => performance.now() / 1000;

/** Whether the palette belongs to a dark theme (light foreground). */
export const isDark = (P: Palette): boolean => P.fg[0] + P.fg[1] + P.fg[2] > 384;

/** Cubic ease-out of `u`, clamped to `[0, 1]`. */
export const ease3 = (u: number): number => 1 - Math.pow(1 - clamp(u, 0, 1), 3);

/** RGB for a hue in degrees and saturation and lightness in `[0, 1]`. */
export function hsl(h: number, s: number, l: number): RGB {
  const hue = (((h % 360) + 360) % 360) / 360;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const k = (n + hue * 12) % 12;
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [channel(0), channel(8), channel(4)];
}

/** `#rrggbb` for a colour; channels are rounded and clamped. */
export const toHex = (c: RGB): string =>
  "#" +
  c
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/** Begin a rounded-rectangle path, or a plain rectangle where `roundRect` is unsupported. */
export function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

/** Options for {@link pixelBurst}. */
export interface BurstOptions extends SparkOptions {
  /** Number of sparks. */
  count?: number;
  /** Colour tokens (`"--_accent"`) resolved on the host. */
  colors?: readonly string[];
}

/**
 * Sparks on a throwaway canvas inside an absolutely positioned .fxl layer, so they can fly past the component's
 * edges. `origin` is an element (its centre) or a point in layer coordinates.
 */
export function pixelBurst(
  host: Element,
  layer: Element | null | undefined,
  origin: Element | { x: number; y: number },
  o: BurstOptions = {},
): void {
  if (reduced() || !layer || !layer.isConnected) return;
  const lr = layer.getBoundingClientRect();
  if (!lr.width) return;
  let x: number;
  let y: number;
  if (origin instanceof Element) {
    const r = origin.getBoundingClientRect();
    x = r.left + r.width / 2 - lr.left;
    y = r.top + r.height / 2 - lr.top;
  } else {
    x = origin.x;
    y = origin.y;
  }
  const {
    count = 24,
    colors = ["--_accent", "--_shine"],
    speed = [50, 210],
    life = [0.35, 0.85],
    size = [1.5, 2.5],
    angle = 0,
    spread = TAU,
    jitter = 4,
    drag = 4,
    gravity = 0,
  } = o;
  const dpr = pixelRatio();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(lr.width * dpr);
  canvas.height = Math.round(lr.height * dpr);
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  const g = canvas.getContext("2d");
  // decoration only: without a 2D context there is simply no burst
  if (!g) return;
  layer.appendChild(canvas);
  g.scale(dpr, dpr);
  const sparks = new Sparks();
  const cols = colors.map((token) => rgb(host, token));
  sparks.add(x, y, count, cols, { speed, life, size, angle, spread, jitter, drag, gravity });
  let last = performance.now();
  const step = (time: number): void => {
    const dt = Math.min(0.05, (time - last) / 1000);
    last = time;
    g.clearRect(0, 0, lr.width, lr.height);
    if (sparks.step(g, dt)) requestTick(step);
    else canvas.remove();
  };
  requestTick(step);
}

/* pointer and box geometry: client coordinates are on-screen pixels, layout and drawing use CSS pixels */

/** A box in CSS pixels: the top-left corner `(x, y)`, the width `w` and the height `h`. */
export interface LocalBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * On-screen pixels per CSS pixel of `el`, from its client rectangle (measured when not given). Client rectangles
 * and pointer coordinates are on-screen pixels; inside an ancestor with CSS `zoom` or a scale transform they differ
 * from the CSS pixels the element is laid out and drawn in. 1 for an element without a box.
 */
export function clientScale(el: HTMLElement, rect: DOMRectReadOnly = el.getBoundingClientRect()): number {
  const width = el.offsetWidth;
  return width ? rect.width / width || 1 : 1;
}

/**
 * The pointer position of `e` in `el`'s own CSS pixels, from its top-left corner. Correct inside CSS `zoom` and
 * scale transforms, where client coordinates are scaled.
 *
 * @example const [x, y] = localPoint(this.$("canvas"), event);
 */
export function localPoint(el: HTMLElement, e: { readonly clientX: number; readonly clientY: number }): Point {
  const r = el.getBoundingClientRect();
  return [
    ((e.clientX - r.left) * el.offsetWidth) / (r.width || 1),
    ((e.clientY - r.top) * el.offsetHeight) / (r.height || 1),
  ];
}

/**
 * A function that measures boxes relative to `origin`, in `origin`'s CSS pixels: pass it an element or a client
 * rectangle (such as one line box from `getClientRects()`). Correct inside CSS `zoom` and scale transforms.
 * `origin` is measured once, so create the mapper once per frame and map every box of that frame with it.
 *
 * @example const local = boxMapper(this.$("canvas")); const { x, y, w, h } = local(this.$(".label"));
 */
export function boxMapper(origin: HTMLElement): (target: Element | DOMRectReadOnly) => LocalBox {
  const o = origin.getBoundingClientRect();
  const scale = clientScale(origin, o);
  return (target) => {
    const r = target instanceof Element ? target.getBoundingClientRect() : target;
    return { x: (r.left - o.left) / scale, y: (r.top - o.top) / scale, w: r.width / scale, h: r.height / scale };
  };
}

/* radio groups */

/** Arrow keys of a radio group and the direction each moves the check. */
const RADIO_KEYS: Readonly<Partial<Record<string, number>>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * The keyboard of a WAI-ARIA radio group: the arrow keys check the next or previous radio, wrapping around, and
 * focus moves with the check. Listens for `keydown` on `group`, the element that holds the radios.
 *
 * @param radios the radios in order, read on every key press so a rebuilt group keeps working
 * @param checked the index of the checked radio
 * @param check checks radio `index` the way a click does (and updates the roving tab index, see {@link checkRadio})
 */
export function radioKeys(
  group: HTMLElement,
  radios: () => readonly HTMLElement[],
  checked: () => number,
  check: (index: number) => void,
): void {
  group.addEventListener("keydown", (e) => {
    const step = RADIO_KEYS[e.key];
    if (!step) return;
    const list = radios();
    if (!list.length) return;
    e.preventDefault();
    const next = (((checked() + step) % list.length) + list.length) % list.length;
    check(next);
    // read again: checking may have rebuilt the radios
    radios()[next]?.focus();
  });
}

/**
 * Mark radio `index` checked (`aria-checked`) and make it the group's one Tab stop, a roving tab index: Tab enters
 * the group on the checked radio and the arrow keys of {@link radioKeys} move inside it.
 */
export function checkRadio(radios: readonly HTMLElement[], index: number): void {
  radios.forEach((radio, i) => {
    radio.setAttribute("aria-checked", String(i === index));
    radio.tabIndex = i === index ? 0 : -1;
  });
}

/* form-associated elements and form fields */

/**
 * A class constructor returning `T`. TypeScript only accepts a mixin base whose construct signature takes
 * `...args: any[]` (TS2545), so this alias is the one place the engine spells `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS2545: a mixin base must take `...args: any[]`
export type Constructor<T = object> = new (...args: any[]) => T;

/** A value an element can submit with its form. */
export type FormValue = File | string | FormData | null;

function attachInternalsOrNull(el: HTMLElement): ElementInternals | null {
  try {
    return el.attachInternals();
  } catch {
    return null;
  }
}

/**
 * Shadow CSS for a form element without a disabled look of its own: while its `disabled` attribute or a disabled
 * `<fieldset>` around it disables it, the element is dimmed and takes no pointer input.
 */
export const DISABLED_CSS = ":host(:disabled) { opacity: .55; pointer-events: none; }";

/**
 * Make an element class form-associated: it submits a value with its `<form>`, takes part in constraint
 * validation and receives `formResetCallback`. Browsers without `ElementInternals` keep working without
 * form support.
 *
 * @example class Input extends FormMixin(PxBase) {}
 */
export function FormMixin<TBase extends Constructor<HTMLElement>>(Superclass: TBase) {
  return class FormElement extends Superclass {
    static get formAssociated(): boolean {
      return true;
    }

    /** Form internals; null where `attachInternals` is unsupported or throws. */
    readonly #internals: ElementInternals | null = attachInternalsOrNull(this);

    /** The state last reported to {@link formDisabledCallback}. */
    #disabled = false;

    /**
     * True while the element is disabled, by its own `disabled` attribute or a disabled ancestor `<fieldset>`. CSS
     * sees the same state as `:host(:disabled)`.
     */
    protected get formDisabled(): boolean {
      return this.#disabled;
    }

    /**
     * Called by the browser when the `disabled` attribute or a disabled ancestor `<fieldset>` changes. Records the
     * state for {@link formDisabled}; override it to disable inner controls, and call `super.formDisabledCallback()`.
     */
    formDisabledCallback(disabled: boolean): void {
      this.#disabled = disabled;
    }

    /** Set the value submitted with the form. */
    setFormValue(value: FormValue): void {
      try {
        this.#internals?.setFormValue(value);
      } catch {
        // the element keeps working without form support
      }
    }

    /** Set the validity state; `{}` marks the element valid. `anchor` is where the browser shows the message. */
    setValidity(flags?: ValidityStateFlags, message?: string, anchor?: HTMLElement): void {
      try {
        this.#internals?.setValidity(flags, message, anchor);
      } catch {
        // throws for an invalid state without a message or an anchor outside the shadow tree; the element
        // keeps working without form validation
      }
    }

    /** The associated form, if any. */
    get form(): HTMLFormElement | null {
      return this.#internals?.form ?? null;
    }

    /** The `name` attribute, used as the form field name. */
    get name(): string | null {
      return this.getAttribute("name");
    }

    /** The `<label>` elements associated with the element; null without form support. */
    get labels(): NodeList | null {
      return this.#internals?.labels ?? null;
    }

    /** The validity state set with {@link setValidity}; null without form support. */
    get validity(): ValidityState | null {
      return this.#internals?.validity ?? null;
    }

    /** The message the browser shows for an invalid state; empty while valid. */
    get validationMessage(): string {
      return this.#internals?.validationMessage ?? "";
    }

    /** Whether the element takes part in constraint validation (false when disabled or without form support). */
    get willValidate(): boolean {
      return this.#internals?.willValidate ?? false;
    }

    /** Like `checkValidity()` on a native input: false (and an `invalid` event) for an invalid state. */
    checkValidity(): boolean {
      return this.#internals?.checkValidity() ?? true;
    }

    /** Like `reportValidity()` on a native input: also shows the browser's message for an invalid state. */
    reportValidity(): boolean {
      return this.#internals?.reportValidity() ?? true;
    }
  };
}

/** Shake an element sideways, the error cue of the form fields. Skipped under reduced motion. */
export function shake(el: Element | null | undefined): void {
  if (reduced() || !el || typeof el.animate !== "function") return;
  el.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(5px)" },
      { transform: "translateX(-3px)" },
      { transform: "translateX(2px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 380, easing: "ease-out" },
  );
}

/** A small check mark as lit cells, 7×5. */
export const SMALL_CHECK: Point[] = bitmap(["......#", ".....#.", "#...#..", ".#.#...", "..#...."]);

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a value for HTML text and for single- or double-quoted attributes. Use it on every value in markup. */
export const escapeHtml = (s: unknown): string => String(s).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

/* Pixel HD: dot fields */

/** 4×4 Bayer matrix as thresholds in `(0, 1)`, row-major. */
export const BAYER: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v + 0.5) / 16,
);

/** Ordered-dither threshold for cell `(i, j)`. */
export const bayer = (i: number, j: number): number => BAYER[(j & 3) * 4 + (i & 3)];

/** Deterministic pseudo-random number in `[0, 1)` for a 2D integer seed. */
export const h2 = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Smooth 2D value noise in `[0, 1)`. */
export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h2(xi, yi), h2(xi + 1, yi), u), lerp(h2(xi, yi + 1), h2(xi + 1, yi + 1), u), v);
}

/** Three octaves of {@link vnoise}. */
export const fbm = (x: number, y: number): number =>
  vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 3.7) * 0.15;

/** 2D context of an offscreen canvas the engine created itself; the field cannot draw without one. */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = canvas.getContext("2d");
  if (!g) throw new Error("LumeSec pixel engine: 2D canvas context unavailable");
  return g;
}

/** An offscreen canvas with one pixel per field cell, and the ImageData written into it. */
interface CellLayer {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  image: ImageData;
}

function createCellLayer(cols: number, rows: number): CellLayer {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const g = context2d(canvas);
  return { canvas, g, image: g.createImageData(cols, rows) };
}

/** A grid of cells drawn as fine square dots, with a separate glow buffer for bloom. */
export class Field {
  /** Requested pitch in CSS pixels; {@link Field.pitch} snaps it to whole device pixels. */
  readonly want: number;
  /** Dot size as a fraction of the pitch. */
  readonly dotF: number;
  /** Number of columns; 0 until the first {@link Field.resize}. */
  cols = 0;
  /** Number of rows; 0 until the first {@link Field.resize}. */
  rows = 0;
  /** Cell pitch in CSS pixels. */
  pitch: number;
  /** Device pixel ratio of the last resize (capped at 3). */
  dpr = 1;
  /** RGBA per cell, row-major; alpha is the brightness. Shown on the next {@link Field.draw}. */
  d: Uint8ClampedArray = new Uint8ClampedArray(0);
  /** RGBA per cell of the glow buffer that feeds the bloom pass. */
  gd: Uint8ClampedArray = new Uint8ClampedArray(0);
  private color: CellLayer | null = null;
  private glow: CellLayer | null = null;
  /**
   * the cells as last drawn, colour then glow, one 32-bit word per cell. {@link Field.draw} compares
   * against them and redraws only the region that changed.
   */
  private drawn: Uint32Array = new Uint32Array(0);
  /** The next draw covers the whole canvas: after a resize, or when the target context changed. */
  private stale = true;
  private drawnTarget: CanvasRenderingContext2D | null = null;
  /** The glow blurred at one pixel per cell, scaled up when drawn. */
  private blurred: CellLayer | null = null;
  private mask: HTMLCanvasElement | null = null;
  private pattern: CanvasPattern | null = null;
  private patternTarget: CanvasRenderingContext2D | null = null;

  /**
   * @param pitch cell pitch in CSS pixels
   * @param dot dot size as a fraction of the pitch
   */
  constructor(pitch = 2.5, dot = 0.66) {
    this.want = pitch;
    this.dotF = dot;
    this.pitch = pitch;
  }

  /** Rebuild the buffers for a `w`×`h` CSS-pixel canvas. Clears every cell. */
  resize(w: number, h: number): void {
    const dpr = pixelRatio();
    let devicePitch = Math.max(2, Math.round(this.want * dpr));
    // 1px dots on low-DPR screens read as grey; use 2px dots on a 3px pitch
    if (dpr < 1.5) devicePitch = Math.max(3, devicePitch);
    this.dpr = dpr;
    this.pitch = devicePitch / dpr;
    this.cols = Math.max(1, Math.ceil(w / this.pitch));
    this.rows = Math.max(1, Math.ceil(h / this.pitch));
    this.color = createCellLayer(this.cols, this.rows);
    this.d = this.color.image.data;
    this.glow = createCellLayer(this.cols, this.rows);
    this.gd = this.glow.image.data;
    this.drawn = new Uint32Array(this.cols * this.rows * 2);
    this.stale = true;
    this.blurred = createCellLayer(this.cols, this.rows);
    const mask = document.createElement("canvas");
    mask.width = devicePitch;
    mask.height = devicePitch;
    const dotSize = dpr < 1.5 ? devicePitch - 1 : Math.max(1, Math.round(devicePitch * this.dotF));
    const offset = Math.floor((devicePitch - dotSize) / 2);
    const mg = context2d(mask);
    mg.fillStyle = "#000";
    mg.fillRect(offset, offset, dotSize, dotSize);
    this.mask = mask;
    this.pattern = null;
    this.patternTarget = null;
  }

  /** Centre of cell `(i, j)` in CSS pixels. */
  xy(i: number, j: number): Point {
    return [(i + 0.5) * this.pitch, (j + 0.5) * this.pitch];
  }

  /** Cell containing the CSS-pixel position `(x, y)`. */
  ij(x: number, y: number): Point {
    return [Math.floor(x / this.pitch), Math.floor(y / this.pitch)];
  }

  /** Fill every cell with colour `c` at opacity `a` and clear the glow buffer. */
  base(c: RGB, a: number): void {
    const d = this.d;
    const alpha = clamp(a, 0, 1) * 255;
    for (let k = 0; k < d.length; k += 4) {
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = alpha;
    }
    this.gd.fill(0);
  }

  /** Turn every cell off. */
  clear(): void {
    this.d.fill(0);
    this.gd.fill(0);
  }

  /** Light a cell; a brighter write wins. glow (0..1) also feeds the bloom pass. */
  put(i: number, j: number, c: RGB, a: number, glow = 0): void {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows || a <= 0.004) return;
    const k = (j * this.cols + i) * 4;
    const d = this.d;
    const alpha = Math.min(255, a * 255);
    if (alpha >= (d[k + 3] ?? 0)) {
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = alpha;
    }
    if (glow > 0) {
      const gd = this.gd;
      const strength = Math.min(255, glow * 255);
      if (strength > (gd[k + 3] ?? 0)) {
        gd[k] = c[0];
        gd[k + 1] = c[1];
        gd[k + 2] = c[2];
        gd[k + 3] = strength;
      }
    }
  }

  /** {@link Field.put} for the cell under the CSS-pixel position `(x, y)`. */
  plot(x: number, y: number, c: RGB, a: number, glow?: number): void {
    this.put(Math.floor(x / this.pitch), Math.floor(y / this.pitch), c, a, glow);
  }

  /** Draw everything again on the next {@link Field.draw}, for a canvas that was cleared or drawn over. */
  invalidate(): void {
    this.stale = true;
  }

  /**
   * The cells that changed since the last draw, as `[i0, j0, i1, j1]` (inclusive), or null when none did. Records
   * the current cells as drawn.
   */
  private changed(): [number, number, number, number] | null {
    const cells = this.cols * this.rows;
    const color = new Uint32Array(this.d.buffer, this.d.byteOffset, cells);
    const glow = new Uint32Array(this.gd.buffer, this.gd.byteOffset, cells);
    const drawn = this.drawn;
    if (this.stale) {
      this.stale = false;
      drawn.set(color);
      drawn.set(glow, cells);
      return [0, 0, this.cols - 1, this.rows - 1];
    }
    let i0 = this.cols;
    let j0 = this.rows;
    let i1 = -1;
    let j1 = -1;
    for (let k = 0; k < cells; k++) {
      const c = color[k] ?? 0;
      const g = glow[k] ?? 0;
      if (c === drawn[k] && g === drawn[cells + k]) continue;
      drawn[k] = c;
      drawn[cells + k] = g;
      const j = (k / this.cols) | 0;
      const i = k - j * this.cols;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      j1 = j;
    }
    return i1 < 0 ? null : [i0, j0, i1, j1];
  }

  /**
   * Draw the cells into `g` as square dots, then the glow buffer blurred on top: added light on dark themes,
   * a soft wash on light ones. Only the region around the cells that changed since the last draw is
   * cleared and drawn again; a draw with no changed cell does nothing. The canvas must hold nothing but the field.
   */
  draw(g: CanvasRenderingContext2D, dark: boolean, bloom = 0.9, blur = 6): void {
    const color = this.color;
    const glow = this.glow;
    const blurred = this.blurred;
    const mask = this.mask;
    if (!this.cols || !color || !glow || !blurred || !mask) return;
    if (this.drawnTarget !== g) {
      this.drawnTarget = g;
      this.stale = true;
    }
    const region = this.changed();
    if (!region) return;
    const pitch = this.pitch;
    // a canvas blur is measured in device pixels, whatever the transform; in cells it is that over the device pitch
    const blurCells = blur / (pitch * this.dpr);
    // a changed glow cell lights the cells around it, as far as the blur reaches
    const reach = bloom > 0 ? Math.ceil(blurCells * 2.5) : 0;
    const i0 = Math.max(0, region[0] - reach);
    const j0 = Math.max(0, region[1] - reach);
    const i1 = Math.min(this.cols - 1, region[2] + reach);
    const j1 = Math.min(this.rows - 1, region[3] + reach);
    const ci = i1 - i0 + 1;
    const cj = j1 - j0 + 1;
    const x = i0 * pitch;
    const y = j0 * pitch;
    const w = ci * pitch;
    const h = cj * pitch;
    color.g.putImageData(color.image, 0, 0, i0, j0, ci, cj);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.globalAlpha = 1;
    g.clearRect(x, y, w, h);
    g.imageSmoothingEnabled = false;
    g.drawImage(color.canvas, i0, j0, ci, cj, x, y, w, h);
    if (this.patternTarget !== g) {
      this.pattern = g.createPattern(mask, "repeat");
      this.patternTarget = g;
      try {
        // the mask is drawn in device pixels while g is scaled to CSS pixels
        this.pattern?.setTransform(new DOMMatrix([1 / this.dpr, 0, 0, 1 / this.dpr, 0, 0]));
      } catch {
        // engines without CanvasPattern.setTransform keep the untransformed pattern
      }
    }
    g.globalCompositeOperation = "destination-in";
    if (this.pattern) g.fillStyle = this.pattern;
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = "source-over";
    if (bloom > 0) {
      // the blur inside the region also takes light from glow cells just outside it
      const gi0 = Math.max(0, i0 - reach);
      const gj0 = Math.max(0, j0 - reach);
      const gci = Math.min(this.cols, i1 + reach + 1) - gi0;
      const gcj = Math.min(this.rows, j1 + reach + 1) - gj0;
      glow.g.putImageData(glow.image, 0, 0, gi0, gj0, gci, gcj);
      // blur at one pixel per cell: the same light as a full-size blur, on a canvas pitch² times smaller
      const b = blurred.g;
      b.save();
      b.beginPath();
      b.rect(i0, j0, ci, cj);
      b.clip();
      b.clearRect(i0, j0, ci, cj);
      if ("filter" in b) b.filter = `blur(${blurCells}px)`;
      b.drawImage(glow.canvas, gi0, gj0, gci, gcj, gi0, gj0, gci, gcj);
      b.restore();
      g.imageSmoothingEnabled = true;
      g.globalCompositeOperation = dark ? "lighter" : "source-over";
      g.globalAlpha = dark ? bloom * 0.6 : bloom * 0.4;
      g.drawImage(blurred.canvas, i0, j0, ci, cj, x, y, w, h);
    }
    g.restore();
  }
}

/** Base for HD components: a PxBase whose canvas carries a Field. Subclasses use layout() instead of resized(). */
export class HF extends PxBase {
  /** The dot field covering the canvas. */
  readonly F: Field;
  /**
   * Whether {@link HF.flush} redraws only the cells that changed. An element that draws on its canvas
   * outside the field (sparks, text) sets it to false, and every flush clears and redraws the whole canvas.
   */
  protected partialFlush = true;

  /**
   * @param style component CSS
   * @param html shadow template, including a `canvas.px`
   * @param pitch dot pitch in CSS pixels
   * @param dot dot size as a fraction of the pitch
   */
  constructor(style: string, html: string, pitch = 2.5, dot = 0.66) {
    super(style, html);
    this.F = new Field(pitch, dot);
  }

  /** Called after the field was rebuilt for a new canvas size. */
  protected layout?(): void;

  protected override resized(): void {
    this.F.resize(this.w, this.h);
    this.layout?.();
  }

  /** Whether the current theme is dark. */
  get dark(): boolean {
    return isDark(this.P);
  }

  /**
   * Draw the field with bloom. With {@link HF.partialFlush} the field clears and redraws only the region that
   * changed, so a frame that changed nothing draws nothing.
   */
  flush(bloom = 0.9, blur = 6): void {
    const dark = this.dark;
    // a theme switch changes how the glow blends, even where the cells keep their colours
    if (dark !== this.drawnDark || !this.partialFlush) this.F.invalidate();
    this.drawnDark = dark;
    if (!this.partialFlush) this.clear();
    if (this.ctx) this.F.draw(this.ctx, dark, bloom, blur);
  }

  private drawnDark = false;
}

/** Two-digit zero-padded number (`7` → `"07"`). */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Distance from `(x, y)` to the segment from `(ax, ay)` to `(bx, by)`. */
export const segDist = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
  const vx = bx - ax;
  const vy = by - ay;
  const u = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  return Math.hypot(x - ax - vx * u, y - ay - vy * u);
};

/** Disc with halo and rim, the thumb used by several HD sliders. */
export function drawThumb(
  F: Field,
  P: Palette,
  dark: boolean,
  cx: number,
  cy: number,
  r: number,
  glow = 0,
  tint = 0,
): void {
  const pp = F.pitch;
  const white: RGB = [255, 255, 255];
  for (let j = Math.floor((cy - r - 4) / pp); j <= (cy + r + 4) / pp; j++) {
    for (let i = Math.floor((cx - r - 4) / pp); i <= (cx + r + 4) / pp; i++) {
      const [x, y] = F.xy(i, j);
      const d = Math.hypot(x - cx, y - cy);
      if (d > r + 3) continue;
      if (d > r) {
        F.put(i, j, P.surface, 1);
        continue;
      }
      const lit = 0.82 + 0.18 * clamp((-(x - cx) - (y - cy)) / r, -1, 1);
      const rim = d > r - 1.8;
      let col: RGB;
      if (!rim) col = mix(white, P.accent, (1 - lit) * 0.5 + tint * 0.15);
      else if (dark) col = mix(white, P.accent, 0.3 + tint * 0.5);
      else col = mix(P.fg, P.accent, 0.35 + tint * 0.5);
      F.put(i, j, col, 1, rim ? 0.15 + glow * 0.6 : 0.04);
    }
  }
}

/** Rounded-rect test in local coords. */
export const inRR = (lx: number, ly: number, w: number, h: number, r: number): number => {
  const qx = Math.max(r - lx, lx - (w - r), 0);
  const qy = Math.max(r - ly, ly - (h - r), 0);
  return Math.hypot(qx, qy) - r;
};

/** Down caret icon, 12px stroke SVG. */
export const CARET_SVG =
  '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Signed distance from `(x, y)` to a rounded box centred at `(cx, cy)` with half-size `(bx, by)` and radius `r`. */
export const rrSdf = (x: number, y: number, cx: number, cy: number, bx: number, by: number, r: number): number => {
  const qx = Math.abs(x - cx) - (bx - r);
  const qy = Math.abs(y - cy) - (by - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

/** Four-pointed star field around an offset `(dx, dy)` of size `s`; values below 1 are inside. */
export const sparkSdf = (dx: number, dy: number, s: number): number =>
  Math.pow(Math.abs(dx) / s, 0.7) + Math.pow(Math.abs(dy) / s, 0.7);
