/**
 * <hf-button> · Button
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/button
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-button.tsx.
 */
import {
  FormMixin,
  HF,
  clamp,
  define,
  fbm,
  localPoint,
  mix,
  now,
  reduced,
  rollText,
  shake,
  type Point,
} from "@/lib/lumesec/pixel";

/** Colour scheme of the button; without `variant` the accent colour is used. */
export type HButtonVariant = "danger";

/** Phase of {@link HButton.run}; `""` shows the label. */
export type HButtonState = "" | "loading" | "success" | "error";

/** Events fired by `<hf-button>`. */
export interface HButtonEventMap {
  /** Fires when `run()` enters the loading state. */
  start: CustomEvent<Record<string, never>>;
  /** Fires when the promise passed to `run()` resolves. */
  success: CustomEvent<Record<string, never>>;
  /** Fires when the promise passed to `run()` rejects. */
  error: CustomEvent<Record<string, never>>;
}

/** A press ripple: where the pointer went down, in canvas pixels, and when. */
interface Ripple {
  x: number;
  y: number;
  t0: number;
}

/** Seconds a ripple travels before it fades out. */
const RIPPLE_LIFE = 0.8;

/**
 * Dot-matrix button with a pointer light and press ripples; `run(fn)` shows loading, success and error states
 * around a promise.
 */
class HButton extends FormMixin(HF) {
  /** The label, read from the text content. */
  private label = "";
  private state: HButtonState = "";
  /** Pointer position in canvas pixels while it is over the button. */
  private ptr: Point | null = null;
  /** Eased 0–1 hover amount. */
  private hov = 0;
  private rip: Ripple[] = [];
  /** Time the current state began. */
  private t0 = 0;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  /** Follows the text content, so a changed label (a React child, for example) shows up. */
  private readonly labelObserver = new MutationObserver(() => this.readLabel());

