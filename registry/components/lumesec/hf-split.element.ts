/**
 * <hf-split> · Split button
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/split
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-split.tsx.
 */
import {
  CARET_SVG,
  HF,
  bayer,
  clamp,
  define,
  escapeHtml,
  fbm,
  inRR,
  localPoint,
  mix,
  now,
  reduced,
  rollText,
  segDist,
  type Point,
} from "@/lib/lumesec/pixel";

/** A parsed `Label|Description` entry of the `items` attribute. */
export interface HSplitItem {
  label: string;
  /** Second line in the menu; empty when not given. */
  desc: string;
}

/** Events fired by `<hf-split>`. */
export interface HSplitEventMap {
  /** Fires when the main button is clicked. `value` is the selected item's label. */
  action: CustomEvent<{ value: string }>;
  /** Fires when an item is chosen from the menu. `value` is its label. */
  select: CustomEvent<{ value: string }>;
}

/** A press ripple in button coordinates. */
interface Ripple {
  x: number;
  y: number;
  t0: number;
}

const DEFAULT_ITEMS =
  "Deploy to production|Ships to everyone after checks;Deploy to staging|Internal testers only;Create preview|A unique URL for this branch;Schedule deploy…|Pick a time tonight";

/** Height of the button row in pixels. */
const BUTTON_H = 46;
/** The canvas overhangs the button by this much on every side, for the glow. */
const OVERHANG = 12;
/** Seconds a ripple lasts. */
const RIPPLE_LIFE = 0.7;

/** Distance from `(lx, ly)` to the check mark at the left of a menu item `h` pixels tall. */
const checkDist = (lx: number, ly: number, h: number): number =>
  Math.min(segDist(lx, ly, 10, h / 2, 13, h / 2 + 3), segDist(lx, ly, 13, h / 2 + 3, 19, h / 2 - 4));

/** Split button with a primary action and a menu of alternatives; choosing an item rolls its label into the button. */
class HSplit extends HF {
  static readonly observedAttributes = ["items", "menu-label"] as const;

  /** Index of the selected item. */
  private sel = 0;
  /** Index of the highlighted menu item. */
  private hi = 0;
  /** Spring position and velocity of the highlight slab, in pixels from the top of the menu. */
  private hy = 0;
  private vy = 0;
  /** Time the menu opened. */
  private openT = -9;
  /** Pointer position over the button; null when it is outside. */
  private ptr: Point | null = null;
  /** Eased 0–1 hover amount. */
  private hov = 0;
  private rip: Ripple[] = [];
  /** Whether the canvas got its first size. */
  private sized = false;
  /** The menu items, as built from `items` on connect and on each change. */
  private menuItems: HSplitItem[] = [];

  /** Closes the menu on a press outside the element. */
  private readonly onDoc = (e: PointerEvent): void => {
    if (this.hasAttribute("open") && !e.composedPath().includes(this)) this.toggle(false);
  };

