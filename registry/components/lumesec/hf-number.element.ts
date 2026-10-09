/**
 * <hf-number> · Number stepper
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/number
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-number.tsx.
 */
import {
  DISABLED_CSS,
  FormMixin,
  HF,
  Sparks,
  bayer,
  clamp,
  css,
  define,
  ease3,
  fmtInt,
  mix,
  now,
  reduced,
  rollText,
  shake,
  smooth,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-number>`. */
export interface HNumberEventMap {
  /** Fires on each change from the buttons, keys or typed entry. Not fired when `value` is set from code. */
  input: CustomEvent<{ value: number }>;
  /** Fires 300 ms after the last `input`, so holding a button produces one `change`. */
  change: CustomEvent<{ value: number }>;
}

/** Keys and how far they step the value. */
const KEY_STEP: Partial<Record<string, number>> = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 };

/**
 * Integer stepper whose number rolls over a dotted wash; holding a button repeats faster and heats the dots, and
 * stepping past a limit shakes and flashes red.
 */
class HNumber extends FormMixin(HF) {
  static readonly observedAttributes = ["value", "min", "max", "label", "price", "currency", "unit"] as const;

  private v = 0;
  /** Direction of the last change: 1 up, -1 down. */
  private sgn = 1;
  /** Start time of the roll; the scan line crosses the field for 0.32 s after it. */
  private t0 = -9;
  /** 0–1 heat built up by holding a button; tints the number, raises the wash and throws sparks. */
  private heat = 0;
  /** Direction of the held button; 0 when none is held. */
  private holding = 0;
  /** Time of the last out-of-range step; drives the red flash. */
  private errT = -9;
  private readonly sparks = new Sparks();
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private announceTimer: ReturnType<typeof setTimeout> | undefined;
  /** True while the element writes its own `value` attribute, so the change is not applied again. */
  private reflecting = false;
  /** Value on the first connect; form reset restores it. */
  private defaultValue = 0;

  constructor() {
    super(
      `
      :host { display: inline-block; }
      ${DISABLED_CSS}
      .lab { display: block; font-size: 12.5px; font-weight: 500; margin-bottom: 6px; }
      .f { display: flex; align-items: center; gap: 4px; border: 1px solid var(--_border); background: var(--_surface); border-radius: 13px; padding: 4px; width: max-content; }
      .b { width: 40px; height: 40px; border: 0; border-radius: 10px; background: var(--_raised); color: var(--_fg); display: grid; place-items: center; cursor: pointer; touch-action: none; transition: transform .12s; }
      .b:active { transform: scale(.92); }
      .b[aria-disabled="true"] { opacity: .4; cursor: default; }
      .mid { position: relative; width: 92px; height: 40px; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .num, input { font-family: var(--_mono); font-size: 22px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .num { position: absolute; inset: 0; display: grid; align-items: center; justify-items: center; margin: 0; padding: 0; line-height: 1; pointer-events: none; }
      .mid:focus-within .num { visibility: hidden; }
      input { position: absolute; inset: 0; width: 100%; border: 0; background: none; text-align: center; color: transparent; caret-color: var(--_accent); outline: none; padding: 0; }
      input:focus { color: var(--_fg); }
      .u { display: grid; font-size: 12.5px; color: var(--_muted); margin-top: 8px; font-variant-numeric: tabular-nums; }
      `,
      `<label class="lab" for="in"></label><div class="f"><button class="b dn" type="button" aria-label="Decrease"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button><div class="mid"><canvas class="px" aria-hidden="true"></canvas><span class="rollslot num" aria-hidden="true"></span><input id="in" inputmode="numeric" role="spinbutton"></div><button class="b up" type="button" aria-label="Increase"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10M7 2v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div><span class="rollslot u"></span><span class="sr" aria-live="polite"></span>`,
      2,
      0.74,
    );
    const input = this.$("input");
    input.addEventListener("focus", () => {
      input.value = String(this.v);
      input.select();
      this.kick();
    });
    input.addEventListener("blur", () => {
      const n = parseInt(input.value, 10);
      if (Number.isFinite(n)) this.setValue(n, true);
      input.value = "";
      this.kick();
    });
    // the host fires its own `input` event with the value; keep the field's native one inside
    input.addEventListener("input", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      const d = KEY_STEP[e.key];
      if (d) {
        e.preventDefault();
        this.bump(d);
        input.value = String(this.v);
      }
    });
    this.wireStepButton(this.$<HTMLButtonElement>(".dn"), -1);
    this.wireStepButton(this.$<HTMLButtonElement>(".up"), 1);
  }

  /**
   * Press-and-hold repeat for a − or + button: after 420 ms, speeding up from 160 ms to 35 ms per step, until the
   * pointer is released or a limit is reached.
   */
  private wireStepButton(button: HTMLButtonElement, d: number): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interval = 160;
    const stop = (): void => {
      clearTimeout(timer);
      this.holding = 0;
      this.kick();
    };
    const repeat = (): void => {
      if (!this.bump(d)) {
        stop();
        return;
      }
      interval = Math.max(35, interval * 0.86);
      this.holding = d;
      timer = setTimeout(repeat, interval);
    };
    button.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      try {
        button.setPointerCapture(e.pointerId);
      } catch {
        // throws for a pointer that is no longer active; stepping works without capture
      }
      clearTimeout(timer);
      if (!this.bump(d)) return;
      interval = 160;
      timer = setTimeout(repeat, 420);
    });
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("lostpointercapture", stop);
    button.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.bump(d);
      }
    });
  }

  /** The `min` attribute, or 1. */
  get min(): number {
    return this.num("min", 1);
  }

  /** The `max` attribute, or 50. */
  get max(): number {
    return this.num("max", 50);
  }

  /** Current value. Setting it writes the `value` attribute; no events fire. */
  get value(): number {
    return this.v;
  }

  set value(v: number) {
    this.setAttribute("value", String(v));
  }

  private get labelText(): string {
    return this.getAttribute("label") || "Seats";
  }

  protected override init(): void {
    this.$(".lab").textContent = this.labelText;
    this.v = clamp(Math.round(this.num("value", 5)), this.min, this.max);
    this.defaultValue = this.v;
    this.sync(false);
  }

  attributeChangedCallback(name: string): void {
    if (!this.initialized || this.reflecting) return;
    if (name === "value") {
      this.setValue(this.num("value", this.v), false);
      return;
    }
    // a new label, limit or price line: re-clamp the value and refresh the text and ARIA
    this.$(".lab").textContent = this.labelText;
    const v = clamp(this.v, this.min, this.max);
    if (v !== this.v) this.setValue(v, false);
    else this.sync(false);
  }

  /** Restores the value from the first connect, without events. */
  formResetCallback(): void {
    this.setValue(this.defaultValue, false);
  }

  /** Disables the field and buttons while the element or its fieldset is disabled. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    for (const control of this.$$<HTMLInputElement | HTMLButtonElement>("input, .b")) control.disabled = disabled;
  }

  /** Step by `d`; past a limit the field shakes and flashes red instead. Returns whether the value changed. */
  private bump(d: number): boolean {
    const n = this.v + d;
    if (n < this.min || n > this.max) {
      this.errT = now();
      shake(this.$(".f"));
      this.kick();
      return false;
    }
    this.setValue(n, true);
    this.heat = Math.min(1, this.heat + 0.08);
    return true;
  }

  /** Set the rounded, clamped value; `user` fires `input` and, 300 ms after the last one, `change`. */
  private setValue(value: number, user: boolean): void {
    if (!Number.isFinite(value)) return;
    const n = clamp(Math.round(value), this.min, this.max);
    if (n === this.v) return;
    this.sgn = n > this.v ? 1 : -1;
    this.v = n;
    this.t0 = now();
    this.sync(true);
    if (user) {
      this.emit<{ value: number }>("input", { value: n });
      clearTimeout(this.changeTimer);
      this.changeTimer = setTimeout(() => this.emit<{ value: number }>("change", { value: this.v }), 300);
    }
    this.kick();
  }

  /** Update the line below, the spinbutton, the buttons, the reflected attribute and the form value. */
  private sync(animate: boolean): void {
    const price = this.num("price", NaN);
    const currency = this.getAttribute("currency") || "€";
    const text = Number.isFinite(price)
      ? `${this.v} × ${currency}${price} = ${currency}${fmtInt(this.v * price)} / month`
      : this.getAttribute("unit") || "";
    // while a button is held the values change faster than a roll, so they swap and stay readable
    const roll = animate && !this.holding;
    rollText(this.$(".u"), text, this.sgn, roll);
    rollText(this.$(".num"), String(this.v), this.sgn, roll);
    const input = this.$("input");
    input.setAttribute("aria-valuenow", String(this.v));
    input.setAttribute("aria-valuemin", String(this.min));
    input.setAttribute("aria-valuemax", String(this.max));
    // aria-disabled rather than disabled: a button that reaches its limit keeps focus, and pressing it again
    // shows the limit cue
    this.$(".dn").setAttribute("aria-disabled", String(this.v <= this.min));
    this.$(".up").setAttribute("aria-disabled", String(this.v >= this.max));
    this.reflecting = true;
    this.setAttribute("value", String(this.v));
    this.reflecting = false;
    this.setFormValue(String(this.v));
    if (!animate) return;
    // one announcement once the value rests, not one per step while a button is held
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => {
      this.$(".sr").textContent = text ? `${this.labelText} ${this.v}. ${text}` : `${this.labelText} ${this.v}`;
    }, 300);
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const C = F.cols;
    const R = F.rows;
    if (!this.holding) this.heat = Math.max(0, this.heat - dt * 1.4);
    if (this.holding && Math.random() < this.heat * 0.5) {
      this.sparks.add(this.holding > 0 ? this.w - 4 : 4, this.h / 2, 1, [P.accent, P.shine], {
        speed: [30, 90],
        life: [0.2, 0.45],
        angle: this.holding > 0 ? 0 : Math.PI,
        spread: 1.6,
      });
    }
    const e = reducedMotion ? 1 : clamp((t - this.t0) / 0.32, 0, 1);
    const ee = ease3(e);
    const err = clamp(1 - (t - this.errT) / 0.5, 0, 1);
    const heat = this.heat;
    // a scan line follows the roll: up when the value grows, down when it shrinks
    const scanRow = e < 1 ? (this.sgn > 0 ? R + 3 - ee * (R + 6) : -3 + ee * (R + 6)) : -99;
    const washColor = err > 0 ? mix(P.accent, P.danger, err) : mix(P.accent, P.shine, heat * 0.6);
    // the wash rises from the bottom edge and grows with heat
    const washTop = 0.58 - heat * 0.18;
    F.clear();
    for (let j = 0; j < R; j++) {
      const v = (j + 0.5) / R;
      const wash = smooth(washTop, 1, v);
      const washAlpha = wash * wash * (0.42 + heat * 0.5 + err * 0.4);
      const scan = Math.max(0, 1 - Math.abs(j - scanRow) / 2.5);
      for (let i = 0; i < C; i++) {
        // the edges of the wash fade out toward the buttons
        const side = smooth(0, 0.22, Math.min(i, C - 1 - i) / C);
        if (scan > 0 && bayer(i, j) < 0.75) {
          F.put(i, j, mix(P.accent, P.shine, 0.3), scan * 0.85 * (1 - ee * 0.4) * side, scan * 0.4);
        } else if (washAlpha > 0.02) {
          F.put(i, j, washColor, washAlpha * side, (heat * 0.5 + err * 0.4) * wash);
        }
      }
    }
    this.flush(0.85, 4);
    // the number itself is text; heat tints it toward the accent, a limit hit flashes it red
    const num = this.$(".num");
    num.style.color = css(err > 0 ? mix(P.fg, P.danger, err) : mix(P.fg, P.accent, heat * 0.55));
    num.style.textShadow = heat > 0.02 && this.dark ? `0 0 ${(4 + heat * 8).toFixed(1)}px ${css(P.accent, heat)}` : "none";
    const ctx = this.ctx;
    const sparking = ctx ? this.sparks.step(ctx, dt) : false;
    return e < 1 || this.heat > 0 || err > 0 || sparking || this.holding !== 0;
  }
}

define("hf-number", HNumber);

declare global {
  interface HTMLElementTagNameMap {
    "hf-number": HNumber;
  }
}

export { HNumber };
