/**
 * <hf-rings> · Goal rings
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/rings
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-rings.tsx.
 */
import {
  HF,
  Sparks,
  TAU,
  bayer,
  clamp,
  define,
  escapeHtml,
  fmtInt,
  localPoint,
  mix,
  now,
  reduced,
  type PaletteKey,
  type RGB,
} from "@/lib/lumesec/pixel";

/** One ring parsed from the `rings` attribute. */
export interface HRingsItem {
  name: string;
  /** Current amount. */
  cur: number;
  /** Goal; progress is `cur / goal`. */
  goal: number;
}

/** Radii of a ring in px. */
interface RingGeometry {
  ro: number;
  ri: number;
}

const WHITE: RGB = [255, 255, 255];

/** Ring colours from the outside in. */
const RING_COLORS: readonly PaletteKey[] = ["accent", "ok", "warn"];

const DEFAULT_RINGS = "Messages:36/50,Tokens:410/900,Agents:13/10";

/**
 * Up to three concentric goal rings with glowing heads; progress past the goal laps the ring in a brighter tint and
 * throws sparks.
 */
class HRings extends HF {
  /** It also draws on the canvas outside the field, so every flush redraws the whole canvas. */
  protected override partialFlush = false;

  static readonly observedAttributes = ["rings"] as const;

  /** Sprung progress per ring, as a fraction of its goal (up to 2). */
  private readonly progress = [0, 0, 0];
  private readonly velocity = [0, 0, 0];
  /** Index of the ring under the pointer, or -1. */
  private focused = -1;
  /** Eased opacity per ring; rings other than the focused one fade. */
  private readonly fade = [1, 1, 1];
  /** Whether a ring has thrown its sparks for reaching the goal. */
  private readonly full: boolean[] = [];
  private readonly sparks = new Sparks();
  /** Time of the last build; the rings start one after another from here. */
  private t0 = 0;

