/**
 * <hf-modes> · Mode picker
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/modes
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-modes.tsx.
 */
import {
  DISABLED_CSS,
  FormMixin,
  HF,
  Sparks,
  TAU,
  bayer,
  boxMapper,
  checkRadio,
  define,
  fbm,
  h2,
  hsl,
  inRR,
  mix,
  radioKeys,
  reduced,
  segDist,
  sparkSdf,
  type LocalBox,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Mode id, the value of the `value` attribute. */
export type HModesValue = "chat" | "code" | "ultracode";

/** Events fired by `<hf-modes>`. */
export interface HModesEventMap {
  /** Fires when the user selects a different card. Not fired for programmatic changes. */
  change: CustomEvent<{ value: HModesValue }>;
}

/** A mode card. */
interface Mode {
  id: HModesValue;
  title: string;
  description: string;
  badge?: string;
}

/** Whether the point `(x, y)`, relative to the icon centre, is lit. */
type Icon = (x: number, y: number) => boolean;

const MODES: readonly Mode[] = [
  { id: "chat", title: "Chat", description: "Quick answers and back-and-forth." },
  { id: "code", title: "Code", description: "Reads, edits and runs your project." },
  { id: "ultracode", title: "Ultracode", description: "Plans multi-agent workflows on its own.", badge: "New" },
];

/** Index of Code, selected when `value` is missing or unknown on connect. */
const DEFAULT_MODE = 1;
/** Index of Ultracode, drawn in shifting hues. */
const ULTRA = 2;

const WHITE: RGB = [255, 255, 255];

/** Height of the illustration band at the top of each card. */
const BAND_H = 70;
const RADIUS = 12;

/** Speech bubble with three dots. */
const chatIcon: Icon = (x, y) => {
  const qx = Math.max(Math.abs(x) - 10, 0);
  const qy = Math.max(Math.abs(y + 2) - 6, 0);
  const sd = Math.hypot(qx, qy) - 4;
  const tail = y > 7 && y < 13 && x > -8 && x < -2 && x + 8 > (y - 7) * 0.9;
  const dot = [-6, 0, 6].some((cx) => Math.hypot(x - cx, y + 2) < 1.9);
  return (sd < 0 && sd > -2.2) || dot || (tail && sd > -2.2 && (x + 8 < (y - 7) * 0.9 + 2.4 || y > 11.5));
};

/** `</>` */
const codeIcon: Icon = (x, y) =>
  Math.min(
    segDist(x, y, -7, -8, -15, 0),
    segDist(x, y, -15, 0, -7, 8),
    segDist(x, y, 7, -8, 15, 0),
    segDist(x, y, 15, 0, 7, 8),
    segDist(x, y, 3, -10, -3, 10),
  ) < 1.5;

/** A large sparkle with two small ones. */
const ultraIcon: Icon = (x, y) =>
  sparkSdf(x + 2, y, 12) < 1 || sparkSdf(x - 12, y + 8, 5) < 1 || sparkSdf(x - 11, y - 9, 3.5) < 1;

const MODE_ICON: readonly Icon[] = [chatIcon, codeIcon, ultraIcon];

const indexOf = (id: string | null): number => MODES.findIndex((mode) => mode.id === id);

const cardHtml = (mode: Mode, k: number): string =>
  `<button type="button" role="radio" data-k="${k}" aria-checked="false"><span class="n">${mode.title}${mode.badge ? `<em>${mode.badge}</em>` : ""}</span><span class="d">${mode.description}</span></button>`;

/**
 * Three mode cards (Chat, Code, Ultracode) on one canvas; the selected card gets an aurora and a comet on its
 * border. Form-associated.
 */
class HModes extends FormMixin(HF) {
  static readonly observedAttributes = ["value"] as const;

  private sel = DEFAULT_MODE;
  /** Eased selection per card, 0 to 1. */
  private readonly s = [0, 0, 0];
  /** Eased hover per card, 0 to 1. */
  private readonly hv = [0, 0, 0];
  /** Index of the hovered card, or -1. */
  private hover = -1;
  private readonly sparks = new Sparks();
  /** Card boxes from the last frame; null before the first. */
  private rects: LocalBox[] | null = null;
  /** True while the element writes its own `value` attribute, so the change is not handled again. */
  private reflecting = false;
  /** Card selected on the first connect; form reset returns to it. */
  private defaultSel = DEFAULT_MODE;

  constructor() {
    super(
      `
      :host { display: block; }
      ${DISABLED_CSS}
      .g { position: relative; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
      canvas.px { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }
      button { position: relative; text-align: left; border: 1px solid var(--_border); background: var(--_raised); border-radius: 12px; padding: 84px 14px 14px; cursor: pointer; color: var(--_fg); font: inherit; transition: border-color .2s, transform .15s; }
      button:hover { border-color: color-mix(in srgb, var(--_accent) 40%, var(--_border)); }
      button:active { transform: scale(.985); }
      button[aria-checked="true"] { border-color: color-mix(in srgb, var(--_accent) 30%, transparent); }
      button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
      .n { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; }
      .n em { font-style: normal; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 6px; border-radius: 5px; background: color-mix(in srgb, var(--_accent) 16%, transparent); color: var(--_accent); }
      .d { display: block; font-size: 12.5px; color: var(--_muted); margin-top: 3px; line-height: 1.35; }
      `,
      `<div class="g" role="radiogroup" aria-label="Mode"><canvas class="px" aria-hidden="true"></canvas>${MODES.map(cardHtml).join("")}</div>`,
      2,
      0.72,
    );
    for (const button of this.cards) {
      const k = Number(button.dataset.k);
      button.addEventListener("click", () => this.select(k, true));
      button.addEventListener("pointerenter", () => {
        this.hover = k;
        this.kick();
      });
      button.addEventListener("pointerleave", () => {
        if (this.hover === k) this.hover = -1;
        this.kick();
      });
    }
    radioKeys(
      this.$(".g"),
      () => this.cards,
      () => this.sel,
      (index) => this.select(index, true),
    );
  }

  /** Selected mode id. Setting it writes the attribute. */
  get value(): HModesValue {
    return MODES[this.sel].id;
  }

  set value(value: HModesValue) {
    this.setAttribute("value", value);
  }

  protected override init(): void {
    const i = indexOf(this.getAttribute("value"));
    this.sel = i < 0 ? DEFAULT_MODE : i;
    this.defaultSel = this.sel;
    this.s[this.sel] = 1;
    this.sync();
  }

  /** Returns to the mode selected on the first connect, without firing `change`. */
  formResetCallback(): void {
    this.select(this.defaultSel, false);
  }

  /** Disables the cards while the element or its fieldset is disabled. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    for (const button of this.cards) button.disabled = disabled;
  }

  attributeChangedCallback(): void {
    if (!this.initialized || this.reflecting) return;
    const i = indexOf(this.getAttribute("value"));
    if (i >= 0) this.select(i, false);
  }

  private get cards(): HTMLButtonElement[] {
    return this.$$("button");
  }

  private select(k: number, user: boolean): void {
    if (k === this.sel) return;
    this.sel = k;
    this.sync();
    if (k === ULTRA && this.rects) {
      const r = this.rects[ULTRA];
      const P = this.P;
      this.sparks.add(r.x + 34, r.y + 40, 30, [P.accent, P.shine, WHITE], { speed: [40, 190], life: [0.35, 0.8] });
    }
    if (user) this.emit<{ value: HModesValue }>("change", { value: this.value });
  }

  private sync(): void {
    checkRadio(this.cards, this.sel);
    this.reflecting = true;
    this.setAttribute("value", this.value);
    this.reflecting = false;
    this.setFormValue(this.value);
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    // the canvas covers the grid, so the cards are measured in the grid's CSS pixels
    const local = boxMapper(this.$(".g"));
    const pp = F.pitch;
    const dark = this.dark;
    const rects = this.cards.map((button) => local(button));
    this.rects = rects;
    F.clear();
    rects.forEach((r, k) => {
      this.s[k] += ((k === this.sel ? 1 : 0) - this.s[k]) * Math.min(1, reducedMotion ? 1 : dt * 6);
      this.hv[k] += ((k === this.hover ? 1 : 0) - this.hv[k]) * Math.min(1, dt * 10);
      const s = this.s[k];
      const hv = this.hv[k];
      const ultra = k === ULTRA;
      const i0 = Math.floor(r.x / pp);
      const i1 = Math.ceil((r.x + r.w) / pp);
      const j0 = Math.floor(r.y / pp);
      const j1 = Math.ceil((r.y + r.h) / pp);
      // position of the border comet, 0 to 1 around the card; -1 hides it
      const head = reducedMotion ? -1 : (t * 0.28 + k * 0.33) % 1;
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          const [x, y] = F.xy(i, j);
          const lx = x - r.x;
          const ly = y - r.y;
          const sd = inRR(lx, ly, r.w, r.h, RADIUS);
          if (sd > 0.6) continue;
          // border comet on the selected card
          if (sd > -1.6 && s > 0.02) {
            const a = (Math.atan2(ly - r.h / 2, (lx - r.w / 2) * (r.h / r.w)) / TAU + 1.25) % 1;
            let dd = Math.abs(a - head);
            dd = Math.min(dd, 1 - dd);
            const comet = head < 0 ? 0 : Math.exp(-(dd * dd) / 0.0018);
            const base = ultra ? hsl(260 + a * 360, 0.75, dark ? 0.68 : 0.5) : P.accent;
            F.put(i, j, mix(base, P.shine, comet * 0.6), (0.45 + comet * 0.55) * s, comet * s);
            continue;
          }
          if (ly > BAND_H || sd > -1) continue;
          // illustration band
          const ix = lx - 34;
          const iy = ly - 38;
          if (Math.abs(ix) < 18 && Math.abs(iy) < 16 && MODE_ICON[k](ix, iy)) {
            const ic = s > 0.5 ? (dark ? WHITE : mix(P.accent, P.fg, 0.2)) : mix(P.muted, P.fg, hv * 0.6);
            F.put(i, j, ultra && s > 0.5 ? mix(ic, P.shine, 0.2 + 0.2 * Math.sin(t * 3)) : ic, 1, s * 0.7);
            continue;
          }
          const fade = 1 - ly / BAND_H;
          const n = fbm(lx * 0.022 + t * 0.12 * (k + 1), ly * 0.05 - t * 0.18 + k * 3);
          const dens = s * (0.12 + 0.62 * n * fade) * (lx > 60 ? 1 : 0.55) + (1 - s) * (0.05 + 0.06 * hv) * fade;
          if (bayer(i, j) >= dens) continue;
          if (s > 0.02) {
            const col = ultra ? hsl(250 + n * 110 + t * 25, 0.72, dark ? 0.62 : 0.55) : mix(P.accent, P.shine, n * 0.5);
            F.put(i, j, col, 0.35 + 0.55 * s * fade, s * n * fade * (ultra ? 0.7 : 0.35));
          } else {
            F.put(i, j, P.muted, 0.4, s * n * fade * (ultra ? 0.7 : 0.35));
          }
          // rare twinkles in the Ultracode aurora
          if (ultra && s > 0.5 && h2(i, j + Math.floor(t * 3)) > 0.996) F.put(i, j, WHITE, 1, 1);
        }
      }
    });
    this.flush(0.85, 5);
    const sparking = this.sparks.step(ctx, dt);
    return !reducedMotion || sparking || this.s.some((v, k) => Math.abs(v - (k === this.sel ? 1 : 0)) > 0.01);
  }
}

define("hf-modes", HModes);

declare global {
  interface HTMLElementTagNameMap {
    "hf-modes": HModes;
  }
}

export { HModes };
