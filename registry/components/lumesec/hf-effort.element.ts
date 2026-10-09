/**
 * <hf-effort> · Effort slider
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/effort
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-effort.tsx.
 */
import {
  FormMixin,
  HF,
  Sparks,
  bayer,
  clamp,
  define,
  ease3,
  fbm,
  h2,
  localPoint,
  mix,
  reduced,
  rollText,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Effort level id, the value of the `value` and `recommended` attributes. */
export type HEffortLevel = "low" | "medium" | "high" | "xhigh" | "max" | "ultracode";

/** Detail of the `input` and `change` events. */
export interface HEffortDetail {
  value: HEffortLevel;
  index: number;
  /** Display name of the level. */
  label: string;
}

/** Events fired by `<hf-effort>`. */
export interface HEffortEventMap {
  /** Fires each time the level changes during a drag or key press. */
  input: CustomEvent<HEffortDetail>;
  /** Fires when a level is committed on pointer release or key press, if it differs from the last committed level. */
  change: CustomEvent<HEffortDetail>;
  /** Fires when the thumb settles on Ultracode after arriving from another level, including programmatic changes. */
  ultracode: CustomEvent<Record<string, never>>;
}

/** The six fixed levels, from fastest to smartest. */
const LEVELS: readonly { id: HEffortLevel; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra" },
  { id: "max", label: "Max" },
  { id: "ultracode", label: "Ultracode" },
];

/** Index of Ultracode, the last level. */
const LAST = LEVELS.length - 1;

/** Index steps per key; Home and End overshoot and are clamped. */
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  Home: -99,
  End: 99,
  PageUp: 2,
  PageDown: -2,
};

const WHITE: RGB = [255, 255, 255];

/** The canvas overhangs the track by 8px at each side and 30px above and below. */
const OVERHANG_X = 8;
const OVERHANG_Y = 30;
/** Inset of the first and last stop from the track ends. */
const PAD = 12;

const indexOf = (id: string | null): number => LEVELS.findIndex((level) => level.id === id);

/** Six-level effort slider; reaching Ultracode bursts and grows a trail of light behind the thumb. Form-associated. */
class HEffort extends FormMixin(HF) {
  static readonly observedAttributes = ["value", "recommended"] as const;

  private idx = LAST;
  /** Sprung thumb position in level units. */
  private thumb = LAST;
  private thumbV = 0;
  /** Growth of the Ultracode trail, 0 to 1. */
  private trail = 0;
  private dragging = false;
  /** Pointer position in level units while dragging. */
  private dragPos = 0;
  /** Whether the Ultracode burst has fired for the current visit. */
  private armed = false;
  /** Time of the last burst; 0 before the first. */
  private burstT = 0;
  /** The level reported by the last `change` event. */
  private committed = -1;
  /** True while the element writes its own `value` attribute, so the change is not handled again. */
  private reflecting = false;
  /** The level a form reset restores: the `value` set by markup or code, not by the user. */
  private defaultIndex = LAST;
  private readonly sparks = new Sparks();