  constructor() {
    super(
      `
      :host { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
      canvas.px { width: 172px; height: 172px; flex: none; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; min-width: 0; }
      li { display: grid; grid-template-columns: 10px auto; column-gap: 10px; align-items: center; cursor: default; transition: opacity .2s; }
      li i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); }
      .nm { font-size: 12.5px; color: var(--_muted); }
      .vv { grid-column: 2; font-size: 19px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
      .vv small { font-size: 12px; font-weight: 500; color: var(--_muted); margin-left: 3px; }
      :host([data-focus]) li:not(.on) { opacity: .35; }
      `,
      `<canvas class="px" role="img"></canvas><ul></ul>`,
      2,
      0.7,
    );
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const [x, y] = localPoint(canvas, e);
      const d = Math.hypot(x - this.w / 2, y - this.h / 2);
      this.setFocus(this.geometry().findIndex((g) => d >= g.ri - 2 && d <= g.ro + 2));
    });
    canvas.addEventListener("pointerleave", () => this.setFocus(-1));
  }

  /**
   * Rings parsed from the attribute: empty entries are skipped, a missing or negative amount counts as 0 and a
   * missing or non-positive goal as 1.
   */
  get items(): HRingsItem[] {
    return (this.getAttribute("rings") || DEFAULT_RINGS)
      .split(",")
      .filter((entry) => entry.trim() !== "")
      .slice(0, 3)
      .map((entry) => {
        // the name is everything before the last colon, so it may contain colons itself
        const colon = entry.lastIndexOf(":");
        const name = colon < 0 ? entry : entry.slice(0, colon);
        const [cur = 0, goal = 1] = (colon < 0 ? "" : entry.slice(colon + 1)).split("/").map(Number);
        return {
          name: name.trim(),
          cur: Number.isFinite(cur) && cur > 0 ? cur : 0,
          goal: Number.isFinite(goal) && goal > 0 ? goal : 1,
        };
      });
  }

  protected override init(): void {
    this.build();
  }

  attributeChangedCallback(): void {
    if (!this.initialized) return;
    this.build();
    this.kick();
  }

  private colors(): RGB[] {
    const P = this.P;
    return RING_COLORS.map((key) => P[key]);
  }

  /** Three rings, 15px wide with a 5px gap, from the outside in. */
  private geometry(): RingGeometry[] {
    const r0 = this.w / 2 - 3;
    return [0, 1, 2].map((k) => ({ ro: r0 - k * 20, ri: r0 - k * 20 - 15 }));
  }

  private get legendItems(): HTMLLIElement[] {
    return this.$$<HTMLLIElement>("li");
  }

  /** Rebuild the legend and restart the rings. */
  private build(): void {
    const items = this.items;
    this.$("ul").innerHTML = items
      .map(
        (ring, k) =>
          `<li data-k="${k}" style="--c:var(--_${RING_COLORS[k]})"><i></i><span class="nm">${escapeHtml(ring.name)}</span><span class="vv">${fmtInt(ring.cur)}<small>/ ${fmtInt(ring.goal)}</small></span></li>`,
      )
      .join("");
    for (const item of this.legendItems) {
      item.addEventListener("pointerenter", () => this.setFocus(Number(item.dataset.k)));
      item.addEventListener("pointerleave", () => this.setFocus(-1));
    }
    const label = items.map((ring) => `${ring.name} ${Math.round((ring.cur / ring.goal) * 100)}%`).join(", ");
    this.$("canvas").setAttribute("aria-label", label);
    this.t0 = now();
  }

  private setFocus(k: number): void {
    if (k === this.focused) return;
    this.focused = k;
    this.toggleAttribute("data-focus", k >= 0);
    for (const item of this.legendItems) item.classList.toggle("on", Number(item.dataset.k) === k);
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const items = this.items;
    const geometry = this.geometry();
    const colors = this.colors();
    const cx = this.w / 2;
    const cy = this.h / 2;
    const dark = this.dark;
    let busy = false;
    items.forEach((ring, k) => {
      const target = Math.min(2, ring.cur / ring.goal);
      if (reducedMotion) {
        this.progress[k] = target;
        this.velocity[k] = 0;
      } else if (t - this.t0 > k * 0.12) {
        const stiffness = 60;
        const damping = 2 * Math.sqrt(stiffness) * 0.8;
        this.velocity[k] += (stiffness * (target - this.progress[k]) - damping * this.velocity[k]) * dt;
        this.progress[k] += this.velocity[k] * dt;
      }
      if (Math.abs(target - this.progress[k]) > 0.001 || Math.abs(this.velocity[k]) > 0.001) busy = true;
      const fadeTarget = this.focused < 0 || this.focused === k ? 1 : 0.28;
      this.fade[k] += (fadeTarget - this.fade[k]) * Math.min(1, dt * 10);
      if (Math.abs(fadeTarget - this.fade[k]) > 0.01) busy = true;
      if (this.progress[k] >= 1 && !this.full[k]) {
        this.full[k] = true;
        const mid = (geometry[k].ri + geometry[k].ro) / 2;
        this.sparks.add(cx, cy - mid, 14, [colors[k], P.shine], { speed: [30, 120], life: [0.3, 0.7] });
      }
      if (this.progress[k] < 0.98) this.full[k] = false;
    });
    F.clear();
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        const [x, y] = F.xy(i, j);
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        const k = geometry.findIndex((g) => d >= g.ri && d <= g.ro);
        if (k < 0 || k >= items.length) continue;
        const g = geometry[k];
        const q = this.progress[k];
        const col = colors[k];
        const mid = (g.ri + g.ro) / 2;
        const halfWidth = (g.ro - g.ri) / 2;
        const fade = this.fade[k];
        // position around the ring, clockwise from the top, 0 to 1
        const f = ((Math.atan2(dx, -dy) + TAU) % TAU) / TAU;
        const q1 = Math.min(q, 1);
        const tipAngle = q1 * TAU - Math.PI / 2;
        const tipD = Math.hypot(x - (cx + Math.cos(tipAngle) * mid), y - (cy + Math.sin(tipAngle) * mid));
        // the arc with round caps at both ends
        const startCap = q > 0.004 && Math.hypot(x - cx, y - (cy - mid)) <= halfWidth && x >= cx - 0.5;
        const on = f <= q1 || (q > 0.004 && tipD <= halfWidth) || startCap;
        if (on) {
          const along = clamp(f / Math.max(q1, 0.001), 0, 1);
          const secondLap = q > 1 && f <= q - 1;
          const shade = 1 - (Math.abs(d - mid) / halfWidth) * 0.22;
          let light = (0.6 + 0.4 * along) * shade;
          const base = mix(col, P.shine, secondLap ? 0.35 : 0);
          if (bayer(i, j) > 0.35 + along * 0.65) light *= 0.72;
          const tip = Math.exp(-(tipD * tipD) / 60);
          F.put(
            i,
            j,
            mix(base, WHITE, tip * (dark ? 0.35 : 0.15)),
            Math.min(1, light + tip * 0.2) * fade,
            (0.06 + tip * 0.7 + (secondLap ? 0.2 : 0)) * fade,
          );
        } else {
          F.put(i, j, mix(col, P.surface, dark ? 0.78 : 0.82), ((i + j) & 1 ? 1 : 0.7) * (0.35 + 0.65 * fade));
        }
      }
    }
    this.flush(0.9, 5);
    const sparking = this.sparks.step(ctx, dt);
    return busy || sparking;
  }
}

define("hf-rings", HRings);

declare global {
  interface HTMLElementTagNameMap {
    "hf-rings": HRings;
  }
}

export { HRings };
