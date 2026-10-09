/**
 * <px-secret> · Secret field
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/secret
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-secret.tsx.
 */
import { PxBase, clamp, define, hash, mix, reduced, rollText, smooth } from "@/lib/lumesec/pixel";

/** Inner SVG of the eye icon (reveal). */
const EYE =
  '<path d="M1.5 8s2.4-4.6 6.5-4.6S14.5 8 14.5 8s-2.4 4.6-6.5 4.6S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>';

/** Inner SVG of the crossed-out eye icon (hide). */
const EYE_OFF =
  '<path d="M2.5 2.5l11 11M6.6 3.6A6.6 6.6 0 0 1 8 3.4c4.1 0 6.5 4.6 6.5 4.6a11 11 0 0 1-1.9 2.5M4.3 5.2A10.5 10.5 0 0 0 1.5 8s2.4 4.6 6.5 4.6a6.3 6.3 0 0 0 2.6-.6"/>';

/** Characters shown while a character decodes; look-alikes such as 0/O and 1/l are left out. */
const SCRAMBLE = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** The demo key shown when the `value` attribute is missing. */
const DEMO_KEY = "sk-demo-4f9Q7xLm2Rk8Vt3nW6pA";

/** One character of the key. */
interface KeyChar {
  el: HTMLSpanElement;
  ch: string;
  /** Horizontal centre in px; NaN until the first layout. */
  cx: number;
  /** Time the reveal front crossed the character, or -1 while it is hidden. */
  crossed: number;
  shown: boolean;
}

/** API key field hidden under crawling pixel noise; holding the eye wipes the noise away. */
class Secret extends PxBase {
  static readonly observedAttributes = ["value"] as const;

