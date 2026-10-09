/**
 * <hf-segmented> · Segmented control
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/segmented
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-segmented.tsx.
 */
import { DISABLED_CSS, FormMixin, HF, checkRadio, define, fbm, mix, radioKeys, reduced } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-segmented>`. */
export interface HSegmentedEventMap {
  /** Fires when the user selects a different option. `value` is the option label. Not fired for changes from code. */
  change: CustomEvent<{ value: string }>;
}

/** One edge of the selection slab, pulled toward its button by a spring. */
interface SpringEdge {
  /** Position in canvas pixels. */
  x: number;
  /** Velocity in px/s. */
  v: number;
}

/** Spring stiffness of the edge that leads toward the new option; the trailing edge uses {@link TRAIL}. */
const LEAD = 700;
const TRAIL = 220;

const DEFAULT_OPTIONS = "Chat,Code,Ultracode";

/** Advance a damped spring (damping ratio 0.78) by `h` seconds, semi-implicit Euler. */
function springStep(edge: SpringEdge, target: number, stiffness: number, h: number): void {
  edge.v += (stiffness * (target - edge.x) - 2 * Math.sqrt(stiffness) * 0.78 * edge.v) * h;
  edge.x += edge.v * h;
}

/**
 * Segmented radio group whose selected slab stretches toward the new option on a spring. Form-associated; arrow
 * keys move it.
 */
class HSegmented extends FormMixin(HF) {
  static readonly observedAttributes = ["options", "value", "label"] as const;

  private idx = 0;
  /** Option selected on the first connect; form reset returns to it. */
  private defaultIdx = 0;
  /** Direction of the last change: 1 to the right, -1 to the left, 0 before any change. */
  private dirn = 0;
  private readonly left: SpringEdge = { x: 0, v: 0 };
  private readonly right: SpringEdge = { x: 0, v: 0 };
  /** Jump to the target on the next frame instead of springing (first frame, resize). */
  private snap = true;
  /** True while the element writes its own `value` attribute, so the change is not handled again. */
  private reflecting = false;

  constructor() {
    super(
      `
      :host { display: inline-block; max-width: 100%; }
      ${DISABLED_CSS}
      .seg { position: relative; display: flex; padding: 4px; border-radius: 12px; background: var(--_track); }
      canvas.px { position: absolute; inset: 0; height: 100%; border-radius: 12px; }
      .seg button { flex: 1; position: relative; z-index: 1; border: 0; background: none; padding: 8px 16px; border-radius: 9px; font-size: 13.5px; font-weight: 500; color: var(--_muted); cursor: pointer; white-space: nowrap; transition: color .2s; }
      .seg button[aria-checked="true"] { color: var(--_fg); font-weight: 600; }
      .seg button:focus-visible { outline: 2px solid var(--_accent); outline-offset: -2px; }
      `,
      `<div class="seg" role="radiogroup"><canvas class="px" aria-hidden="true"></canvas></div>`,
      2,
      0.7,
    );
    const seg = this.$(".seg");
    seg.addEventListener("click", (e) => {
      const button = e.target instanceof Element ? e.target.closest("button") : null;
      if (button) this.select(this.buttons.indexOf(button), true);
    });
    radioKeys(
      seg,
      () => this.buttons,
      () => this.idx,
      (index) => this.select(index, true),
    );
  }

  /** Option labels parsed from the `options` attribute; empty entries are skipped. */
  get options(): string[] {
    const options = (this.getAttribute("options") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return options.length ? options : DEFAULT_OPTIONS.split(",");
  }

  /** Label of the selected option. Setting it writes the `value` attribute; no event fires. */
  get value(): string {
    return this.options[this.idx] ?? "";
  }

  set value(value: string) {
    this.setAttribute("value", value);
  }

  protected override init(): void {
    this.build();
    this.defaultIdx = this.idx;
  }

  attributeChangedCallback(name: string): void {
    if (!this.initialized || this.reflecting) return;
    if (name === "options") this.build();
    else if (name === "label") this.$(".seg").setAttribute("aria-label", this.getAttribute("label") || "Mode");
    else {
      const i = this.options.indexOf(this.getAttribute("value") ?? "");
      if (i >= 0) this.select(i, false);
    }
  }

  /** Returns to the option selected on the first connect, without firing `change`. */
  formResetCallback(): void {
    this.select(Math.min(this.defaultIdx, this.buttons.length - 1), false);
  }

  /** Disables the options while the element or its fieldset is disabled. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    for (const button of this.buttons) button.disabled = disabled;
  }

  /** (Re)create one button per option and select the `value` attribute, the first option otherwise. */
  private build(): void {
    const seg = this.$(".seg");
    const opts = this.options;
    seg.setAttribute("aria-label", this.getAttribute("label") || "Mode");
    for (const button of this.buttons) button.remove();
    for (const label of opts) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("role", "radio");
      // options rebuilt while the element is disabled stay disabled
      button.disabled = this.formDisabled;
      seg.appendChild(button);
    }
    this.idx = Math.max(0, opts.indexOf(this.getAttribute("value") ?? ""));
    this.snap = true;
    this.sync();
  }

  private get buttons(): HTMLButtonElement[] {
    return this.$$<HTMLButtonElement>(".seg button");
  }

  /** Check the selected option, keep it the only tab stop, reflect `value` and submit it. */
  private sync(): void {
    checkRadio(this.buttons, this.idx);
    this.reflecting = true;
    this.setAttribute("value", this.value);
    this.reflecting = false;
    this.setFormValue(this.value);
    this.kick();
  }

  /** Select option `i`; `user` fires `change`. */
  private select(i: number, user: boolean): void {
    if (i === this.idx || i < 0) return;
    this.dirn = i > this.idx ? 1 : -1;
    this.idx = i;
    this.sync();
    if (user) this.emit<{ value: string }>("change", { value: this.value });
  }

  protected override layout(): void {
    this.snap = true;
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const selected = this.buttons[this.idx];
    if (!selected) return false;
    const left = this.left;
    const right = this.right;
    const targetL = selected.offsetLeft;
    const targetR = selected.offsetLeft + selected.offsetWidth;
    if (this.snap || reducedMotion) {
      left.x = targetL;
      right.x = targetR;
      left.v = right.v = 0;
      this.snap = false;
    } else {
      // the leading edge is stiffer, so the slab stretches toward the new option before the tail follows
      const stiffL = this.dirn < 0 ? LEAD : TRAIL;
      const stiffR = this.dirn > 0 ? LEAD : TRAIL;
      for (let s = 0; s < 2; s++) {
        springStep(left, targetL, stiffL, dt / 2);
        springStep(right, targetR, stiffR, dt / 2);
      }
    }
    const vel = Math.abs(left.v) + Math.abs(right.v);
    const wobble = Math.min(3, vel * 0.004);
    const top = 4;
    const bottom = this.h - 4;
    const ultra = /ultra/i.test(this.value);
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const off = Math.sin(x * 0.09 + t * 7) * wobble;
        const inX = x >= left.x + 2 && x <= right.x - 2;
        const inY = y >= top + off && y <= bottom - off;
        const cx = Math.min(x - left.x, right.x - x);
        const cy = Math.min(y - top, bottom - y);
        const outsideCorner = cx < 7 && cy < 7 && Math.hypot(7 - cx, 7 - cy) > 7;
        if (inX && inY && !outsideCorner) {
          const n = fbm(x * 0.06 + t * (ultra ? 0.9 : 0.25), y * 0.12);
          const highlight = y < top + 5 ? 0.15 : 0;
          F.put(
            i,
            j,
            mix(P.accent, P.shine, n * (ultra ? 0.45 : 0.25) + highlight),
            0.42 + n * 0.22 + highlight,
            (ultra ? 0.3 : 0.12) * n,
          );
        } else {
          F.put(i, j, P.fg, 0.06);
        }
      }
    }
    this.flush(0.7, 5);
    return vel > 1 || Math.abs(targetL - left.x) + Math.abs(targetR - right.x) > 0.3 || !reducedMotion;
  }
}

define("hf-segmented", HSegmented);

declare global {
  interface HTMLElementTagNameMap {
    "hf-segmented": HSegmented;
  }
}

export { HSegmented };
