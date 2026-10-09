/**
 * <hf-switch> · Switch
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/switch
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-switch.tsx.
 */
import {
  DISABLED_CSS,
  FormMixin,
  HF,
  Sparks,
  clamp,
  define,
  fbm,
  lerp,
  mix,
  reduced,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-switch>`. */
export interface HSwitchEventMap {
  /** Fires when the user toggles the switch. Not fired when `checked` is set from code. */
  change: CustomEvent<{ checked: boolean }>;
}

const WHITE: RGB = [255, 255, 255];

/**
 * Form-associated switch whose track fills with a dithered energy field when on; the thumb springs across with
 * a few sparks.
 */
class HSwitch extends FormMixin(HF) {
  static readonly observedAttributes = ["checked", "value"] as const;

  /** Sprung thumb position, 0 (off) to 1 (on); overshoots slightly. */
  private p = 0;
  /** Thumb velocity. */
  private vp = 0;
  /** Fill front of the energy field, 0 to 1. */
  private f = 0;
  private readonly sparks = new Sparks();
  /** Checked state on the first connect; form reset restores it. */
  private defaultChecked = false;

  constructor() {
    super(
      `
      :host { display: block; }
      ${DISABLED_CSS}
      .row { display: flex; align-items: center; justify-content: space-between; gap: 18px; cursor: pointer; -webkit-user-select: none; user-select: none; }
      .txt { display: grid; gap: 2px; min-width: 0; }
      .t { font-size: 14px; font-weight: 500; }
      .h { font-size: 12.5px; color: var(--_muted); }
      .sw { width: 58px; height: 32px; border: 0; padding: 0; border-radius: 16px; background: var(--_track); flex: none; cursor: pointer; }
      .sw:focus-visible { outline: 2px solid var(--_accent); outline-offset: 3px; }
      canvas.px { width: 58px; height: 32px; border-radius: 16px; }
      `,
      `<div class="row"><span class="txt"><span class="t"><slot>Ultracode</slot></span><span class="h" id="h"><slot name="hint"></slot></span></span><button class="sw" type="button" role="switch" aria-checked="false" aria-describedby="h"><canvas class="px" aria-hidden="true"></canvas></button></div>`,
      2,
      0.72,
    );
    this.$(".row").addEventListener("click", () => this.toggle());
    this.labelSlot.addEventListener("slotchange", () => this.syncLabel());
  }

  /** Reflects the `checked` attribute. */
  get checked(): boolean {
    return this.hasAttribute("checked");
  }

  set checked(value: boolean) {
    // coerced: an untyped caller passing undefined would otherwise toggle the attribute
    this.toggleAttribute("checked", Boolean(value));
  }

  protected override init(): void {
    this.defaultChecked = this.checked;
    this.p = this.f = this.checked ? 1 : 0;
    this.sync();
    this.syncLabel();
  }

  /** Restores the checked state from the first connect, without firing `change`. */
  formResetCallback(): void {
    this.checked = this.defaultChecked;
  }

  /** Disables the switch while the element or its fieldset is disabled. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    this.$<HTMLButtonElement>(".sw").disabled = disabled;
  }

  attributeChangedCallback(): void {
    if (!this.initialized) return;
    this.sync();
    this.kick();
  }

  private get labelSlot(): HTMLSlotElement {
    return this.$<HTMLSlotElement>("slot:not([name])");
  }

  /** The accessible name follows the text in the default slot. */
  private syncLabel(): void {
    const text = this.labelSlot
      .assignedNodes({ flatten: true })
      .map((node) => node.textContent)
      .join("")
      .trim();
    this.$(".sw").setAttribute("aria-label", text || "Switch");
  }

  private sync(): void {
    this.$(".sw").setAttribute("aria-checked", String(this.checked));
    this.setFormValue(this.checked ? this.getAttribute("value") || "on" : null);
  }

  private toggle(): void {
    this.checked = !this.checked;
    if (this.checked) {
      const P = this.P;
      this.sparks.add(this.w - 16, 16, 14, [P.accent, P.shine], { speed: [30, 110], life: [0.25, 0.55] });
    }
    this.emit<{ checked: boolean }>("change", { checked: this.checked });
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const on = this.checked ? 1 : 0;
    const w = this.w;
    const h = this.h;
    const r = h / 2;
    if (reducedMotion) {
      this.p = on;
      this.vp = 0;
    } else {
      const stiffness = 260;
      const damping = 2 * Math.sqrt(stiffness) * 0.62;
      this.vp += (stiffness * (on - this.p) - damping * this.vp) * dt;
      this.p += this.vp * dt;
    }
    this.f = reducedMotion ? on : this.f + clamp(on - this.f, -dt * 3, dt * 2.2);
    const thumbX = lerp(r, w - r, clamp(this.p, -0.05, 1.05));
    const thumbR = r - 3.5;
    const front = this.f * (w + 10) - 5;
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        // distance to the centre line of the pill-shaped track
        const dx = x - clamp(x, r, w - r);
        if (Math.hypot(dx, y - r) > r - 0.5) continue;
        const thumbD = Math.hypot(x - thumbX, y - r);
        if (thumbD < thumbR) {
          const shade = 1 - ((y - (r - thumbR)) / (2 * thumbR)) * 0.25;
          const edge = thumbD > r - 6;
          const col = edge ? mix(WHITE, P.fg, 0.35) : mix(WHITE, P.accent, this.f * 0.12 * (1 - shade));
          F.put(i, j, col, 1, this.f * 0.25);
          continue;
        }
        if (x < front) {
          const e = reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(x * 0.32 - t * 9 + fbm(x * 0.08, y * 0.12 + t) * 4);
          F.put(i, j, mix(P.accent, P.shine, e * 0.35), 0.5 + 0.4 * e, e * 0.45);
        } else {
          F.put(i, j, P.fg, 0.14);
        }
      }
    }
    this.flush(0.9, 4);
    const sparking = this.sparks.step(ctx, dt);
    return (
      (this.f > 0.01 && !reducedMotion) ||
      Math.abs(this.p - on) > 0.001 ||
      Math.abs(this.vp) > 0.01 ||
      Math.abs(this.f - on) > 0.001 ||
      sparking
    );
  }
}

define("hf-switch", HSwitch);

declare global {
  interface HTMLElementTagNameMap {
    "hf-switch": HSwitch;
  }
}

export { HSwitch };
