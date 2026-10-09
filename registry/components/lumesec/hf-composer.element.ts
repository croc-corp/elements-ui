/**
 * <hf-composer> · Prompt composer
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/composer
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-composer.tsx.
 */
import { HF, Sparks, bayer, clamp, define, fbm, mix, now, rand, reduced, rollText, smooth } from "@/lib/lumesec/pixel";

/** Effort levels in the order the chip cycles through them. */
const EFFORTS = ["Low", "Medium", "High", "Max", "Ultracode"] as const;

/** Display name of an effort level, as carried by the `send` and `effort` events. */
export type HComposerEffortLabel = (typeof EFFORTS)[number];

/** Value of the `effort` attribute (case-insensitive). */
export type HComposerEffort = Lowercase<HComposerEffortLabel>;

/** Events fired by `<hf-composer>`. */
export interface HComposerEventMap {
  /** Fires when a non-empty message is sent. `text` is trimmed; `effort` is the level label. */
  send: CustomEvent<{ text: string; effort: HComposerEffortLabel }>;
  /** Fires when the user cycles the effort chip. `effort` is the new level label. */
  effort: CustomEvent<{ effort: HComposerEffortLabel }>;
}

/** Index of Ultracode, the level that brightens the band. */
const ULTRA = 4;

/** Default index: High. */
const DEFAULT_EFFORT = 2;

const STATUS_HINT = "Enter to send · Shift+Enter for a new line";

/**
 * Chat input with an aurora border and an effort chip; Enter sends and fires a `send` event with the text and
 * effort level.
 */
class HComposer extends HF {
  static observedAttributes = ["placeholder", "model", "effort"];

