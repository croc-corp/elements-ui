/**
 * <hf-chips> · Filter chips
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/chips
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-chips.tsx.
 */
import {
  FormMixin,
  HF,
  bayer,
  boxMapper,
  clamp,
  define,
  ease3,
  escapeHtml,
  localPoint,
  mix,
  reduced,
  segDist,
  type Point,
  type RGB,
} from "@/lib/lumesec/pixel";

/** A parsed `Label:count` chip of the `options` attribute. */
export interface HChipsOption {
  label: string;
  /** Count shown after the label, if given. */
  count?: string;
}

/** Events fired by `<hf-chips>`. */
export interface HChipsEventMap {
  /** Fires when the user toggles a chip or presses Clear. `value` lists the selected labels in option order. */
  change: CustomEvent<{ value: string[] }>;
}

/** Runtime state of one chip. */
interface Chip {
  label: string;
  el: HTMLButtonElement;
  on: boolean;
  /** Eased 0–1 fill. */
  f: number;
  /** Click point inside the chip the fill floods from; null floods from the centre. */
  from: Point | null;
  /** Eased 0–1 hover amount. */
  hv: number;
}

const DEFAULT_OPTIONS = "TypeScript:128,Python:96,Rust:41,Go:37,SQL:22,Shell:18,Swift:9";
const DEFAULT_VALUE = "TypeScript,Rust";

/** Labels of a comma-separated `value`. */
const parseLabels = (value: string): Set<string> => new Set(value.split(",").map((s) => s.trim()));

const WHITE: RGB = [255, 255, 255];

/** The check mark as two strokes through three points, relative to its centre. */
const CHECK_A: Point = [-4.5, 0];
const CHECK_B: Point = [-1.5, 3];
const CHECK_C: Point = [4.5, -3.5];
const CHECK_L1 = Math.hypot(3, 3);
const CHECK_L2 = Math.hypot(6, 6.5);

/**
 * Multi-select filter chips: selecting floods a chip with dots from the click point and draws a check. Submits one
 * value per chip.
 */
class HChips extends FormMixin(HF) {
  static readonly observedAttributes = ["value", "options", "label"] as const;

