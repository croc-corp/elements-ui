/**
 * <hf-reveal> · Secret field
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/reveal
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-reveal.tsx.
 */
import { HF, clamp, define, ease3, h2, localPoint, mix, now, reduced, rollText, vnoise } from "@/lib/lumesec/pixel";

/** Detail of the `toggle` event. */
export interface HRevealToggleDetail {
  /** True when the secret is now shown. */
  revealed: boolean;
}

/** Detail of the `copy` event. */
export interface HRevealCopyDetail {
  /** False when the clipboard write was rejected. */
  ok: boolean;
}

/** Events fired by `<hf-reveal>`. */
export interface HRevealEventMap {
  /** Fires on every reveal or hide, including the automatic hide after 15 s. */
  toggle: CustomEvent<HRevealToggleDetail>;
  /** Fires after the Copy button is used; `ok` tells whether the clipboard write succeeded. */
  copy: CustomEvent<HRevealCopyDetail>;
}

/** Milliseconds a revealed secret stays visible. */
const AUTO_HIDE_MS = 15000;

/**
 * Secret field that hides its value under live static; revealing dissolves the noise outward from the click and
 * re-hides after 15 s.
 */
class HReveal extends HF {
  static readonly observedAttributes = ["secret", "hint"] as const;

  /** Reveal progress from 0 (hidden) to 1 (shown). */
  private open = 0;
  /** Target of {@link HReveal.open}: 1 while revealed. */
  private tgt = 0;
  /** Horizontal origin of the dissolve in pixels from the left of the value. */
  private ox = 0;
  /** Time of the last successful copy; drives the green flash. */
  private copyT = -9;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private copyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .lab { font-size: 13px; font-weight: 500; margin-bottom: 6px; display: flex; justify-content: space-between; }
      .lab span { font-weight: 400; color: var(--_muted); font-size: 12px; }
      .f { display: flex; align-items: center; gap: 6px; border: 1px solid var(--_border); background: var(--_raised); border-radius: 10px; padding: 4px 4px 4px 12px; }
      .v { position: relative; flex: 1; min-width: 0; height: 32px; display: flex; align-items: center; cursor: pointer; }
      .s { font-family: var(--_mono); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; -webkit-mask-image: radial-gradient(circle at var(--x, 0) 50%, #000 var(--r, 0px), transparent calc(var(--r, 0px) + 18px)); mask-image: radial-gradient(circle at var(--x, 0) 50%, #000 var(--r, 0px), transparent calc(var(--r, 0px) + 18px)); }
      canvas.px { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
      .f button { flex: none; height: 32px; border: 0; border-radius: 7px; padding: 0 11px; background: none; color: var(--_fg); font: 600 12.5px var(--_font); cursor: pointer; }
      .f button:hover { background: color-mix(in srgb, var(--_fg) 7%, transparent); }
      .f button:focus-visible { outline: 2px solid var(--_accent); }
      `,
      `<div class="lab">API key<span class="hint"></span></div><div class="f"><div class="v"><span class="s"></span><canvas class="px" aria-hidden="true"></canvas></div><button class="rv" type="button">Reveal</button><button class="cp" type="button"><span class="rollslot cpl"></span></button></div><span class="sr" aria-live="polite"></span>`,
      2,
      0.72,
    );
    this.$(".rv").addEventListener("click", () => this.toggle());
    const value = this.$(".v");
    value.addEventListener("click", (e) => {
      this.toggle(localPoint(value, e)[0]);
    });
    this.$(".cp").addEventListener("click", () => this.copy());
    // copying selected text inside the field fires a native `copy` event that would cross the shadow boundary and
    // reach listeners for this element's own `copy` event; keep it inside
    this.root.addEventListener("copy", (e) => e.stopPropagation());
  }

  /** The secret value. */
  get secret(): string {
    return this.getAttribute("secret") || "sk-demo-Px9Qz7R4mW2vL8kT5nB1cJ6hD3fY0sA";
  }

  private get hintText(): string {
    return this.getAttribute("hint") || "Hidden";
  }

  protected override init(): void {
    this.$(".s").setAttribute("aria-hidden", "true");
    this.syncText();
    rollText(this.$(".cpl"), "Copy", 1, false);
    this.$(".rv").setAttribute("aria-label", "Reveal secret");
  }

  attributeChangedCallback(): void {
    if (!this.initialized) return;
    this.syncText();
    this.kick();
  }

  /** Show the current `secret`, and `hint` while it is hidden. */
  private syncText(): void {
    this.$(".s").textContent = this.secret;
    if (!this.tgt) this.$(".hint").textContent = this.hintText;
  }

  /**
   * Reveals or hides the secret. `x` is the horizontal origin of the dissolve in pixels from the left of the value.
   */
  toggle(x?: number): void {
    this.tgt = this.tgt ? 0 : 1;
    this.ox = x ?? (this.tgt ? 0 : this.ox);
    const shown = this.tgt === 1;
    const button = this.$(".rv");
    button.textContent = shown ? "Hide" : "Reveal";
    button.setAttribute("aria-label", shown ? "Hide secret" : "Reveal secret");
    // the value is readable only while it is shown
    if (shown) this.$(".s").removeAttribute("aria-hidden");
    else this.$(".s").setAttribute("aria-hidden", "true");
    this.$(".hint").textContent = shown ? "Hides again in 15s" : this.hintText;
    this.$(".sr").textContent = shown ? "Secret shown" : "Secret hidden";
    clearTimeout(this.hideTimer);
    if (shown) {
      this.hideTimer = setTimeout(() => {
        if (this.tgt) this.toggle();
      }, AUTO_HIDE_MS);
    }
    this.emit<HRevealToggleDetail>("toggle", { revealed: shown });
    this.kick();
  }

  /** Writes the secret to the clipboard and shows `Copied`, or `Failed` when the write is rejected. */
  async copy(): Promise<void> {
    let ok = true;
    try {
      await navigator.clipboard.writeText(this.secret);
    } catch {
      ok = false;
    }
    if (ok) this.copyT = now();
    rollText(this.$(".cpl"), ok ? "Copied" : "Failed", 1, true);
    this.$(".sr").textContent = ok ? "Copied to clipboard" : "Copy failed";
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => rollText(this.$(".cpl"), "Copy", -1, true), 1600);
    this.emit<HRevealCopyDetail>("copy", { ok });
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const C = F.cols;
    const R = F.rows;
    const W = this.w;
    this.open = reducedMotion ? this.tgt : clamp(this.open + (this.tgt ? dt * 1.6 : -dt * 2.2), 0, 1);
    // the reveal circle grows from the click until it covers the field, then opens fully
    const rMax = Math.max(this.ox, W - this.ox) + 30;
    const rad = ease3(this.open) * rMax * (this.open >= 1 ? 2 : 1);
    const text = this.$(".s");
    text.style.setProperty("--x", `${this.ox}px`);
    text.style.setProperty("--r", `${this.open >= 1 ? 9999 : rad - 10}px`);
    const copyFlash = reducedMotion ? 0 : clamp(1 - (t - this.copyT) / 0.6, 0, 1);
    const textW = text.scrollWidth;
    F.clear();
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const [x, y] = F.xy(i, j);
        const d = Math.hypot(x - this.ox, (y - this.h / 2) * 2);
        if (x > Math.min(W, textW + 6)) continue;
        if (d < rad - 14) {
          if (copyFlash > 0 && h2(i, j) < copyFlash * 0.35) F.put(i, j, P.ok, copyFlash, copyFlash);
          continue;
        }
        const rim = d < rad + 4 && this.open > 0 && this.open < 1;
        const n = h2(i, j + Math.floor((reducedMotion ? 0 : t) * 16));
        if (rim) {
          F.put(i, j, mix(P.accent, P.shine, 0.5), 1, 0.9);
          continue;
        }
        const dens = 0.42 + 0.3 * vnoise(i * 0.15 + (reducedMotion ? 0 : t * 1.5), j * 0.3);
        if (n < dens) F.put(i, j, mix(P.muted, P.accent, h2(j, i) * 0.6), 0.55 + 0.45 * h2(i * 3, j), 0.04);
      }
    }
    this.flush(0.8, 4);
    return !reducedMotion && (this.tgt === 0 || (this.open > 0 && this.open < 1) || copyFlash > 0);
  }
}

define("hf-reveal", HReveal);

declare global {
  interface HTMLElementTagNameMap {
    "hf-reveal": HReveal;
  }
}

export { HReveal };
