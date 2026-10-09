/**
 * <hf-wheel> · Time picker wheel
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/wheel
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-wheel.tsx.
 */
import {
  DISABLED_CSS,
  FormMixin,
  HF,
  bayer,
  clamp,
  css,
  define,
  lerp,
  mix,
  now,
  pad2,
  reduced,
  rollText,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-wheel>`. */
export interface HWheelEventMap {
  /**
   * Fires when the wheel settles on a new value after a drag, fling, wheel scroll or key press. `value` is `HH:MM`.
   * Not fired when `value` is set from code.
   */
  change: CustomEvent<{ value: string }>;
}

/** One column of the wheel. Positions count rows; row `r` shows value `r mod n`. */
interface WheelColumn {
  /** Number of distinct values: 24 hours, or 60 / step minutes. */
  n: number;
  /** Current scroll position in rows. */
  pos: number;
  /** Velocity in rows per second. */
  v: number;
  /** Row to settle on; null to settle on the nearest row. */
  goal: number | null;
  drag: boolean;
  /** Time until which a wheel scroll holds the column still. */
  hold: number;
  /** Row the column last settled on. */
  at: number;
}

/** Keys and how many rows they move a column. */
const KEY_ROWS: Partial<Record<string, number>> = { ArrowUp: -1, ArrowDown: 1, PageUp: -3, PageDown: 3 };

/** The minute step of a `step` attribute value: rounded and clamped to 1–30, 5 when missing. */
const minuteStepOf = (value: string | null): number => {
  const step = parseFloat(value ?? "");
  return Number.isFinite(step) ? clamp(Math.round(step), 1, 30) : 5;
};

const WHITE: RGB = [255, 255, 255];

/** Height of a row on the cylinder's front, in pixels. */
const ROW_H = 34;
/** Angle in radians between two rows on the cylinder. */
const ROW_ANGLE = 0.34;
/** Rows set per column: the visible arc spans at most 12 positions. */
const POOL = 12;

/** `value` wrapped into `[0, n)`. */
const wrap = (value: number, n: number): number => ((value % n) + n) % n;

/**
 * Two-column time picker wheel: rows of digits curve on a cylinder over a dotted selection band, flings carry inertia
 * and snap to a value that submits as HH:MM.
 */
class HWheel extends FormMixin(HF) {
  static readonly observedAttributes = ["value", "step", "label"] as const;

  /** Hours and minutes. */
  private readonly columns: readonly [WheelColumn, WheelColumn] = [
    { n: 24, pos: 9, v: 0, goal: null, drag: false, hold: 0, at: 9 },
    { n: 12, pos: 6, v: 0, goal: null, drag: false, hold: 0, at: 6 },
  ];
  /** True while the element writes its own `value` attribute, so the change is not applied again. */
  private reflecting = false;
  /** A column settled on a new value; `change` fires once every column is still. */
  private changePending = false;
  /** Whether the motion in progress comes from the user; programmatic changes fire no `change`. */
  private userMove = false;
  /** The minute step the minute column is built for. */
  private minuteStep = 5;
  /** Time on the first connect; form reset restores it. */
  private defaultValue = "09:30";
  /** The digit rows of each column, positioned on the cylinder every frame. */
  private readonly rowEls: readonly [HTMLSpanElement[], HTMLSpanElement[]];
  private readonly colon: HTMLElement;

  constructor() {
    super(
      `
      :host { display: inline-block; }
      ${DISABLED_CSS}
      .lab { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 12.5px; font-weight: 500; margin-bottom: 6px; }
      .lab .v { color: var(--_muted); font-weight: 400; font-variant-numeric: tabular-nums; }
      .w { position: relative; width: 236px; height: 188px; touch-action: none; -webkit-user-select: none; user-select: none; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .dg { position: absolute; inset: 0; pointer-events: none; font-family: var(--_mono); font-size: 23px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--_muted); -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 30px, #000 calc(100% - 30px), transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, #000 30px, #000 calc(100% - 30px), transparent 100%); }
      .cl { position: absolute; top: 0; width: 96px; height: 100%; }
      .cl span { position: absolute; left: 0; top: 0; width: 100%; height: 24px; line-height: 24px; text-align: center; white-space: nowrap; will-change: transform, opacity; }
      .cn { position: absolute; left: 0; right: 0; top: 50%; height: 24px; margin-top: -13px; line-height: 24px; text-align: center; }
      .col { position: absolute; top: 0; bottom: 0; width: 96px; cursor: grab; border-radius: 12px; }
      .col:active { cursor: grabbing; }
      .col:focus-visible { outline: 2px solid var(--_accent); outline-offset: -2px; }
      `,
      `<div class="lab"><span class="l" id="l"></span><span class="rollslot v"></span></div>
        <div class="w" role="group" aria-labelledby="l"><canvas class="px" aria-hidden="true"></canvas><div class="dg" aria-hidden="true"><div class="cl" style="left:10px"></div><span class="cn">:</span><div class="cl" style="right:10px"></div></div><div class="col" data-c="0" tabindex="0" role="spinbutton" aria-label="Hours" style="left:10px"></div><div class="col" data-c="1" tabindex="0" role="spinbutton" aria-label="Minutes" style="right:10px"></div></div>`,
      2,
      0.72,
    );
    const pool = (column: HTMLElement): HTMLSpanElement[] =>
      Array.from({ length: POOL }, () => {
        const span = document.createElement("span");
        span.hidden = true;
        column.append(span);
        return span;
      });
    const [hours, minutes] = this.$$(".cl");
    this.rowEls = [pool(hours), pool(minutes)];
    this.colon = this.$(".cn");
    this.$$(".col").forEach((el) => this.wireColumn(el, this.columns[Number(el.dataset.c)]));
  }

  /** Pointer, wheel and keyboard handling for one column. */
  private wireColumn(el: HTMLElement, c: WheelColumn): void {
    let lastY = 0;
    let lastT = 0;
    let moved = 0;
    // client pixels per CSS pixel, below 1 inside a zoomed or scaled ancestor; measured when a drag starts
    let scale = 1;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // throws for a pointer that is no longer active; dragging works without capture
      }
      scale = el.getBoundingClientRect().height / el.offsetHeight || 1;
      this.userMove = true;
      c.drag = true;
      c.goal = null;
      c.v = 0;
      lastY = e.clientY;
      lastT = performance.now();
      moved = 0;
      this.kick();
    });
    el.addEventListener("pointermove", (e) => {
      if (!c.drag) return;
      const t = performance.now();
      const dy = (e.clientY - lastY) / scale;
      const elapsed = Math.max(1, t - lastT) / 1000;
      c.pos -= dy / ROW_H;
      c.v = lerp(c.v, -(dy / ROW_H) / elapsed, 0.5);
      moved += Math.abs(dy);
      lastY = e.clientY;
      lastT = t;
      this.kick();
    });
    const up = (e: PointerEvent): void => {
      if (!c.drag) return;
      c.drag = false;
      if (moved < 4) {
        // a click without dragging snaps to the row under the pointer
        const r = el.getBoundingClientRect();
        const y = (e.clientY - r.top) / scale - el.offsetHeight / 2;
        const off = Math.asin(clamp(y / (ROW_H / ROW_ANGLE), -1, 1)) / ROW_ANGLE;
        c.goal = Math.round(c.pos + off);
        c.v = 0;
      }
      // a pause before release means no fling
      if (performance.now() - lastT > 80) c.v = 0;
      this.kick();
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.userMove = true;
        c.goal = null;
        c.v = 0;
        c.pos += ((e.deltaY * (e.deltaMode === 1 ? 16 : 1)) / ROW_H) * 0.5;
        c.hold = now() + 0.14;
        this.kick();
      },
      { passive: false },
    );
    el.addEventListener("keydown", (e) => {
      const base = Math.round(c.goal ?? c.pos);
      const idx = wrap(base, c.n);
      let goal: number;
      // Home and End go to the first and last value: 00, and 23 or the last minute
      if (e.key === "Home") goal = base - idx;
      else if (e.key === "End") goal = base + (c.n - 1 - idx);
      else {
        const d = KEY_ROWS[e.key];
        if (!d) return;
        goal = base + d;
      }
      e.preventDefault();
      this.userMove = true;
      c.goal = goal;
      c.v = 0;
      this.kick();
    });
  }

  /** The effective minute step, 1 to 30. */
  get step(): number {
    return this.initialized ? this.minuteStep : minuteStepOf(this.getAttribute("step"));
  }

  /**
   * The selected time as `HH:MM`, including a time the columns are still moving to. Setting it updates the getter
   * and the `value` attribute at once, then animates the columns.
   */
  get value(): string {
    const [h, m] = this.columns.map((c) => wrap(c.goal ?? c.at, c.n));
    return `${pad2(h)}:${pad2(m * this.step)}`;
  }

  set value(v: string) {
    this.setAttribute("value", v);
  }

  protected override init(): void {
    this.minuteStep = minuteStepOf(this.getAttribute("step"));
    this.columns[1].n = Math.floor(60 / this.minuteStep);
    this.$(".l").textContent = this.getAttribute("label") || "Remind me at";
    this.apply(this.getAttribute("value") || "09:30", false);
    this.defaultValue = this.value;
  }

  attributeChangedCallback(name: string): void {
    if (!this.initialized || this.reflecting) return;
    if (name === "label") {
      this.$(".l").textContent = this.getAttribute("label") || "Remind me at";
      return;
    }
    if (name === "step") {
      // rebuild the minute column for the new step and keep the time, rounded to the new step
      const current = this.value;
      this.minuteStep = minuteStepOf(this.getAttribute("step"));
      this.columns[1].n = Math.floor(60 / this.minuteStep);
      this.apply(current, false);
    } else this.apply(this.getAttribute("value"), true);
    this.kick();
  }

  /** Restores the time from the first connect, without firing `change`. */
  formResetCallback(): void {
    this.apply(this.defaultValue, false);
    this.kick();
  }

  /** Takes both columns out of use while the element or its fieldset is disabled. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    for (const column of this.$$(".col")) {
      column.tabIndex = disabled ? -1 : 0;
      column.setAttribute("aria-disabled", String(disabled));
    }
  }

  /** Move to an `HH:MM` time along the shortest way round; `animate` spins the columns there. */
  private apply(v: string | null, animate: boolean): void {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v || "");
    if (!m) return;
    // a time set from code settles without a `change` event
    this.userMove = false;
    this.changePending = false;
    const target = [clamp(+m[1], 0, 23), Math.round(clamp(+m[2], 0, 59) / this.step) % this.columns[1].n];
    this.columns.forEach((c, k) => {
      const base = Math.round(c.pos);
      let d = target[k] - wrap(base, c.n);
      if (d > c.n / 2) d -= c.n;
      if (d < -c.n / 2) d += c.n;
      if (animate) c.goal = base + d;
      else {
        c.pos = c.at = base + d;
        c.goal = null;
      }
    });
    this.sync(animate);
  }

  /** Show the value, update the spinbuttons, reflect the attribute and submit the value. */
  private sync(animate: boolean): void {
    const v = this.value;
    rollText(this.$(".v"), v, 1, animate);
    this.$$(".col").forEach((el, k) => {
      const column = this.columns[k];
      const idx = wrap(column.at, column.n);
      const factor = k ? this.step : 1;
      el.setAttribute("aria-valuenow", String(idx * factor));
      el.setAttribute("aria-valuemin", "0");
      el.setAttribute("aria-valuemax", String((column.n - 1) * factor));
      el.setAttribute("aria-valuetext", k ? `${idx * this.step} minutes` : `${idx} hours`);
    });
    this.reflecting = true;
    this.setAttribute("value", v);
    this.reflecting = false;
    this.setFormValue(v);
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const pitch = F.pitch;
    const W = this.w;
    const cy = this.h / 2;
    const rowH = ROW_H;
    let busy = false;
    for (const c of this.columns) {
      if (c.drag) {
        busy = true;
        continue;
      }
      if (t < c.hold) {
        busy = true;
        continue;
      }
      // a fling coasts with friction before the spring takes over
      if (Math.abs(c.v) > 1.4 && c.goal == null && !reducedMotion) {
        c.pos += c.v * dt;
        c.v *= Math.exp(-dt * 3.4);
        busy = true;
        continue;
      }
      const target = c.goal ?? Math.round(c.pos);
      if (reducedMotion) {
        c.pos = target;
        c.v = 0;
      } else {
        const k = 180;
        const damping = 2 * Math.sqrt(k) * 0.9;
        c.v += (k * (target - c.pos) - damping * c.v) * dt;
        c.pos += c.v * dt;
      }
      if (Math.abs(target - c.pos) < 0.002 && Math.abs(c.v) < 0.02) {
        c.pos = target;
        c.v = 0;
        c.goal = null;
        if (c.at !== target) {
          c.at = target;
          this.sync(true);
          this.changePending = true;
        }
      } else busy = true;
    }
    // one change per settle, after both columns stopped, and only for the user's own moves
    if (!busy) {
      if (this.changePending && this.userMove) this.emit<{ value: string }>("change", { value: this.value });
      this.changePending = false;
      this.userMove = false;
    }
    F.clear();
    // selection band
    const b0 = cy - rowH / 2 + 1;
    const b1 = cy + rowH / 2 - 1;
    for (let j = Math.floor(b0 / pitch); j < b1 / pitch; j++) {
      for (let i = Math.floor(6 / pitch); i < (W - 6) / pitch; i++) {
        const [x, y] = F.xy(i, j);
        const lx = Math.min(x - 6, W - 6 - x);
        const ly = Math.min(y - b0, b1 - y);
        const rr = 9;
        if (lx < rr && ly < rr && Math.hypot(rr - lx, rr - ly) > rr) continue;
        const edge = ly < 1.6;
        if (!edge && bayer(i, j) > 0.42) continue;
        F.put(i, j, mix(P.accent, P.surface, edge ? 0.2 : 0.55), edge ? 0.65 : 0.75, edge ? 0.12 : 0);
      }
    }
    this.flush(0.8, 4);
    this.placeDigits(cy);
    return busy;
  }

  /**
   * Set the digits as text on the cylinder: each row sits at its angle, shrinks with foreshortening and fades toward
   * the back; rows inside the selection band are larger and lit. The top and bottom fade is a CSS mask.
   */
  private placeDigits(cy: number): void {
    const P = this.P;
    const dark = this.dark;
    const radius = ROW_H / ROW_ANGLE;
    const bandColor = css(dark ? WHITE : mix(P.fg, P.accent, 0.25));
    // the dark theme's bloom, as a text glow
    const bandGlow = dark ? `0 0 10px ${css(P.accent, 0.85)}` : "none";
    this.colon.style.color = css(dark ? WHITE : P.fg);
    this.colon.style.textShadow = bandGlow;
    this.columns.forEach((c, k) => {
      const spans = this.rowEls[k];
      let used = 0;
      for (let r = Math.floor(c.pos) - 5; r <= Math.ceil(c.pos) + 5 && used < POOL; r++) {
        const angle = (r - c.pos) * ROW_ANGLE;
        if (Math.abs(angle) > 1.42) continue;
        const y = cy + Math.sin(angle) * radius;
        // foreshortening on the cylinder
        const s = Math.cos(angle);
        const inBand = Math.abs(y - cy) < ROW_H / 2 - 2;
        const near = clamp(1 - Math.abs(y - cy) / (ROW_H * 0.9), 0, 1);
        const idx = wrap(r, c.n);
        const text = pad2(k ? idx * this.step : idx);
        const scale = (0.58 + 0.42 * s) * (inBand ? 1.08 : 1);
        const span = spans[used++];
        if (span.textContent !== text) span.textContent = text;
        span.style.transform = `translateY(${(y - 12).toFixed(2)}px) scale(${scale.toFixed(3)})`;
        span.style.opacity = (inBand ? 1 : 0.18 + 0.75 * s * s * s).toFixed(3);
        span.style.color = inBand ? bandColor : css(mix(P.muted, P.fg, near * 0.6));
        span.style.textShadow = inBand ? bandGlow : "none";
        span.hidden = false;
      }
      for (let q = used; q < POOL; q++) spans[q].hidden = true;
    });
  }
}

define("hf-wheel", HWheel);

declare global {
  interface HTMLElementTagNameMap {
    "hf-wheel": HWheel;
  }
}

export { HWheel };