  constructor() {
    super(
      `
      :host { display: block; -webkit-user-select: none; user-select: none; }
      .hd { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
      .t { font-size: 13.5px; font-weight: 600; }
      .nm { font-size: 13.5px; font-weight: 600; }
      .nm.u .roll { background: linear-gradient(90deg, var(--_accent), var(--_shine), var(--_accent)); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shm 2.2s linear infinite; }
      @keyframes shm { to { background-position: -200% 0; } }
      .tr { position: relative; height: 40px; touch-action: none; cursor: pointer; outline: none; border-radius: 10px; }
      .tr:focus-visible { box-shadow: 0 0 0 2px var(--_accent); }
      :host(:disabled) { opacity: .55; }
      :host(:disabled) .tr { cursor: default; }
      canvas.px { position: absolute; left: -8px; top: -30px; width: calc(100% + 16px); height: calc(100% + 60px); pointer-events: none; }
      .rec { position: absolute; top: 100%; transform: translateX(-50%); font-size: 11px; color: var(--_muted); white-space: nowrap; margin-top: -4px; transition: opacity .2s; }
      .ft { display: flex; justify-content: space-between; font-size: 12px; color: var(--_muted); margin-top: 16px; }
      @media (prefers-reduced-motion: reduce) { .nm.u .roll { animation: none; } }
      `,
      `<div class="hd"><span class="t">Effort</span><span class="rollslot nm" aria-hidden="true"></span></div>
        <div class="tr" tabindex="0" role="slider" aria-label="Effort" aria-valuemin="0" aria-valuemax="${LAST}"><canvas class="px"></canvas><span class="rec">Recommended</span></div>
        <div class="ft"><span>Faster</span><span>Smarter</span></div>`,
      2,
      0.7,
    );
    const track = this.$(".tr");
    const levelAt = (e: PointerEvent): number => {
      const [x] = localPoint(track, e);
      return clamp(((x - PAD) / (track.offsetWidth - 2 * PAD)) * LAST, 0, LAST);
    };
    track.addEventListener("pointerdown", (e) => {
      if (this.formDisabled || e.button !== 0) return;
      track.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.dragPos = levelAt(e);
      this.setIndex(Math.round(this.dragPos));
      this.kick();
    });
    track.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.dragPos = levelAt(e);
      this.setIndex(Math.round(this.dragPos));
      this.kick();
    });
    const release = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.commit();
      this.kick();
    };
    track.addEventListener("pointerup", release);
    track.addEventListener("pointercancel", release);
    track.addEventListener("keydown", (e) => {
      const d = KEY_STEPS[e.key];
      if (d == null || this.formDisabled) return;
      e.preventDefault();
      this.setIndex(clamp(this.idx + d, 0, LAST));
      this.commit();
    });
  }

  /** Selected level id. Setting it writes the attribute. */
  get value(): HEffortLevel {
    return LEVELS[this.idx].id;
  }

  set value(value: HEffortLevel) {
    this.setAttribute("value", value);
  }

  protected override init(): void {
    const i = indexOf(this.getAttribute("value") || "ultracode");
    this.idx = this.thumb = i < 0 ? LAST : i;
    this.defaultIndex = this.idx;
    this.trail = this.idx === LAST ? 1 : 0;
    // starting on Ultracode does not burst
    this.armed = this.idx === LAST;
    this.sync(false);
    this.committed = this.idx;
  }

  attributeChangedCallback(name: string): void {
    if (!this.initialized || this.reflecting) return;
    if (name === "value") {
      const i = indexOf(this.getAttribute("value"));
      if (i >= 0) {
        this.defaultIndex = i;
        this.moveTo(i);
      }
    }
    this.layout();
    this.kick();
  }

  /** Called by the browser when the `disabled` attribute or a disabled ancestor `<fieldset>` changes. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    this.dragging = false;
    const track = this.$(".tr");
    track.tabIndex = disabled ? -1 : 0;
    if (disabled) track.setAttribute("aria-disabled", "true");
    else track.removeAttribute("aria-disabled");
    this.kick();
  }

  /** Restores the level from the `value` set by markup or code. */
  formResetCallback(): void {
    if (this.initialized) this.moveTo(this.defaultIndex);
  }

  /** Move to level `i` without `input` or `change` events, as a programmatic change does. */
  private moveTo(i: number): void {
    if (i === this.idx) return;
    const d = i - this.idx;
    this.idx = i;
    this.sync(true, d);
    this.committed = i;
  }

  private detail(): HEffortDetail {
    return { value: this.value, index: this.idx, label: LEVELS[this.idx].label };
  }

  /** Move to level `i` and fire `input`. */
  private setIndex(i: number): void {
    if (i === this.idx) return;
    const d = i - this.idx;
    this.idx = i;
    this.sync(true, d);
    this.emit<HEffortDetail>("input", this.detail());
  }

  private commit(): void {
    if (this.committed === this.idx) return;
    this.committed = this.idx;
    this.emit<HEffortDetail>("change", this.detail());
  }

  private sync(animate: boolean, d = 1): void {
    const name = this.$(".nm");
    const ultra = this.idx === LAST;
    const label = LEVELS[this.idx].label;
    rollText(name, label, d, animate && !ultra);
    name.classList.toggle("u", ultra);
    const track = this.$(".tr");
    track.setAttribute("aria-valuenow", String(this.idx));
    track.setAttribute("aria-valuetext", label);
    this.reflecting = true;
    this.setAttribute("value", this.value);
    this.reflecting = false;
    this.setFormValue(this.value);
    this.kick();
  }

  /** Index of the `recommended` level, or -1 to hide the marker. */
  private get recommendedIndex(): number {
    return indexOf(this.getAttribute("recommended") || "medium");
  }

  protected override layout(): void {
    const rec = this.recommendedIndex;
    const marker = this.$(".rec");
    const W = this.w - 2 * OVERHANG_X;
    marker.style.display = rec < 0 ? "none" : "";
    marker.style.left = `${PAD + (Math.max(0, rec) / LAST) * (W - 2 * PAD)}px`;
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const ox = OVERHANG_X;
    const W = this.w - 2 * OVERHANG_X;
    // the track's centre line in canvas pixels
    const ty = OVERHANG_Y + 20;
    const span = W - 2 * PAD;
    /** x of level `k` (fractional) in canvas pixels. */
    const levelX = (k: number): number => ox + PAD + (k / LAST) * span;
    const target = this.dragging ? this.dragPos : this.idx;
    if (reducedMotion) {
      this.thumb = target;
      this.thumbV = 0;
    } else {
      // stiff and critically damped while dragging, bouncy when released
      const stiffness = this.dragging ? 900 : 230;
      const damping = 2 * Math.sqrt(stiffness) * (this.dragging ? 1 : 0.68);
      this.thumbV += (stiffness * (target - this.thumb) - damping * this.thumbV) * dt;
      this.thumb += this.thumbV * dt;
    }
    const ultra = this.idx === LAST && !this.dragging;
    const tx = levelX(clamp(this.thumb, 0, LAST));
    if (reducedMotion) {
      this.trail = ultra ? 1 : 0;
    } else {
      const growth = ultra && this.thumb > LAST - 0.08 ? dt * 0.75 : ultra ? 0 : -dt * 2.6;
      this.trail = clamp(this.trail + growth, 0, 1);
    }
    if (ultra && this.thumb > LAST - 0.05 && !this.armed) {
      this.armed = true;
      this.burstT = t;
      this.sparks.add(tx, ty, 46, [P.accent, P.shine, WHITE], { speed: [60, 260], life: [0.35, 0.9], drag: 3.2 });
      this.emit("ultracode");
    }
    if (!ultra && this.idx !== LAST) this.armed = false;
    const trailEase = ease3(this.trail);
    const reach = trailEase * 0.75 * span;
    const burst = this.burstT !== 0 && !reducedMotion ? clamp(1 - (t - this.burstT) / 0.75, 0, 1) : 0;
    const rec = this.recommendedIndex;
    // three pulses run back along the trail
    const phases = [0, 1 / 3, 2 / 3].map((o) => (t * 0.85 + o) % 1);
    const dark = this.dark;
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const dy = y - ty;
        const ady = Math.abs(dy);
        // burst ring and core
        if (burst > 0) {
          const r = (1 - burst) * 140 + 10;
          const d = Math.hypot(x - tx, dy * 1.2);
          if (Math.abs(d - r) < 3.2 && h2(i, j) < 0.85) F.put(i, j, mix(P.accent, P.shine, 0.6), burst, burst);
          if (d < 34 * (1 - burst) + 6 && h2(i, j + Math.floor(t * 30)) < burst * 0.7) {
            F.put(i, j, mix(P.shine, WHITE, 0.5), burst, burst);
          }
        }
        // Ultracode trail behind the thumb
        if (reach > 1 && x < tx && x > tx - reach - 4) {
          const f = (tx - x) / reach;
          const taper = 1 - clamp(f, 0, 1);
          const halfH = 2 + 15 * Math.pow(taper, 1.4) * (0.62 + 0.38 * fbm(x * 0.045 - t * 1.3, dy > 0 ? 3 : 7));
          if (ady < halfH) {
            const e = ady / halfH;
            let boost = 0;
            for (const phase of phases) {
              const px = tx - phase * reach;
              boost += Math.exp(-((x - px) ** 2) / 110) * (1 - phase) * (1 - e);
            }
            const dens = (1 - e * e) * Math.pow(taper, 0.7) * 0.85 + boost * 0.6;
            if (h2(i, j + Math.floor(t * 14)) < dens) {
              F.put(
                i,
                j,
                mix(P.accent, P.shine, clamp((1 - f) * 0.45 + boost * 0.6, 0, 1)),
                clamp(0.55 + (1 - f) * 0.45 + boost, 0, 1),
                0.22 + boost * 0.8 + burst * 0.4,
              );
            }
          }
        }
        // track bar
        if (ady < 2.2 && x >= levelX(0) - 1 && x <= levelX(LAST) + 1) {
          const v = (x - levelX(0)) / span;
          if (x <= tx) {
            F.put(
              i,
              j,
              mix(P.accent, P.shine, v * 0.35 * (ultra ? 1 : 0.5)),
              bayer(i, j) < 0.6 + 0.4 * v ? 1 : 0.72,
              0.1 + trailEase * 0.2,
            );
          } else {
            F.put(i, j, P.track, 1);
          }
        }
        // stop ticks above and below the bar; the recommended one is taller
        for (let k = 0; k <= LAST; k++) {
          const kx = levelX(k);
          if (Math.abs(x - kx) < 1.6 && ady < (k === rec ? 7.5 : 5.5) && ady > 2.2) {
            const passed = kx <= tx + 0.5;
            F.put(i, j, passed ? (dark ? WHITE : P.accent) : P.muted, passed ? 0.95 : 0.55);
          }
        }
      }
    }
    this.drawThumb(tx, ty, trailEase, burst);
    this.flush(0.9, 5);
    const sparking = this.sparks.step(ctx, dt);
    return (
      !reducedMotion &&
      (ultra ||
        this.trail > 0 ||
        Math.abs(target - this.thumb) > 0.001 ||
        Math.abs(this.thumbV) > 0.001 ||
        burst > 0 ||
        sparking)
    );
  }

  /** The thumb, drawn last so it sits on top: a lit disc with a rim that warms toward the accent with the trail. */
  private drawThumb(tx: number, ty: number, trailEase: number, burst: number): void {
    const P = this.P;
    const F = this.F;
    const dark = this.dark;
    const pp = F.pitch;
    const rT = 10.5 + burst * 3;
    for (let j = Math.floor((ty - rT - 4) / pp); j <= (ty + rT + 4) / pp; j++) {
      for (let i = Math.floor((tx - rT - 4) / pp); i <= (tx + rT + 4) / pp; i++) {
        const [x, y] = F.xy(i, j);
        const d = Math.hypot(x - tx, y - ty);
        if (d > rT + 3) continue;
        if (d > rT) {
          F.put(i, j, P.surface, 1);
          continue;
        }
        const lit = 0.82 + 0.18 * clamp((-(x - tx) - (y - ty)) / rT, -1, 1);
        const rim = d > rT - 1.8;
        let col: RGB;
        if (!rim) col = mix(WHITE, P.accent, (1 - lit) * 0.5);
        else if (dark) col = mix(WHITE, P.accent, 0.25 + trailEase * 0.4);
        else col = mix(P.fg, P.accent, 0.3 + trailEase * 0.5);
        F.put(i, j, col, 1, rim ? 0.2 + trailEase * 0.5 : 0.05);
      }
    }
  }
}

define("hf-effort", HEffort);

declare global {
  interface HTMLElementTagNameMap {
    "hf-effort": HEffort;
  }
}

export { HEffort };
