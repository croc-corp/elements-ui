/**
 * <hf-kbd> · Shortcut keys
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/kbd
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-kbd.tsx.
 */
import { HF, define, escapeHtml, mix } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-kbd>`. */
export interface HKbdEventMap {
  /**
   * Fires when a keydown of one of the keys leaves the whole combination held. Auto-repeat keydowns do not fire it
   * again. `keys` is the raw attribute value, or `null` when the attribute is absent.
   */
  trigger: CustomEvent<{ keys: string | null }>;
}

// false on the server; the module is evaluated again in the browser
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Keycap text per lower-cased key name; other names show upper-cased. */
const KEY_LABEL: Readonly<Record<string, string>> = {
  mod: IS_MAC ? "⌘" : "Ctrl",
  ctrl: "Ctrl",
  cmd: "⌘",
  meta: "⌘",
  shift: "⇧",
  alt: IS_MAC ? "⌥" : "Alt",
  option: "⌥",
  enter: "↵",
  esc: "Esc",
  escape: "Esc",
  tab: "Tab",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  backspace: "⌫",
};

/** Height of a keycap in CSS pixels; the canvas is 3px taller so a held cap can sink. */
const CAP_H = 35;

/** Spoken name of each keycap symbol; screen readers announce the symbols themselves inconsistently. */
const SYMBOL_NAME: Readonly<Record<string, string>> = {
  "⌘": "Command",
  "⇧": "Shift",
  "⌥": "Option",
  "↵": "Enter",
  "↑": "Up",
  "↓": "Down",
  "←": "Left",
  "→": "Right",
  "⌫": "Backspace",
};

/** `KeyboardEvent.key` per lower-cased key name; other names are compared with the key directly. */
const KEY_MATCH: Readonly<Record<string, string>> = {
  mod: IS_MAC ? "Meta" : "Control",
  ctrl: "Control",
  cmd: "Meta",
  meta: "Meta",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  space: " ",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  backspace: "Backspace",
};

/**
 * Keycaps drawn in dots with their key names set in type; they press down while the real keys are held and fire
 * `trigger` when the whole combination is down.
 */
class HKbd extends HF {
  static observedAttributes = ["keys", "label"];

  /** Indices of the keys currently held. */
  private readonly down = new Set<number>();
  /** Glow per keycap, 1 while held, fading after release. */
  private glow: number[] = [];

  private readonly onDown = (e: KeyboardEvent): void => {
    const k = this.match(e.key);
    if (k == null) return;
    this.down.add(k);
    this.glow[k] = 1;
    this.syncCaps();
    if (!e.repeat && this.keys.every((_, i) => this.down.has(i))) {
      this.emit<{ keys: string | null }>("trigger", { keys: this.getAttribute("keys") });
    }
    this.kick();
  };

  private readonly onUp = (e: KeyboardEvent): void => {
    const k = this.match(e.key);
    if (k != null) this.down.delete(k);
    this.syncCaps();
    this.kick();
  };

  private readonly onBlur = (): void => {
    this.down.clear();
    this.syncCaps();
    this.kick();
  };

  constructor() {
    super(
      `
      :host { display: inline-flex; align-items: center; gap: 10px; vertical-align: middle; }
      .keys { position: relative; display: inline-flex; gap: 6px; margin: 0; font: inherit; }
      .keys canvas.px { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
      .cap {
        position: relative; min-width: 36px; height: 38px; padding: 0 11px 9px; display: grid; place-items: center;
        font: 600 13px/1 var(--_mono); color: var(--_fg); white-space: nowrap;
        transition: transform .08s ease-out, color .4s;
      }
      .cap.sym { font-size: 15px; }
      .cap[data-down] {
        transform: translateY(2px); color: color-mix(in srgb, var(--_accent) 55%, var(--_shine));
        transition: transform .05s, color .05s;
      }
      .lab { font-size: 13.5px; color: var(--_fg); }
      @media (prefers-reduced-motion: reduce) { .cap, .cap[data-down] { transition: none; } }
      `,
      `<kbd class="keys"><canvas class="px" aria-hidden="true"></canvas></kbd><span class="lab"></span>`,
      1.5,
      0.74,
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("keydown", this.onDown, true);
    document.addEventListener("keyup", this.onUp, true);
    window.addEventListener("blur", this.onBlur);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this.onDown, true);
    document.removeEventListener("keyup", this.onUp, true);
    window.removeEventListener("blur", this.onBlur);
  }

  /** The parsed combination. */
  get keys(): string[] {
    return (this.getAttribute("keys") || "Mod+K")
      .split("+")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Index of the combination key that `key` (a `KeyboardEvent.key`) presses, or null. */
  private match(key: string): number | null {
    const i = this.keys.findIndex((k) => {
      const expected = KEY_MATCH[k.toLowerCase()];
      return expected ? expected === key : k.toLowerCase() === String(key).toLowerCase();
    });
    return i < 0 ? null : i;
  }

  private capLabel(k: string): string {
    return KEY_LABEL[k.toLowerCase()] || k.toUpperCase();
  }

  /** Keycap markup: the label as text, with a spoken name in place of a symbol. */
  private capHtml(k: string): string {
    const label = this.capLabel(k);
    const spoken = SYMBOL_NAME[label];
    if (!spoken) return `<kbd class="cap">${escapeHtml(label)}</kbd>`;
    return `<kbd class="cap sym"><span aria-hidden="true">${escapeHtml(label)}</span><span class="sr">${spoken}</span></kbd>`;
  }

  /** The keycap elements, in combination order. */
  private get caps(): HTMLElement[] {
    return this.$$(".cap");
  }

  /** Mirror the held keys onto the keycap text, which sinks and tints with its cap. */
  private syncCaps(): void {
    this.caps.forEach((cap, idx) => cap.toggleAttribute("data-down", this.down.has(idx)));
  }

  attributeChangedCallback(name: string): void {
    // before the first connect, init() reads both attributes
    if (!this.initialized) return;
    if (name === "keys") this.renderCaps();
    else this.$(".lab").textContent = this.getAttribute("label") || "";
  }

  protected override init(): void {
    this.renderCaps();
    this.$(".lab").textContent = this.getAttribute("label") || "";
  }

  /** (Re)build the keycaps for `keys`; held keys are released. */
  private renderCaps(): void {
    this.caps.forEach((cap) => cap.remove());
    this.down.clear();
    this.glow = [];
    this.$(".keys").insertAdjacentHTML("beforeend", this.keys.map((k) => this.capHtml(k)).join(""));
    this.kick();
  }

  protected override render(_t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const pp = F.pitch;
    const R = F.rows;
    const top = mix(P.surface, P.fg, 0.04);
    const face = mix(P.raised, P.fg, 0.06);
    const shadow = mix(P.raised, P.fg, 0.22);
    let busy = false;
    F.clear();
    this.caps.forEach((cap, idx) => {
      const pressed = this.down.has(idx);
      this.glow[idx] = pressed ? 1 : Math.max(0, (this.glow[idx] || 0) - dt * 2.5);
      const glow = this.glow[idx];
      if (glow > 0 && !pressed) busy = true;
      // a held key sinks by 2px and shows less of its side; sizes are in CSS pixels so every DPR looks alike
      const sink = Math.round((pressed ? 2 : 0) / pp);
      const i0 = Math.round(cap.offsetLeft / pp);
      const i1 = Math.round((cap.offsetLeft + cap.offsetWidth) / pp);
      const W = i1 - i0;
      const H = Math.min(R, Math.floor(CAP_H / pp));
      const side = Math.round((pressed ? 3 : 6) / pp);
      const rim = Math.round(4.5 / pp);
      const radius = 4.5 / pp;
      for (let j = 0; j < R; j++) {
        for (let i = i0; i < i1; i++) {
          const li = i - i0;
          const lj = j - sink;
          if (lj < 0 || lj >= H) continue;
          // rounded corners
          const cx = Math.min(li, W - 1 - li);
          const cy = Math.min(lj, H - 1 - lj);
          if (cx < radius && cy < radius && Math.hypot(radius - cx, radius - cy) > radius + 0.2) continue;
          const bottom = lj >= H - side;
          let col = bottom ? shadow : lj < rim ? top : face;
          let cellGlow = 0;
          if (glow > 0 && !bottom) {
            col = mix(col, P.accent, glow * 0.22);
            cellGlow = glow * 0.12;
          }
          F.put(i, j, col, 1, cellGlow);
        }
      }
    });
    this.flush(0.9, 4);
    return busy;
  }
}

define("hf-kbd", HKbd);

declare global {
  interface HTMLElementTagNameMap {
    "hf-kbd": HKbd;
  }
}

export { HKbd };