  constructor() {
    super(
      `
      :host { display: inline-block; position: relative; z-index: 1; vertical-align: middle; }
      /* the host is the stacking context: the canvas draws above the menu's background, the items' text above the canvas */
      .w { position: relative; }
      canvas.px { position: absolute; left: -12px; top: -12px; width: calc(100% + 24px); height: 72px; pointer-events: none; z-index: 2; }
      .bt { position: relative; display: flex; height: 46px; border-radius: 12px; overflow: hidden; background: color-mix(in srgb, var(--_accent) 32%, #0b0a12); }
      .main { position: relative; z-index: 3; border: 0; background: none; color: #fff; font-weight: 600; font-size: 14px; padding: 0 20px; cursor: pointer; display: grid; place-items: center; min-width: 200px; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
      .car { position: relative; z-index: 3; border: 0; background: none; color: #fff; width: 44px; cursor: pointer; display: grid; place-items: center; border-left: 1px solid rgba(255,255,255,.16); }
      .car svg { transition: transform .25s; }
      :host([open]) .car svg { transform: rotate(180deg); }
      .main:focus-visible, .car:focus-visible { outline: 2px solid #fff; outline-offset: -4px; border-radius: 9px; }
      .menu { position: absolute; top: calc(100% + 8px); left: 0; min-width: 100%; width: max-content; max-width: 320px; border-radius: 12px; border: 1px solid var(--_border); background: var(--_surface); padding: 6px; box-shadow: 0 18px 40px -14px rgba(0,0,0,.4); }
      .it { position: relative; z-index: 3; display: grid; gap: 1px; width: 100%; text-align: left; border: 0; background: none; padding: 8px 10px 8px 30px; border-radius: 8px; cursor: pointer; color: var(--_fg); }
      .it b { font-size: 13px; font-weight: 600; }
      .it span { font-size: 12px; color: var(--_muted); }
      .it:focus-visible { outline: none; }
      `,
      `<div class="w"><canvas class="px" aria-hidden="true"></canvas><div class="bt"><button class="main" type="button"><span class="rollslot l"></span></button><button class="car" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="menu">${CARET_SVG}</button></div><div class="menu" id="menu" role="menu" hidden></div></div>`,
      2,
      0.74,
    );
    const buttons = this.$(".bt");
    buttons.addEventListener("pointermove", (e) => {
      this.ptr = localPoint(buttons, e);
      this.kick();
    });
    buttons.addEventListener("pointerleave", () => {
      this.ptr = null;
      this.kick();
    });
    buttons.addEventListener("pointerdown", (e) => {
      const [x, y] = localPoint(buttons, e);
      this.rip.push({ x, y, t0: now() });
      this.kick();
    });
    this.$(".main").addEventListener("click", () => {
      this.emit<{ value: string }>("action", { value: this.menuItems[this.sel].label });
    });
    const caret = this.$(".car");
    caret.addEventListener("click", () => this.toggle());
    caret.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.toggle(true);
      }
    });
    this.$(".menu").addEventListener("keydown", (e) => {
      const n = this.$$(".it").length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.focusItem((this.hi + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        this.focusItem(e.key === "Home" ? 0 : n - 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.toggle(false);
        caret.focus();
      } else if (e.key === "Tab") this.toggle(false);
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.onDoc);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.onDoc);
  }

  /** The parsed `items`; entries without a label are skipped. */
  get items(): HSplitItem[] {
    const parse = (text: string): HSplitItem[] =>
      text
        .split(";")
        .map((entry) => {
          const [label = "", desc = ""] = entry.split("|");
          return { label: label.trim(), desc: desc.trim() };
        })
        .filter((item) => item.label !== "");
    const items = parse(this.getAttribute("items") || "");
    return items.length ? items : parse(DEFAULT_ITEMS);
  }

  protected override init(): void {
    this.build();
  }

  attributeChangedCallback(name: string): void {
    if (!this.initialized) return;
    if (name === "items") this.build();
    else this.syncMenuLabel();
  }

  /** (Re)build the menu from `items`; the selection stays on the same label when it still exists. */
  private build(): void {
    const previous = this.menuItems[this.sel]?.label;
    this.menuItems = this.items;
    this.sel = Math.max(
      0,
      this.menuItems.findIndex((item) => item.label === previous),
    );
    if (this.hasAttribute("open")) this.toggle(false);
    this.$(".menu").innerHTML = this.menuItems
      .map(
        (item, k) =>
          `<button class="it" type="button" role="menuitemradio" aria-checked="${k === this.sel}" data-k="${k}" tabindex="-1"><b>${escapeHtml(item.label)}</b>${item.desc ? `<span>${escapeHtml(item.desc)}</span>` : ""}</button>`,
      )
      .join("");
    this.$$(".it").forEach((button) => {
      button.addEventListener("pointerenter", () => {
        this.hi = Number(button.dataset.k);
        this.kick();
      });
      button.addEventListener("click", () => this.choose(Number(button.dataset.k)));
    });
    rollText(this.$(".l"), this.menuItems[this.sel].label, 1, false);
    this.syncMenuLabel();
  }

  /** The caret button's accessible name, from `menu-label`. */
  private syncMenuLabel(): void {
    this.$(".car").setAttribute("aria-label", this.getAttribute("menu-label") || "More options");
  }

  private focusItem(k: number): void {
    this.hi = k;
    this.$$(".it")[k].focus();
    this.kick();
  }

  /** Opens or closes the menu: `true` opens, `false` closes, no argument toggles. Opening focuses the selected item. */
  toggle(force?: boolean): void {
    const open = force ?? !this.hasAttribute("open");
    this.toggleAttribute("open", open);
    this.$(".menu").hidden = !open;
    this.$(".car").setAttribute("aria-expanded", String(open));
    if (open) {
      this.openT = now();
      this.hi = this.sel;
      const item: HTMLElement | undefined = this.$$(".it")[this.hi];
      this.hy = item ? item.offsetTop : 0;
      this.vy = 0;
      requestAnimationFrame(() => this.focusItem(this.hi));
    }
    this.resizeCanvas();
    this.kick();
  }

  /** Grow the canvas over the open menu so the highlight can be drawn there. */
  private resizeCanvas(): void {
    const canvas = this.cv;
    if (!canvas) return;
    const open = this.hasAttribute("open");
    const menu = this.$(".menu");
    const W = Math.max(this.$(".bt").offsetWidth, open ? menu.offsetWidth : 0);
    canvas.style.width = `${W + 2 * OVERHANG}px`;
    canvas.style.height = `${open ? BUTTON_H + 8 + menu.offsetHeight + 2 * OVERHANG : BUTTON_H + 2 * OVERHANG}px`;
  }

  private choose(k: number): void {
    const prev = this.sel;
    this.sel = k;
    this.$$(".it").forEach((button, i) => button.setAttribute("aria-checked", String(i === k)));
    rollText(this.$(".l"), this.menuItems[k].label, k > prev ? 1 : -1, true);
    this.toggle(false);
    this.$(".car").focus();
    this.emit<{ value: string }>("select", { value: this.menuItems[k].label });
    this.rip.push({ x: 100, y: 23, t0: now() });
  }

  protected override layout(): void {
    if (!this.sized) {
      this.sized = true;
      this.resizeCanvas();
    }
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const pitch = F.pitch;
    const ox = OVERHANG;
    const oy = OVERHANG;
    const bw = this.$(".bt").offsetWidth;
    const bh = BUTTON_H;
    // the noise holds still under reduced motion
    const ft = reducedMotion ? 0 : t;
    const open = this.hasAttribute("open");
    const ptr = this.ptr;
    this.hov += ((ptr ? 1 : 0) - this.hov) * Math.min(1, dt * 8);
    this.rip = this.rip.filter((r) => t - r.t0 < RIPPLE_LIFE);
    F.clear();
    for (let j = Math.floor(oy / pitch); j < (oy + bh) / pitch; j++) {
      for (let i = Math.floor(ox / pitch); i < (ox + bw) / pitch; i++) {
        const [x, y] = F.xy(i, j);
        const lx = x - ox;
        const ly = y - oy;
        if (inRR(lx, ly, bw, bh, 12) > 0) continue;
        let L = 0.3 + 0.18 * fbm(lx * 0.035 + ft * 0.15, ly * 0.07);
        if (ptr) {
          const dx = lx - ptr[0];
          const dy = ly - ptr[1];
          L += 0.36 * this.hov * Math.exp(-(dx * dx + dy * dy) / 2400);
        }
        for (const r of this.rip) {
          const age = t - r.t0;
          const d = Math.hypot(lx - r.x, ly - r.y);
          L += Math.exp(-((d - age * 330) ** 2) / 90) * (1 - age / RIPPLE_LIFE) * 0.8;
        }
        // the caret part lights up while the menu is open
        if (open && lx > bw - 44) L += 0.12;
        // top highlight
        if (ly < 2) L += 0.12;
        L = clamp(L, 0, 1.2);
        F.put(i, j, mix(P.accent, P.shine, clamp(L - 0.45, 0, 1) * 0.55), Math.min(1, L), Math.max(0, L - 0.6) * 0.8);
      }
    }
    let busy = !reducedMotion || this.rip.length > 0;
    if (open) {
      const menu = this.$(".menu");
      const mx = ox + menu.offsetLeft;
      const my = oy + menu.offsetTop;
      const items = this.$$(".it");
      const target: HTMLElement | undefined = items[this.hi];
      const ty = target ? target.offsetTop : 0;
      const th = target ? target.offsetHeight : 40;
      if (reducedMotion) {
        this.hy = ty;
        this.vy = 0;
      } else {
        const k = 420;
        const damping = 2 * Math.sqrt(k) * 0.8;
        this.vy += (k * (ty - this.hy) - damping * this.vy) * dt;
        this.hy += this.vy * dt;
      }
      if (Math.abs(ty - this.hy) > 0.3) busy = true;
      const age = t - this.openT;
      items.forEach((item, k) => {
        const x0 = mx + item.offsetLeft;
        const y0 = my + item.offsetTop;
        const w = item.offsetWidth;
        const h = item.offsetHeight;
        // items wipe in one after another
        const e = reducedMotion ? 1 : clamp((age - k * 0.05) / 0.25, 0, 1);
        if (e < 1) busy = true;
        for (let j = Math.floor(y0 / pitch); j < (y0 + h) / pitch; j++) {
          for (let i = Math.floor(x0 / pitch); i < (x0 + w) / pitch; i++) {
            const [x, y] = F.xy(i, j);
            const lx = x - x0;
            const ly = y - y0;
            if (e < 1 && lx / w < e && lx / w > e - 0.25 && bayer(i, j) < 0.5)
              F.put(i, j, P.accent, 0.5 * (1 - e), 0.3);
            // check mark for the current choice
            if (k === this.sel && checkDist(lx, ly, h) < 1.3) F.put(i, j, P.accent, e, 0.4);
          }
        }
      });
      // highlight slab
      const x0 = mx + 6;
      const w = menu.offsetWidth - 12;
      const y0 = my + this.hy;
      for (let j = Math.floor(y0 / pitch); j < (y0 + th) / pitch; j++) {
        for (let i = Math.floor(x0 / pitch); i < (x0 + w) / pitch; i++) {
          const [x, y] = F.xy(i, j);
          const lx = x - x0;
          const ly = y - y0;
          if (inRR(lx, ly, w, th, 8) > 0) continue;
          const bar = lx < 3;
          if (!bar && bayer(i, j) > 0.3) continue;
          F.put(i, j, bar ? mix(P.accent, P.shine, 0.3) : mix(P.accent, P.surface, 0.55), bar ? 1 : 0.7, bar ? 0.6 : 0);
        }
      }
    }
    this.flush(0.8, 5);
    return busy;
  }
}

define("hf-split", HSplit);

declare global {
  interface HTMLElementTagNameMap {
    "hf-split": HSplit;
  }
}

export { HSplit };
