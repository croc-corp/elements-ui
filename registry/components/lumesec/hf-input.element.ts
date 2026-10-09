/**
 * <hf-input> · Text field
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/input
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-input.tsx.
 */
import {
  DISABLED_CSS,
  FormMixin,
  HF,
  Sparks,
  TAU,
  define,
  h2,
  lerp,
  mix,
  now,
  reduced,
  rollText,
  rrSdf,
  shake,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Validation state shown by the border and the message, reflected to `data-state`; `""` is neutral. */
export type HInputState = "" | "ok" | "error";

/** Events fired by `<hf-input>`. */
export interface HInputEventMap {
  /** Fires on every edit. */
  input: CustomEvent<{ value: string }>;
  /** Fires when the inner input commits a change, on blur after editing. */
  change: CustomEvent<{ value: string }>;
}

/** Host attributes mirrored to the inner `<input>`. */
const HF_PASS = [
  "type",
  "placeholder",
  "required",
  "pattern",
  "minlength",
  "maxlength",
  "autocomplete",
  "inputmode",
  "spellcheck",
] as const;

/**
 * Form-associated text field with a comet of light on the border while focused; invalid values turn the border
 * to static.
 */
class HInput extends FormMixin(HF) {
  static observedAttributes = ["label", "hint", "error", "success", ...HF_PASS];

  private state: HInputState = "";
  /** Eased 0–1 focus amount. */
  private f = 0;
  /** Eased 0–1 hover amount. */
  private hov = 0;
  private hovering = false;
  /** Time the value last became valid; starts the success sweep. */
  private okT = -9;
  private readonly sparks = new Sparks();

  constructor() {
    super(
      `
      :host { display: block; }
      .lab { display: block; font-size: 12.5px; font-weight: 500; margin-bottom: 7px; }
      .field { position: relative; display: flex; align-items: center; height: 46px; padding: 0 14px; border-radius: 12px; background: var(--_surface); }
      .field input { position: relative; z-index: 1; flex: 1; min-width: 0; border: 0; background: none; font-size: 14.5px; height: 100%; padding: 0; }
      .field input:focus-visible { outline: none; }
      .field input::placeholder { color: var(--_muted); opacity: .75; }
      canvas.px { position: absolute; left: -8px; top: -8px; width: calc(100% + 16px); height: calc(100% + 16px); pointer-events: none; }
      .msg { display: block; font-size: 12px; margin-top: 7px; color: var(--_muted); min-height: 1.45em; }
      :host([data-state="error"]) .msg { color: var(--_danger); }
      :host([data-state="ok"]) .msg { color: var(--_ok); }
      ${DISABLED_CSS}
      `,
      `<label class="lab" for="in"></label><div class="field"><input id="in" aria-describedby="m"><canvas class="px" aria-hidden="true"></canvas></div><span class="msg"><span class="rollslot m" id="m" aria-live="polite"></span></span>`,
      2,
      0.7,
    );
    const input = this.$("input");
    const field = this.$(".field");
    field.addEventListener("pointerenter", () => {
      this.hovering = true;
      this.kick();
    });
    field.addEventListener("pointerleave", () => {
      this.hovering = false;
      this.kick();
    });
    input.addEventListener("focus", () => this.kick());
    input.addEventListener("blur", () => this.validate(true));
    input.addEventListener("input", (e) => {
      // the native event is composed; the host fires its own `input` with the value instead
      e.stopPropagation();
      this.setFormValue(input.value);
      this.syncValidity();
      if (this.state === "error") this.validate(false);
      this.sparkAtCaret(input);
      this.emit<{ value: string }>("input", { value: input.value });
      this.kick();
    });
    input.addEventListener("change", () => this.emit<{ value: string }>("change", { value: input.value }));
  }

  /** Current text. Setting it updates the form value and validity, but not the visual state or message. */
  get value(): string {
    return this.$("input").value;
  }

  set value(value: string | null) {
    this.$("input").value = value ?? "";
    this.setFormValue(this.value);
    this.syncValidity();
  }

  attributeChangedCallback(name: string): void {
    // before the first connect, init() reads every attribute
    if (!this.initialized) return;
    if (name === "label") this.renderLabel();
    else if (name === "hint" || name === "error" || name === "success") this.renderMessage();
    else {
      this.passAttribute(name);
      this.syncValidity();
      this.renderMessage();
    }
  }

  protected override init(): void {
    const input = this.$("input");
    for (const name of HF_PASS) this.passAttribute(name);
    this.renderLabel();
    input.value = this.getAttribute("value") || "";
    this.setFormValue(input.value);
    this.syncValidity();
    rollText(this.$(".m"), this.getAttribute("hint") || "", 1, false);
  }

  private passAttribute(name: string): void {
    const input = this.$("input");
    const value = this.getAttribute(name);
    if (value === null) input.removeAttribute(name);
    else input.setAttribute(name, value);
  }

  private renderLabel(): void {
    const label = this.$("label");
    label.textContent = this.getAttribute("label") || "";
    label.hidden = !this.getAttribute("label");
  }

  /** Show the message for the current state at once, after an attribute that feeds it changed. */
  private renderMessage(): void {
    const input = this.$("input");
    if (this.state === "error") this.syncValidity();
    rollText(this.$(".m"), this.message(input), 1, false);
  }

  /** Moves focus to the inner input. */
  override focus(options?: FocusOptions): void {
    this.$("input").focus(options);
  }

  /** Called by the browser when the `disabled` attribute or a disabled ancestor `<fieldset>` changes. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    this.$("input").disabled = disabled;
    this.hovering = false;
    this.kick();
  }

  /** Restores the `value` attribute and clears the validation state. */
  formResetCallback(): void {
    this.value = this.getAttribute("value") || "";
    this.state = "";
    delete this.dataset.state;
    this.$("input").removeAttribute("aria-invalid");
    this.renderMessage();
    this.kick();
  }

  /** A few sparks fall from the end of the typed text. */
  private sparkAtCaret(input: HTMLInputElement): void {
    const g = this.ctx;
    if (!g || reduced()) return;
    const P = this.P;
    g.font = `14.5px ${getComputedStyle(input).fontFamily}`;
    // canvas inset (8) + field padding (14)
    const cx = 8 + 14 + Math.min(g.measureText(input.value).width, this.w - 50);
    this.sparks.add(cx, this.h - 8, 3, [P.accent, P.shine], {
      speed: [20, 70],
      angle: Math.PI / 2,
      spread: 1.6,
      life: [0.2, 0.45],
    });
  }

  private syncValidity(): void {
    const input = this.$("input");
    if (input.validity.valid) this.setValidity({});
    else this.setValidity({ customError: true }, this.getAttribute("error") || input.validationMessage, input);
  }

  private validate(announce: boolean): void {
    const input = this.$("input");
    const prev = this.state;
    this.syncValidity();
    if (!input.value && !input.required) this.state = "";
    else this.state = input.checkValidity() ? "ok" : "error";
    if (this.state) this.dataset.state = this.state;
    else delete this.dataset.state;
    if (this.state === "error" && prev !== "error" && announce) shake(this.$(".field"));
    if (this.state === "ok" && prev !== "ok") this.okT = now();
    rollText(this.$(".m"), this.message(input), this.state === "error" ? 1 : -1);
    input.setAttribute("aria-invalid", String(this.state === "error"));
    this.kick();
  }

  private message(input: HTMLInputElement): string {
    const hint = this.getAttribute("hint") || "";
    if (this.state === "error") return this.getAttribute("error") || input.validationMessage;
    if (this.state === "ok") return this.getAttribute("success") || hint;
    return hint;
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const focused = this.root.activeElement === this.$("input");
    this.f += ((focused ? 1 : 0) - this.f) * Math.min(1, dt * 7);
    this.hov += ((this.hovering ? 1 : 0) - this.hov) * Math.min(1, dt * 8);
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h / 2;
    // the canvas overhangs the field by 8px on every side
    const bx = w / 2 - 8;
    const by = h / 2 - 8;
    // head of the comet that circles the border while focused
    const head = reducedMotion ? 0.1 : (t * 0.32) % 1;
    const state = this.state;
    const base = state === "error" ? P.danger : state === "ok" ? P.ok : P.accent;
    const okSweep = (t - this.okT) * 1.5;
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const d = rrSdf(x, y, cx, cy, bx, by, 12);
        if (Math.abs(d) > 1.6) continue;
        // position around the border, 0 to 1 clockwise from the top
        const u = (Math.atan2((y - cy) * (w / h), x - cx) / TAU + 1.25) % 1;
        const back = (((head - u) % 1) + 1) % 1;
        const comet = back < 0.3 ? Math.pow(1 - back / 0.3, 2) : 0;
        let a = 0.22 + this.hov * 0.12;
        let col: RGB = P.fg;
        let glow = 0;
        if (state === "error") {
          a = 0.55 + 0.45 * (reducedMotion ? 0.5 : h2(i * 3 + Math.floor(t * 20), j));
          col = P.danger;
          glow = 0.3;
        } else if (state === "ok" && !focused) {
          const k = okSweep < 1.2 ? Math.max(0, 1 - Math.abs(u - okSweep) * 5) : 0;
          a = 0.6 + k * 0.4;
          col = mix(P.ok, P.shine, k * 0.6);
          glow = 0.15 + k * 0.6;
        }
        if (this.f > 0.01 && state !== "error") {
          const focusA = 0.45 + comet * 0.55;
          if (focusA * this.f > a) {
            a = lerp(a, focusA, this.f);
            col = mix(base, P.shine, comet * 0.8);
            glow = (0.15 + comet * 0.85) * this.f;
          }
        }
        F.put(i, j, col, a, glow);
      }
    }
    this.flush(0.9, 5);
    const sparking = this.sparks.step(ctx, dt);
    return (
      focused ||
      sparking ||
      state === "error" ||
      Math.abs(this.f - (focused ? 1 : 0)) > 0.01 ||
      Math.abs(this.hov - (this.hovering ? 1 : 0)) > 0.01 ||
      (state === "ok" && okSweep < 1.3)
    );
  }
}

define("hf-input", HInput);

declare global {
  interface HTMLElementTagNameMap {
    "hf-input": HInput;
  }
}

export { HInput };
