/**
 * <hf-pin> · PIN pad
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/pin
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-pin.tsx.
 */
import {
  HF,
  bayer,
  boxMapper,
  clamp,
  define,
  h2,
  localPoint,
  mix,
  now,
  reduced,
  rollText,
  shake,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-pin>`. */
export interface HPinEventMap {
  /** Fires when the entered digits match `code`. */
  unlock: CustomEvent<Record<string, never>>;
  /**
   * Fires on a wrong PIN. `tries` is the number of attempts left: 2, 1, then 0. Does not bubble and is not composed:
   * listen on the element itself.
   */
  error: CustomEvent<{ tries: number }>;
}

/** Result of the last check; empty while entering. */
type PinState = "" | "ok" | "err";

/** A key press ripple, in coordinates of the pad. */
interface Ripple {
  x: number;
  y: number;
  t0: number;
  /** The key it belongs to. */
  el: HTMLElement;
}

/** The keypad: key and the letters under it. */
const KEYS: readonly (readonly [key: string, letters: string])[] = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["clr", ""],
  ["0", ""],
  ["del", ""],
];

const DELETE_ICON =
  '<svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true"><path d="M7 1h13v14H7L1 8z M11 5l6 6M17 5l-6 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';

function keyButton(key: string, letters: string): string {
  if (key === "clr") return '<button class="k fn" type="button" data-k="clr">Clear</button>';
  if (key === "del")
    return `<button class="k fn" type="button" data-k="del" aria-label="Delete">${DELETE_ICON}</button>`;
  return `<button class="k" type="button" data-k="${key}">${key}<small>${letters || "&nbsp;"}</small></button>`;
}

const WHITE: RGB = [255, 255, 255];

/** Seconds a key ripple lasts. */
const RIPPLE_LIFE = 0.55;

/**
 * Numeric PIN pad with rippling keys and dot feedback: a wrong code shakes into red static, the right one sends a
 * green wave.
 */
class HPin extends HF {
  /** Digits entered so far. */
  private ent = "";
  private state: PinState = "";
  /** Time of the last check result. */
  private t0 = -9;
  /** Time each dot was filled, for its pop. */
  private pops: number[] = [];
  private rip: Ripple[] = [];
  /** Attempts left before the counter resets. */
  private tries = 3;
  /** Pending check of a complete entry. */
  private checkTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: inline-block; }
      .w { position: relative; width: 236px; outline: none; }
      canvas.px { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
      .t { position: relative; display: block; text-align: center; font-size: 14px; font-weight: 600; }
      .s { position: relative; display: grid; justify-items: center; font-size: 12px; color: var(--_muted); margin-top: 2px; }
      .dots { position: relative; height: 36px; margin: 10px 0 14px; }
      .kp { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
      .k { position: relative; height: 56px; border: 0; border-radius: 16px; background: transparent; font-weight: 500; font-size: 22px; color: var(--_fg); cursor: pointer; display: grid; place-content: center; justify-items: center; line-height: 1.1; transition: transform .12s; }
      .k:active { transform: scale(.94); }
      .k small { font-size: 8.5px; letter-spacing: .16em; color: var(--_muted); font-weight: 600; }
      .k.fn { font-size: 13px; font-weight: 500; color: var(--_muted); }
      `,
      `<div class="w" tabindex="0" role="group" aria-label="PIN entry"><canvas class="px" aria-hidden="true"></canvas><span class="t"></span><span class="rollslot s" aria-live="polite"></span><div class="dots" role="img"></div>
        <div class="kp">${KEYS.map(([key, letters]) => keyButton(key, letters)).join("")}</div></div>`,
      2,
      0.72,
    );
    const pad = this.$(".w");
    this.$$(".k").forEach((key) => {
      key.addEventListener("pointerdown", (e) => {
        const [x, y] = localPoint(pad, e);
        this.rip.push({ x, y, t0: now(), el: key });
        this.kick();
      });
      key.addEventListener("click", () => this.press(key.dataset.k ?? ""));
    });
    pad.addEventListener("keydown", (e) => {
      if (/^\d$/.test(e.key)) {
        this.press(e.key);
        this.flashKey(e.key);
      } else if (e.key === "Backspace") {
        this.press("del");
        this.flashKey("del");
      } else if (e.key === "Escape") this.press("clr");
    });
  }

  /** The `code` attribute, or `2468`. */
  get code(): string {
    return this.getAttribute("code") || "2468";
  }

  private get hintText(): string {
    return this.getAttribute("hint") || `${this.code.length} digits`;
  }

  protected override init(): void {
    this.$(".t").textContent = this.getAttribute("label") || "Enter your PIN";
    rollText(this.$(".s"), this.hintText, 1, false);
    this.$(".dots").setAttribute("aria-label", `0 of ${this.code.length} digits entered`);
  }

  /** Ripple key `k` from its centre, for keyboard input. */
  private flashKey(k: string): void {
    const key = this.root.querySelector<HTMLElement>(`.k[data-k="${k}"]`);
    if (!key) return;
    const r = boxMapper(this.$(".w"))(key);
    this.rip.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, t0: now(), el: key });
    this.kick();
  }

  /** Handle a digit, `clr` or `del`. Ignored while a result is shown. */
  private press(k: string): void {
    if (this.state === "ok" || this.state === "err") return;
    if (k === "clr") this.ent = "";
    else if (k === "del") this.ent = this.ent.slice(0, -1);
    else if (this.ent.length < this.code.length) {
      this.ent += k;
      this.pops[this.ent.length - 1] = now();
    }
    this.$(".dots").setAttribute("aria-label", `${this.ent.length} of ${this.code.length} digits entered`);
    // one check per complete entry; a delete or clear in the 160 ms before it cancels it
    clearTimeout(this.checkTimer);
    if (this.ent.length === this.code.length) this.checkTimer = setTimeout(() => this.check(), 160);
    this.kick();
  }

  private check(): void {
    if (this.state || this.ent.length !== this.code.length) return;
    if (this.ent === this.code) {
      this.state = "ok";
      this.t0 = now();
      rollText(this.$(".s"), this.getAttribute("success") || "Unlocked", 1, true);
      this.emit("unlock");
      setTimeout(() => {
        this.state = "";
        this.ent = "";
        this.tries = 3;
        rollText(this.$(".s"), this.hintText, -1, true);
        this.kick();
      }, 2400);
    } else {
      this.state = "err";
      this.t0 = now();
      this.tries = Math.max(0, this.tries - 1);
      shake(this.$(".dots"));
      const status = this.tries
        ? `Wrong PIN · ${this.tries} ${this.tries === 1 ? "try" : "tries"} left`
        : "Too many attempts · try again later";
      rollText(this.$(".s"), status, 1, true);
      // stays on the element so global error handlers do not see it
      this.emit<{ tries: number }>("error", { tries: this.tries }, { bubbles: false, composed: false });
      setTimeout(() => {
        this.state = "";
        this.ent = "";
        if (!this.tries) this.tries = 3;
        this.kick();
      }, 900);
    }
    this.kick();
  }

  protected override render(t: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const pitch = F.pitch;
    const n = this.code.length;
    const age = t - this.t0;
    let busy = this.state !== "";
    const local = boxMapper(this.$(".w"));
    F.clear();
    // keys
    this.rip = this.rip.filter((r) => t - r.t0 < RIPPLE_LIFE);
    for (const key of this.$$(".k")) {
      const { x: x0, y: y0, w, h } = local(key);
      const rr = 16;
      const fn = key.classList.contains("fn");
      const ripples = this.rip.filter((q) => q.el === key);
      for (let j = Math.floor(y0 / pitch); j < (y0 + h) / pitch; j++) {
        for (let i = Math.floor(x0 / pitch); i < (x0 + w) / pitch; i++) {
          const [x, y] = F.xy(i, j);
          const lx = x - x0;
          const ly = y - y0;
          const qx = Math.max(rr - lx, lx - (w - rr), 0);
          const qy = Math.max(rr - ly, ly - (h - rr), 0);
          if (Math.hypot(qx, qy) > rr) continue;
          // a ring travelling out from the press plus a glow around it
          let L = 0;
          for (const q of ripples) {
            const a2 = t - q.t0;
            const d = Math.hypot(x - q.x, y - q.y);
            const fade = 1 - a2 / RIPPLE_LIFE;
            L += Math.exp(-((d - a2 * 150) ** 2) / 40) * fade + Math.exp(-(d * d) / 300) * fade * 0.5;
          }
          if (fn && L < 0.05) continue;
          if (L > 0.05) F.put(i, j, mix(P.accent, P.shine, clamp(L, 0, 1) * 0.5), clamp(0.3 + L, 0, 1), L * 0.6);
          else if (bayer(i, j) < 0.5) F.put(i, j, mix(P.raised, P.fg, this.dark ? 0.06 : 0.04), 1);
        }
      }
      if (ripples.length) busy = true;
    }
    // dots
    const dr = local(this.$(".dots"));
    const cy = dr.y + dr.h / 2;
    const gap = 30;
    const x0 = this.$(".w").offsetWidth / 2 - ((n - 1) * gap) / 2;
    const ok = this.state === "ok";
    const err = this.state === "err";
    for (let k = 0; k < n; k++) {
      const filled = k < this.ent.length;
      const pop = filled && !reducedMotion ? Math.exp(-(t - (this.pops[k] || 0)) * 9) : 0;
      const rad = 7 + pop * 4;
      if (pop > 0.01) busy = true;
      // success lifts the dots in a wave; an error shakes them
      const wave = ok ? Math.max(0, Math.sin(clamp(age * 6 - k * 0.6, 0, Math.PI))) : 0;
      const shakeX = err && !reducedMotion ? Math.sin(age * 40) * 4 * Math.max(0, 1 - age * 2) : 0;
      const cx = x0 + k * gap + shakeX;
      const dotY = cy - wave * 6;
      for (let j = Math.floor((dotY - 14) / pitch); j <= (dotY + 14) / pitch; j++) {
        for (let i = Math.floor((cx - 14) / pitch); i <= (cx + 14) / pitch; i++) {
          const [x, y] = F.xy(i, j);
          const d = Math.hypot(x - cx, y - dotY);
          if (d > rad) continue;
          if (!filled && !ok) {
            if (d > rad - 1.8) F.put(i, j, P.muted, 0.75);
            continue;
          }
          const c = ok ? P.ok : err ? P.danger : P.accent;
          if (err && h2(i, j + Math.floor(t * 30)) < 0.3) continue;
          F.put(i, j, mix(c, WHITE, (1 - d / rad) * 0.35 + pop * 0.3), 1, 0.35 + pop * 0.6 + wave * 0.5);
        }
      }
    }
    this.flush(0.85, 5);
    return busy;
  }
}

define("hf-pin", HPin);

declare global {
  interface HTMLElementTagNameMap {
    "hf-pin": HPin;
  }
}

export { HPin };