  /** Typing energy, 0–1: each keystroke adds to it and it drains over time. */
  private energy = 0;
  /** Eased 0–1 Ultracode amount. */
  private ult = 0;
  /** Time of the last send; starts the wave that runs across the band. */
  private wave = -9;
  /** Time the thinking pulse starts, shortly after a send. */
  private think = -9;
  /** Index of the selected effort level. */
  private ei = DEFAULT_EFFORT;
  private readonly sparks = new Sparks();
  /** Rolls the status line back to the keyboard hint after a send. */
  private statusTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .box { position: relative; border-radius: 18px; border: 1px solid var(--_border); background: var(--_surface); overflow: hidden; transition: border-color .25s; }
      .box:focus-within { border-color: color-mix(in srgb, var(--_accent) 55%, var(--_border)); }
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; }
      textarea { position: relative; z-index: 1; display: block; width: 100%; min-height: 52px; max-height: 160px; resize: none; border: 0; background: none; padding: 16px 16px 4px; font: inherit; font-size: 15px; line-height: 1.5; color: var(--_fg); }
      textarea:focus-visible { outline: none; }
      textarea::placeholder { color: var(--_muted); }
      .bar { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 6px 10px 10px 12px; }
      .model { font-size: 13px; color: var(--_muted); }
      .chip { border: 0; border-radius: 8px; padding: 4px 10px; font-size: 12.5px; font-weight: 600; cursor: pointer; background: color-mix(in srgb, var(--_fg) 8%, transparent); color: var(--_fg); transition: background-color .25s, color .25s; }
      .chip .rollslot { justify-items: start; }
      :host([data-ultra]) .chip { background: color-mix(in srgb, var(--_accent) 18%, transparent); color: var(--_accent); }
      .chip:focus-visible, .send:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
      .sp { flex: 1; }
      .send { width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--_accent); color: var(--_on-accent); display: grid; place-items: center; cursor: pointer; transition: transform .15s, opacity .2s; }
      .send:disabled { opacity: .35; cursor: default; }
      .send:not(:disabled):active { transform: scale(.9); }
      .send svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .st { display: block; font-size: 12px; color: var(--_muted); margin-top: 8px; }
      `,
      `<div class="box"><canvas class="px" aria-hidden="true"></canvas><textarea rows="1" aria-label="Message"></textarea>
        <div class="bar"><span class="model"></span><button class="chip" type="button" aria-label="Effort"><span class="rollslot e"></span></button><span class="sp"></span><button class="send" type="button" aria-label="Send" disabled><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.8 7.7L8 3.5l4.2 4.2"/></svg></button></div></div>
        <span class="st"><span class="rollslot s" aria-live="polite"></span></span>`,
      2.5,
      0.66,
    );
    const textarea = this.$("textarea");
    textarea.addEventListener("input", (e) => {
      // the native event is composed; it carries nothing a host listener could use
      e.stopPropagation();
      this.energy = Math.min(1, this.energy + 0.25);
      this.grow();
      this.sendButton.disabled = !textarea.value.trim();
      this.kick();
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.send();
      }
    });
    this.sendButton.addEventListener("click", () => {
      this.send();
      // the button disables itself after a send; keep focus where the next message is typed
      this.$("textarea").focus();
    });
    this.$(".chip").addEventListener("click", () => this.setEffort((this.ei + 1) % EFFORTS.length, true));
  }

  attributeChangedCallback(name: string): void {
    // before the first connect, init() reads every attribute
    if (!this.initialized) return;
    if (name === "effort") this.setEffort(this.effortAttribute, false);
    else this.renderText();
  }

  protected override init(): void {
    this.renderText();
    this.setEffort(this.effortAttribute, false);
    rollText(this.$(".s"), STATUS_HINT, 1, false);
  }

  private renderText(): void {
    this.$("textarea").placeholder = this.getAttribute("placeholder") || "Reply to the agent…";
    this.$(".model").textContent = this.getAttribute("model") || "Large";
  }

  /** Index of the `effort` attribute (case-insensitive); High when it is missing or unknown. */
  private get effortAttribute(): number {
    const wanted = (this.getAttribute("effort") || "high").toLowerCase();
    const index = EFFORTS.findIndex((label) => label.toLowerCase() === wanted);
    return index < 0 ? DEFAULT_EFFORT : index;
  }

  private get sendButton(): HTMLButtonElement {
    return this.$<HTMLButtonElement>(".send");
  }

  /** The textarea grows with its content up to 160px. */
  private grow(): void {
    const textarea = this.$("textarea");
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(160, textarea.scrollHeight)}px`;
  }

  private setEffort(index: number, animate: boolean): void {
    const dir = index > this.ei || (this.ei === ULTRA && index === 0) ? 1 : -1;
    this.ei = index;
    const label = EFFORTS[index];
    rollText(this.$(".e"), label, index === 0 && animate ? -1 : dir, animate);
    this.toggleAttribute("data-ultra", index === ULTRA);
    this.$(".chip").setAttribute("aria-label", `Effort: ${label}. Click to change.`);
    if (index === ULTRA && animate) {
      const P = this.P;
      for (let k = 0; k < 4; k++) {
        this.sparks.add(this.w * (0.2 + k * 0.2), this.h - 10, 10, [P.accent, P.shine], {
          speed: [40, 140],
          angle: -Math.PI / 2,
          spread: 1.4,
        });
      }
    }
    if (animate) this.emit<{ effort: HComposerEffortLabel }>("effort", { effort: label });
    this.kick();
  }

  private send(): void {
    const textarea = this.$("textarea");
    const text = textarea.value.trim();
    if (!text) return;
    this.wave = now();
    this.think = now() + 0.7;
    textarea.value = "";
    this.grow();
    this.sendButton.disabled = true;
    const effort = EFFORTS[this.ei];
    rollText(this.$(".s"), `Sent at ${effort} effort · thinking…`, 1);
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => rollText(this.$(".s"), STATUS_HINT, -1), 2600);
    this.emit<{ text: string; effort: HComposerEffortLabel }>("send", { text, effort });
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    // the aurora holds still under reduced motion
    const ft = reducedMotion ? 0 : t;
    this.energy = Math.max(0, this.energy - dt * 0.7);
    this.ult += ((this.ei === ULTRA ? 1 : 0) - this.ult) * Math.min(1, dt * 3);
    const level = this.ei / ULTRA;
    const waveU = (t - this.wave) / 0.75;
    const think = t - this.think;
    let pulse = 0;
    if (think > 0 && think < 1.8) {
      const fade = 1 - think / 1.8;
      pulse = 0.25 * Math.sin(think * 6) * fade + 0.2 * fade;
    }
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        // the aurora lives in the lower half
        const band = smooth(0.5, 1, y / this.h);
        if (band <= 0) continue;
        const n = fbm(x * 0.022 + ft * (0.08 + this.ult * 0.25), y * 0.05 - ft * (0.15 + this.ult * 0.4));
        let intensity = band * n * (0.18 + level * 0.12 + this.energy * 0.3 + this.ult * 0.3 + pulse);
        let glow = intensity * (0.3 + this.ult * 0.5);
        if (waveU >= 0 && waveU <= 1.3) {
          // a send wave runs from right to left
          const fx = (1 - waveU) * this.w;
          const k = Math.exp(-((x - fx) ** 2) / 900) * (1 - Math.max(0, waveU - 0.8) / 0.5);
          intensity += k * band * 0.9;
          glow += k * 0.9;
        }
        if (intensity > bayer(i, j) * 0.55) {
          const col = mix(P.accent, P.shine, clamp(n * 0.35 + this.ult * 0.15 + glow * 0.2, 0, 0.55));
          F.put(i, j, col, clamp(intensity * 1.1, 0, 0.85), clamp(glow, 0, 0.8));
        }
      }
    }
    if (this.ult > 0.5 && !reducedMotion && Math.random() < 0.15) {
      this.sparks.add(rand(10, this.w - 10), this.h - 4, 1, [P.shine, P.accent], {
        speed: [20, 60],
        angle: -Math.PI / 2,
        spread: 0.6,
        life: [0.5, 1.1],
        drag: 1,
      });
    }
    this.flush(0.8, 7);
    this.sparks.step(ctx, dt);
    return !reducedMotion;
  }
}

define("hf-composer", HComposer);

declare global {
  interface HTMLElementTagNameMap {
    "hf-composer": HComposer;
  }
}

export { HComposer };