  /** Reveal progress from 0 (hidden) to 1 (revealed). */
  private progress = 0;
  private holding = false;
  /** The key stays revealed until this time after release. */
  private releaseAt = 0;
  private readonly chars: KeyChar[] = [];
  /** Width of the key text in px; 0 until the first layout. */
  private textWidth = 0;
  /** Whether the key was fully revealed on the last frame; null before the first. */
  private lastRevealed: boolean | null = null;
  /** Whether the eye button shows the crossed-out icon. */
  private eyeOff = false;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      .box { display: flex; align-items: center; gap: 4px; height: 46px; padding: 0 6px 0 14px; border-radius: 10px; border: 1px solid var(--_border); background: var(--_surface); }
      .keywrap { position: relative; flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; overflow: hidden; }
      .key { font-family: var(--_mono); font-size: 13.5px; white-space: nowrap; letter-spacing: .02em; }
      .key span { display: inline-block; }
      .key span.scr { color: var(--_accent); }
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; }
      .ib { width: 32px; height: 32px; border-radius: 8px; border: 0; background: none; color: var(--_muted); display: grid; place-items: center; cursor: pointer; flex: none; touch-action: none; padding: 0; }
      .ib:hover { color: var(--_fg); background: color-mix(in srgb, var(--_fg) 7%, transparent); }
      .ib[aria-pressed="true"] { color: var(--_accent); }
      .ib svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
      .hint { font-size: 12px; color: var(--_muted); }
      `,
      `<span class="lab">API key</span>
        <div class="box" role="group"><div class="keywrap" aria-hidden="true"><span class="key"></span><canvas class="px"></canvas></div>
          <button class="ib eye" type="button" aria-pressed="false" aria-label="Hold to reveal the key"><svg viewBox="0 0 16 16" aria-hidden="true">${EYE}</svg></button>
          <button class="ib copy" type="button" aria-label="Copy the key"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.8"/><path d="M10.8 5.2V4.1c0-1-.8-1.6-1.6-1.6H4.1c-.9 0-1.6.7-1.6 1.6v5.1c0 .9.7 1.6 1.6 1.6h1.1"/></svg></button></div>
        <span class="rollslot hint" aria-live="polite"></span>`,
    );
    const eye = this.$(".eye");
    const on = (e: Event): void => {
      e.preventDefault();
      this.holding = true;
      eye.setAttribute("aria-pressed", "true");
      this.kick();
    };
    const off = (): void => {
      if (!this.holding) return;
      this.holding = false;
      this.releaseAt = this.t + 0.35;
      eye.setAttribute("aria-pressed", "false");
      this.kick();
    };
    eye.addEventListener("pointerdown", on);
    for (const type of ["pointerup", "pointerleave", "pointercancel"]) eye.addEventListener(type, off);
    eye.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) on(e);
    });
    eye.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") off();
    });
    // focus leaving mid-hold (another window, a tab key) hides the key again
    eye.addEventListener("blur", off);
    this.$(".copy").addEventListener("click", () => void this.copy());
  }

  /** The key to display and copy: the `value` attribute, or the demo key. */
  get value(): string {
    return this.getAttribute("value") || DEMO_KEY;
  }

  set value(key: string) {
    this.setAttribute("value", key);
  }

  attributeChangedCallback(): void {
    // before the first connect, init() builds the characters
    if (!this.initialized) return;
    this.buildChars();
    this.measure();
    this.lastRevealed = null;
    this.kick();
  }

  /** Copy the key and report the outcome in the hint line. */
  private async copy(): Promise<void> {
    let ok = true;
    try {
      await navigator.clipboard.writeText(this.value);
    } catch {
      ok = false;
    }
    rollText(this.$(".hint"), ok ? "Copied to clipboard" : "Couldn’t copy here. Reveal it and copy by hand.", 1);
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => rollText(this.$(".hint"), "Hold the eye to reveal", -1), 1800);
  }

  protected override init(): void {
    this.buildChars();
    this.$(".box").setAttribute("aria-label", "API key, hidden");
    rollText(this.$(".hint"), "Hold the eye to reveal", 1, false);
  }

  /** One span per character of the key; hidden characters are invisible, unselectable and not exposed. */
  private buildChars(): void {
    this.chars.length = 0;
    const spans = [...this.value].map((ch) => {
      const span = document.createElement("span");
      span.textContent = ch;
      span.style.visibility = "hidden";
      this.chars.push({ el: span, ch, cx: Number.NaN, crossed: -1, shown: false });
      return span;
    });
    this.$(".key").replaceChildren(...spans);
  }

  protected override resized(): void {
    this.measure();
  }

  /** Measure the character centres and the key width that the reveal front sweeps across. */
  private measure(): void {
    for (const c of this.chars) c.cx = c.el.offsetLeft + c.el.offsetWidth / 2;
    this.textWidth = this.$(".key").offsetWidth;
  }

  /** Show the characters left of the reveal front, each scrambling briefly before it locks. */
  private updateChars(front: number, t: number, still: boolean): void {
    for (const c of this.chars) {
      if (c.cx < front) {
        if (c.crossed < 0) c.crossed = t;
        const scrambling = !still && t - c.crossed < 0.22;
        const ch = scrambling ? SCRAMBLE[(hash(c.cx + Math.floor(t * 22)) * SCRAMBLE.length) | 0] : c.ch;
        if (c.el.textContent !== ch) c.el.textContent = ch;
        c.el.classList.toggle("scr", scrambling);
        if (!c.shown) {
          c.shown = true;
          c.el.style.visibility = "";
        }
      } else if (c.shown || c.crossed >= 0) {
        c.crossed = -1;
        c.shown = false;
        c.el.style.visibility = "hidden";
        c.el.textContent = c.ch;
        c.el.classList.remove("scr");
      }
    }
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const still = reduced();
    const target = this.holding ? 1 : t < this.releaseAt ? this.progress : 0;
    const rate = still ? 99 : this.holding ? 1.6 : 3;
    this.progress += clamp(target - this.progress, -rate * dt, rate * dt);
    const textWidth = this.textWidth || 200;
    // the reveal front sweeps 15px past both ends of the key
    const front = this.progress * (textWidth + 30) - 15;
    const revealed = this.progress > 0.98;
    if (revealed !== this.lastRevealed) {
      this.lastRevealed = revealed;
      this.$(".box").setAttribute("aria-label", revealed ? `API key, ${this.value}` : "API key, hidden");
    }
    const eyeOff = this.progress > 0.5;
    if (eyeOff !== this.eyeOff) {
      this.eyeOff = eyeOff;
      this.$<SVGSVGElement>(".eye svg").innerHTML = eyeOff ? EYE_OFF : EYE;
    }
    this.updateChars(front, t, still);

    // crawling noise over the hidden part, thinning out at the front; it holds still under reduced motion
    this.clear();
    const tick = still ? 0 : Math.floor(t * 11);
    const cy = this.h / 2;
    for (let x = 0; x < Math.min(this.w, textWidth + 6); x += 3) {
      const cover = smooth(front - 7, front + 7, x);
      if (cover <= 0) continue;
      for (let y = cy - 9; y < cy + 9; y += 3) {
        if (hash(x * 1.7 + y * 3.1 + tick * 0.29) < cover * 0.8) {
          this.dot(x, y, mix(P.muted, P.accent, 0.3 + 0.5 * (1 - cover)), 0.6, 2.2);
        }
      }
    }
    if (!still) return true;
    // a still field only needs frames until the key has finished showing or hiding
    return Math.abs(target - this.progress) > 0.001 || t < this.releaseAt;
  }
}

define("px-secret", Secret);

export { Secret };

declare global {
  interface HTMLElementTagNameMap {
    "px-secret": Secret;
  }
}
