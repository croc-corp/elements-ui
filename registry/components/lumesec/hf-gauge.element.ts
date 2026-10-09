/**
 * <hf-gauge> · Gauge
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/gauge
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-gauge.tsx.
 */
import { HF, bayer, clamp, define, fbm, mix, reduced, rollText, type RGB } from "@/lib/lumesec/pixel";

/** The zone word under the gauge. */
type Zone = "Normal" | "Elevated" | "Critical";

const WHITE: RGB = [255, 255, 255];

/** Theme token per zone, for the zone word. */
const ZONE_TOKEN: Readonly<Record<Zone, string>> = { Normal: "ok", Elevated: "warn", Critical: "danger" };

/**
 * Semicircular gauge of green, amber and red cells with a sprung pointer; the zone word rolls when the value crosses
 * a threshold.
 */
class HGauge extends HF {
  static readonly observedAttributes = ["value", "min", "max", "zones", "decimals", "label", "unit"] as const;

  /** Sprung pointer position as a fraction of the range; overshoots slightly. */
  private p = 0;
  /** Pointer velocity. */
  private vp = 0;
  /** The value currently displayed; null before the first sync. */
  private shown: number | null = null;
  /** The zone currently displayed; empty before the first sync. */
  private zone: Zone | "" = "";

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: grid; justify-items: center; }
      canvas.px { width: 264px; max-width: 100%; height: 148px; }
      .v { display: flex; align-items: baseline; gap: 3px; margin-top: -58px; font-size: 32px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
      .v small { font-size: 14px; font-weight: 500; color: var(--_muted); letter-spacing: 0; }
      .lab { display: flex; gap: 6px; align-items: center; font-size: 12.5px; color: var(--_muted); margin-top: 16px; }
      .st { font-weight: 600; color: var(--c, var(--_ok)); }
      `,
      `<div class="wrap"><canvas class="px" role="meter" aria-valuemin="0"></canvas><div class="v"><span class="rollslot n"></span><small class="u"></small></div><div class="lab"><span class="l"></span><span aria-hidden="true">·</span><span class="rollslot st"></span></div></div>`,
      2,
      0.7,
    );
  }

  /** Parsed `min`. */
  get min(): number {
    return this.num("min", 0);
  }

  /** Parsed `max`. */
  get max(): number {
    return this.num("max", 100);
  }

  /** Clamped value. Setting it writes the attribute. */
  get value(): number {
    return clamp(this.num("value", 42), this.min, this.max);
  }

  set value(value: number) {
    this.setAttribute("value", String(value));
  }

  /** Position of the value in the range, 0 to 1. */
  get frac(): number {
    return (this.value - this.min) / (this.max - this.min || 1);
  }

  /** The two thresholds as fractions of the range, 0 to 1; a missing or invalid threshold uses 60 or 85. */
  get zones(): [elevated: number, critical: number] {
    const z = (this.getAttribute("zones") || "60,85").split(",").map((s) => parseFloat(s));
    const threshold = (k: number, fallback: number): number => (Number.isFinite(z[k]) ? z[k] : fallback);
    const range = this.max - this.min || 1;
    return [clamp((threshold(0, 60) - this.min) / range, 0, 1), clamp((threshold(1, 85) - this.min) / range, 0, 1)];
  }

  protected override init(): void {
    this.sync(false);
  }

  attributeChangedCallback(): void {
    // before the first connect, init() reads every attribute
    if (!this.initialized) return;
    this.sync(true);
    this.kick();
  }

  private sync(animate: boolean): void {
    this.$(".l").textContent = this.getAttribute("label") || "Rate limit";
    this.$(".u").textContent = this.getAttribute("unit") ?? "%";
    const v = this.value;
    const f = this.frac;
    const [elevated, critical] = this.zones;
    const decimals = this.num("decimals", 0);
    rollText(this.$(".n"), v.toFixed(decimals), this.shown == null || v >= this.shown ? 1 : -1, animate);
    this.shown = v;
    const zone: Zone = f >= critical ? "Critical" : f >= elevated ? "Elevated" : "Normal";
    if (zone !== this.zone) {
      rollText(this.$(".st"), zone, zone === "Normal" ? -1 : 1, animate && !!this.zone);
      this.zone = zone;
    }
    this.$(".lab").style.setProperty("--c", `var(--_${ZONE_TOKEN[zone]})`);
    const canvas = this.$("canvas");
    canvas.setAttribute("aria-valuemax", String(this.max));
    canvas.setAttribute("aria-valuemin", String(this.min));
    canvas.setAttribute("aria-valuenow", String(v));
    const label = this.getAttribute("label") || "Rate limit";
    canvas.setAttribute("aria-label", `${label}: ${v}${this.getAttribute("unit") ?? "%"}, ${zone}`);
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const target = this.frac;
    if (reducedMotion) {
      this.p = target;
      this.vp = 0;
    } else {
      const stiffness = 70;
      const damping = 2 * Math.sqrt(stiffness) * 0.5;
      this.vp += (stiffness * (target - this.p) - damping * this.vp) * dt;
      this.p += this.vp * dt;
    }
    const pos = clamp(this.p, 0, 1);
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h - 6;
    const ro = Math.min(w / 2 - 8, h - 14);
    const ri = ro - 22;
    const [elevated, critical] = this.zones;
    const pulse = target >= critical && !reducedMotion ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
    const angle = -Math.PI + pos * Math.PI;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const ft = reducedMotion ? 0 : t;
    const dark = this.dark;
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const dx = x - cx;
        const dy = y - cy;
        if (dy > 1) continue;
        const d = Math.hypot(dx, dy);
        if (d > ro + 10 || d < ri - 16) continue;
        // position along the arc, 0 at the left end to 1 at the right
        const f = clamp((Math.atan2(dy, dx) + Math.PI) / Math.PI, 0, 1);
        // pointer
        const along = dx * ux + dy * uy;
        const perp = Math.abs(dx * uy - dy * ux);
        if (along > ri - 9 && along < ro + 7 && perp < 2.1) {
          F.put(i, j, dark ? WHITE : P.fg, 1, 0.55 + pulse * 0.4);
          continue;
        }
        if (d >= ri && d <= ro) {
          // zone colour with a dithered seam between zones
          const b = bayer(i, j);
          const col = f < elevated - 0.025 + 0.05 * b ? P.ok : f < critical - 0.025 + 0.05 * b ? P.warn : P.danger;
          if (f <= pos) {
            const tip = Math.exp(-(((pos - f) * Math.PI * ro) ** 2) / 260);
            const sheen = fbm(f * 10 - ft * 0.9, d * 0.07);
            const e = (d - ri) / (ro - ri);
            const light = (0.68 + 0.3 * sheen) * (0.86 + 0.14 * Math.sin(e * Math.PI)) + tip * (0.35 + pulse * 0.3);
            F.put(i, j, mix(col, WHITE, clamp(light - 0.95, 0, 0.45)), Math.min(1, light), 0.1 + tip * 0.7);
          } else {
            F.put(i, j, mix(P.track, col, dark ? 0.22 : 0.3), (i + j) & 1 ? 1 : 0.55);
          }
          continue;
        }
        // ticks inside the arc
        const n = f * 20;
        const near = Math.abs(n - Math.round(n)) * ((Math.PI * d) / 20);
        const major = Math.round(n) % 5 === 0;
        if (near < 1.1 && d < ri - 5 && d > ri - (major ? 15 : 10)) {
          F.put(i, j, f <= pos + 0.002 ? P.fg : P.muted, major ? 0.95 : 0.55);
        }
      }
    }
    this.flush(0.85, 5);
    return !reducedMotion;
  }
}

define("hf-gauge", HGauge);

declare global {
  interface HTMLElementTagNameMap {
    "hf-gauge": HGauge;
  }
}

export { HGauge };