  private chips: Chip[] = [];
  /** Index of the hovered chip; -1 for none. */
  private hover = -1;
  /** True while the element writes its own `value` attribute, so the change is not applied again. */
  private reflecting = false;
  /** The selection a form reset restores: the `value` set by markup or code, not by the user. */
  private defaultValue = DEFAULT_VALUE;

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; }
      .t { font-weight: 600; font-size: 13.5px; }
      .clr { border: 0; background: none; color: var(--_accent); font-weight: 500; font-size: 12.5px; cursor: pointer; padding: 2px 4px; border-radius: 6px; }
      .clr:disabled { color: var(--_muted); cursor: default; opacity: .7; }
      .g { position: relative; display: flex; flex-wrap: wrap; gap: 8px; }
      canvas.px { position: absolute; left: -6px; top: -6px; width: calc(100% + 12px); height: calc(100% + 12px); pointer-events: none; }
      .c { position: relative; display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: 99px; border: 0; background: none; font-size: 13px; font-weight: 500; cursor: pointer; color: var(--_fg); transition: transform .15s cubic-bezier(.2,.8,.2,1), padding .25s cubic-bezier(.2,.8,.2,1); }
      .c:active { transform: scale(.95); }
      .c[aria-pressed="true"] { padding-left: 30px; font-weight: 600; }
      .c:disabled { cursor: default; opacity: .55; }
      .c:disabled:active { transform: none; }
      .c b { font-weight: 500; font-size: 11.5px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      `,
      `<div class="hd"><span class="t" id="t"></span><button class="clr" type="button"></button></div><div class="g" role="group" aria-labelledby="t"><canvas class="px" aria-hidden="true"></canvas></div>`,
      2,
      0.72,
    );
    const clear = this.$<HTMLButtonElement>(".clr");
    clear.addEventListener("click", () => {
      // Clear disables itself once nothing is selected; keep keyboard focus in the group
      const hadFocus = this.root.activeElement === clear;
      this.chips.forEach((chip, k) => {
        if (chip.on) this.toggle(k, null, true);
      });
      this.changed();
      if (hadFocus) this.chips[0]?.el.focus();
    });
  }

  /** The parsed `options`: `Label:count` entries split at the last colon; empty entries are skipped. */
  get options(): HChipsOption[] {
    return (this.getAttribute("options") || DEFAULT_OPTIONS)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.lastIndexOf(":");
        if (i < 0) return { label: s };
        const count = s.slice(i + 1).trim();
        return count ? { label: s.slice(0, i).trim(), count } : { label: s.slice(0, i).trim() };
      });
  }

  /** Selected labels. Setting accepts an array or a comma-separated string and writes the `value` attribute. */
  get value(): string[] {
    return this.chips.filter((chip) => chip.on).map((chip) => chip.label);
  }

  set value(v: string[] | string) {
    this.setAttribute("value", Array.isArray(v) ? v.join(",") : v);
  }

  protected override init(): void {
    this.renderLabel();
    // omitting `value` selects the demo pair; `value=""` starts with nothing selected
    this.defaultValue = this.getAttribute("value") ?? DEFAULT_VALUE;
    this.build(parseLabels(this.defaultValue));
  }

  /** Called by the browser when the `disabled` attribute or a disabled ancestor `<fieldset>` changes. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    this.hover = -1;
    if (this.initialized) this.sync();
  }

  /** Restores the selection from the `value` set by markup or code. */
  formResetCallback(): void {
    if (this.initialized) this.applySelection(parseLabels(this.defaultValue));
  }

  private renderLabel(): void {
    this.$(".t").textContent = this.getAttribute("label") || "Languages";
  }

  /** (Re)create the chip buttons from `options` with `selected` turned on. */
  private build(selected: Set<string>): void {
    const group = this.$(".g");
    const focused = this.chips.findIndex((chip) => chip.el === this.root.activeElement);
    this.chips.forEach((chip) => chip.el.remove());
    this.hover = -1;
    this.chips = this.options.map((o, k): Chip => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "c";
      button.innerHTML = `${escapeHtml(o.label)}${o.count ? `<b>${escapeHtml(o.count)}</b>` : ""}`;
      button.addEventListener("click", (e) => {
        // a click from the keyboard (detail 0) has no pointer position; it floods from the centre
        this.toggle(k, e.detail ? localPoint(button, e) : null);
        this.changed();
      });
      button.addEventListener("pointerenter", () => {
        this.hover = k;
        this.kick();
      });
      button.addEventListener("pointerleave", () => {
        if (this.hover === k) this.hover = -1;
        this.kick();
      });
      group.append(button);
      const on = selected.has(o.label);
      button.setAttribute("aria-pressed", String(on));
      return { label: o.label, el: button, on, f: on ? 1 : 0, from: null, hv: 0 };
    });
    // keep keyboard focus on the same chip position after a rebuild
    if (focused >= 0) this.chips[Math.min(focused, this.chips.length - 1)]?.el.focus();
    this.sync();
  }

  attributeChangedCallback(name: string): void {
    // before the first connect, init() reads every attribute
    if (!this.initialized) return;
    if (name === "label") this.renderLabel();
    else if (name === "options") this.build(new Set(this.value));
    else if (!this.reflecting) {
      this.defaultValue = this.getAttribute("value") ?? "";
      this.applySelection(parseLabels(this.defaultValue));
    }
  }

  /** Turn on exactly the chips in `selected`, without a `change` event. */
  private applySelection(selected: Set<string>): void {
    this.chips.forEach((chip, k) => {
      if (chip.on !== selected.has(chip.label)) this.toggle(k, null, true);
    });
    this.sync();
  }

  /** Flip chip `k`; `from` is the click point the fill floods from. `quiet` defers the sync to the caller. */
  private toggle(k: number, from: Point | null, quiet = false): void {
    const chip = this.chips[k];
    chip.on = !chip.on;
    chip.from = from;
    chip.el.setAttribute("aria-pressed", String(chip.on));
    if (!quiet) this.sync();
    this.kick();
  }

  private changed(): void {
    this.sync();
    this.emit<{ value: string[] }>("change", { value: this.value });
  }

  /** Update the Clear button, reflect the attribute and submit one form value per selected chip. */
  private sync(): void {
    const value = this.value;
    const n = value.length;
    const clear = this.$<HTMLButtonElement>(".clr");
    clear.textContent = n ? `Clear (${n})` : "Clear";
    clear.disabled = !n || this.formDisabled;
    this.chips.forEach((chip) => {
      chip.el.disabled = this.formDisabled;
    });
    this.reflecting = true;
    this.setAttribute("value", value.join(","));
    this.reflecting = false;
    const name = this.getAttribute("name");
    if (name) {
      const data = new FormData();
      value.forEach((v) => data.append(name, v));
      this.setFormValue(data);
    } else this.setFormValue(value.join(","));
  }

  protected override render(_t: number, dt: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const pitch = F.pitch;
    const local = boxMapper(canvas);
    let busy = false;
    F.clear();
    this.chips.forEach((chip, k) => {
      const { x: x0, y: y0, w, h } = local(chip.el);
      const rr = h / 2;
      chip.f += ((chip.on ? 1 : 0) - chip.f) * Math.min(1, reducedMotion ? 1 : dt * 7);
      chip.hv += ((this.hover === k ? 1 : 0) - chip.hv) * Math.min(1, dt * 12);
      if (Math.abs(chip.f - (chip.on ? 1 : 0)) > 0.005 || Math.abs(chip.hv - (this.hover === k ? 1 : 0)) > 0.01) {
        busy = true;
      }
      // the fill floods out of the click point
      const fx = chip.from ? chip.from[0] : w / 2;
      const fy = chip.from ? chip.from[1] : h / 2;
      const maxR = Math.hypot(Math.max(fx, w - fx), h) + 4;
      const rad = ease3(chip.f) * maxR;
      for (let j = Math.floor(y0 / pitch); j < (y0 + h) / pitch; j++) {
        for (let i = Math.floor(x0 / pitch); i < (x0 + w) / pitch; i++) {
          const [x, y] = F.xy(i, j);
          const lx = x - x0;
          const ly = y - y0;
          const qx = Math.max(rr - lx, lx - (w - rr), 0);
          const qy = Math.max(rr - ly, ly - (h - rr), 0);
          const sd = Math.hypot(qx, qy) - rr;
          if (sd > 0.5) continue;
          const edge = sd > -1.7;
          const inFill = Math.hypot(lx - fx, ly - fy) < rad;
          if (edge) {
            F.put(
              i,
              j,
              inFill ? mix(P.accent, P.shine, 0.25) : mix(P.muted, P.accent, chip.hv * 0.6),
              inFill ? 1 : 0.45 + chip.hv * 0.35,
              inFill ? 0.3 : 0,
            );
            continue;
          }
          if (inFill) {
            if (bayer(i, j) < 0.72) F.put(i, j, mix(P.accent, P.surface, this.dark ? 0.62 : 0.72), 1, 0);
          } else if (chip.hv > 0.02 && bayer(i, j) < 0.18 * chip.hv) F.put(i, j, P.accent, 0.4 * chip.hv);
        }
      }
      // pixel check that draws itself in
      if (chip.f > 0.05) {
        const cx = x0 + 15;
        const cy = y0 + h / 2;
        const prog = clamp(chip.f * 1.3 - 0.2, 0, 1);
        const drawn = prog * (CHECK_L1 + CHECK_L2);
        for (let j = Math.floor((cy - 7) / pitch); j <= (cy + 7) / pitch; j++) {
          for (let i = Math.floor((cx - 7) / pitch); i <= (cx + 7) / pitch; i++) {
            const [x, y] = F.xy(i, j);
            const lx = x - cx;
            const ly = y - cy;
            const d1 = segDist(lx, ly, CHECK_A[0], CHECK_A[1], CHECK_B[0], CHECK_B[1]);
            const d2 = segDist(lx, ly, CHECK_B[0], CHECK_B[1], CHECK_C[0], CHECK_C[1]);
            // distance along the stroke, to draw it from start to end
            const u1 = clamp(((lx - CHECK_A[0]) * 3 + (ly - CHECK_A[1]) * 3) / (CHECK_L1 * CHECK_L1), 0, 1) * CHECK_L1;
            const u2 =
              CHECK_L1 +
              clamp(((lx - CHECK_B[0]) * 6 + (ly - CHECK_B[1]) * -6.5) / (CHECK_L2 * CHECK_L2), 0, 1) * CHECK_L2;
            if ((d1 < 1.3 && u1 <= drawn) || (d2 < 1.3 && u2 <= drawn)) {
              F.put(i, j, this.dark ? WHITE : P.accent, chip.f, 0.5 * chip.f);
            }
          }
        }
      }
    });
    this.flush(0.75, 4);
    return busy;
  }
}

define("hf-chips", HChips);

declare global {
  interface HTMLElementTagNameMap {
    "hf-chips": HChips;
  }
}

export { HChips };