  constructor() {
    super(
      `
      :host { display: inline-block; vertical-align: middle; }
      .b { position: relative; display: inline-grid; place-items: center; height: 48px; min-width: 188px; padding: 0 26px; border: 0; border-radius: 12px; overflow: hidden; cursor: pointer;
        background: color-mix(in srgb, var(--c) 32%, #0b0a12); color: #fff; font-size: 15px; font-weight: 600; transition: transform .15s cubic-bezier(.2,.8,.2,1); --c: var(--_accent); }
      :host([variant="danger"]) .b { --c: var(--_danger); }
      .b:active { transform: scale(.97); }
      .b:focus-visible { outline: 2px solid var(--c); outline-offset: 3px; }
      .b:disabled { cursor: default; opacity: .5; }
      .b:disabled:active { transform: none; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .l { position: relative; justify-items: center; text-shadow: 0 1px 2px rgba(0,0,0,.45); }
      `,
      `<button class="b" type="button"><canvas class="px" aria-hidden="true"></canvas><span class="rollslot l" aria-live="polite"></span></button>`,
      2,
      0.74,
    );
    const button = this.$("button");
    // some browsers send pointer events to a disabled button; it shows no light or ripples
    button.addEventListener("pointermove", (e) => {
      if (button.disabled) return;
      this.ptr = localPoint(button, e);
      this.kick();
    });
    button.addEventListener("pointerleave", () => {
      this.ptr = null;
      this.kick();
    });
    button.addEventListener("pointerdown", (e) => {
      if (button.disabled) return;
      const [x, y] = localPoint(button, e);
      this.rip.push({ x, y, t0: now() });
      this.kick();
    });
    button.addEventListener("click", (e) => {
      if (this.state === "loading") {
        e.stopPropagation();
        return;
      }
      const demo = this.getAttribute("demo");
      if (demo) this.run(() => demoTask(demo === "error")).catch(() => {});
      else if (this.getAttribute("type") === "submit" && this.form) this.form.requestSubmit();
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.labelObserver.observe(this, { childList: true, characterData: true, subtree: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.labelObserver.disconnect();
  }

  /**
   * Read the label from the text content. Runs on first connect, and again whenever the text changes; public so
   * a host element can read it again at once (`hf-hero`).
   */
  override init(): void {
    this.readLabel();
  }

  /** Called by the browser when the `disabled` attribute or a disabled ancestor `<fieldset>` changes. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    this.$("button").disabled = disabled;
    this.ptr = null;
    this.kick();
  }

  private readLabel(): void {
    this.label = this.textContent.trim() || "Generate";
    // a state label (loading, success, error) stays until the state ends
    if (!this.state) rollText(this.$(".l"), this.label, 1, false);
  }

  /**
   * Shows the loading state while the promise runs, then success or error for 1.7 s before returning to the
   * label. Resolves with the promise value and rethrows its error.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.setState("loading");
    try {
      const result = await fn();
      this.setState("success");
      return result;
    } catch (err) {
      this.setState("error");
      throw err;
    } finally {
      clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => this.setState(""), 1700);
    }
  }

  private setState(state: HButtonState): void {
    const prev = this.state;
    this.state = state;
    this.t0 = now();
    rollText(this.$(".l"), this.textFor(state), state ? 1 : -1, prev !== state);
    const button = this.$("button");
    button.setAttribute("aria-busy", String(state === "loading"));
    if (state === "error") shake(button);
    if (state) this.emit(state === "loading" ? "start" : state);
    this.kick();
  }

  private textFor(state: HButtonState): string {
    switch (state) {
      case "loading":
        return this.getAttribute("loading-text") || "Working…";
      case "success":
        return this.getAttribute("success-text") || "Done";
      case "error":
        return this.getAttribute("error-text") || "Try again";
      default:
        return this.label;
    }
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const state = this.state;
    const ptr = this.ptr;
    this.hov += ((ptr ? 1 : 0) - this.hov) * Math.min(1, dt * 8);
    this.rip = this.rip.filter((r) => t - r.t0 < RIPPLE_LIFE);
    let base = P.accent;
    if (state === "success") base = P.ok;
    else if (state === "error" || this.getAttribute("variant") === "danger") base = P.danger;
    // the noise holds still under reduced motion
    const ft = reducedMotion ? 0 : t;
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        let light =
          state === "loading"
            ? 0.28 + 0.6 * fbm(x * 0.05 - ft * 1.4, y * 0.09 + ft * 0.4)
            : 0.3 + 0.18 * fbm(x * 0.035 + ft * 0.15, y * 0.07);
        if (ptr) {
          const dx = x - ptr[0];
          const dy = y - ptr[1];
          light += 0.38 * this.hov * Math.exp(-(dx * dx + dy * dy) / 2600);
        }
        for (const r of this.rip) {
          const age = t - r.t0;
          const d = Math.hypot(x - r.x, y - r.y);
          light += Math.exp(-((d - age * 320) ** 2) / 90) * (1 - age / RIPPLE_LIFE) * 0.8;
        }
        // top highlight
        if (j < 2) light += 0.12;
        if (state === "success") {
          const sweep = (t - this.t0) * 2.2;
          light += Math.max(0, 1 - Math.abs(x / this.w - sweep) * 6) * 0.6;
        }
        light = clamp(light, 0, 1.2);
        const col = mix(base, P.shine, clamp(light - 0.45, 0, 1) * 0.55);
        F.put(i, j, col, Math.min(1, light), Math.max(0, light - 0.6) * 0.8);
      }
    }
    this.flush(0.8, 5);
    return (
      !reducedMotion ||
      ptr !== null ||
      this.rip.length > 0 ||
      state === "loading" ||
      Math.abs(this.hov - (ptr ? 1 : 0)) > 0.01
    );
  }
}

/** The simulated 1.5 s task behind the `demo` attribute. */
function demoTask(fail: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => (fail ? reject(new Error("Demo failure")) : resolve()), 1500);
  });
}

define("hf-button", HButton);

declare global {
  interface HTMLElementTagNameMap {
    "hf-button": HButton;
  }
}

export { HButton };
