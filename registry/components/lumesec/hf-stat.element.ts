/**
 * <hf-stat> · Stat tile
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/stat
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-stat.tsx.
 */
import { HF, bayer, clamp, define, ease3, fbm, fmtInt, lerp, mix, now, reduced } from "@/lib/lumesec/pixel";

/** Height of the numeral row above the sparkline, in CSS pixels. */
const NUMERAL_H = 52;

/**
 * Stat tile whose number counts up over a shimmer of dots; hovering the sparkline shows the value under the
 * pointer.
 */
class HStat extends HF {
  static readonly observedAttributes = ["value", "label", "delta", "data", "prefix", "suffix", "decimals"] as const;

  /** Value the count-up starts from. */
  private from = 0;
  /** Start time of the count-up. */
  private t0 = -9;
  /** Pointer position as a 0–1 fraction of the width; -1 when the pointer is outside. */
  private hx = -1;
  /** Eased 0–1 hover amount. */
  private hf = 0;
  /** The number currently shown, so a new value counts up from it. */
  private shownV: number | null = null;
  /** Sparkline values in use. */
  private seriesValues: number[] = [];

  constructor() {
    super(
      `
      :host { display: block; }
      .k { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12.5px; color: var(--_muted); }
      .dl { font-size: 11.5px; font-weight: 600; padding: 2px 7px; border-radius: 99px; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
      .box { position: relative; margin-top: 6px; container-type: inline-size; }
      canvas.px { display: block; width: 100%; height: 108px; cursor: crosshair; }
      .n {
        position: absolute; left: 0; top: 0; height: ${NUMERAL_H}px; display: flex; align-items: center;
        font-family: var(--_mono); font-size: min(48px, 15cqi); font-weight: 600; letter-spacing: -.02em; line-height: 1;
        font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--_fg); pointer-events: none; transition: color .2s;
      }
      .n.hov { color: var(--_accent); }
      `,
      `<div class="k"><span class="l"></span><span class="dl"></span></div><div class="box"><canvas class="px" aria-hidden="true"></canvas><span class="n" aria-hidden="true"></span></div><span class="sr" aria-live="polite"></span>`,
      2,
      0.74,
    );
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.hx = clamp((e.clientX - r.left) / r.width, 0, 1);
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hx = -1;
      this.kick();
    });
  }

  /** Displayed value. Setting it writes the attribute and counts to the new value. */
  get value(): number {
    return this.num("value", 48210);
  }

  set value(v: number) {
    this.setAttribute("value", String(v));
  }

  /** Sparkline values, from `data` or the generated series. */
  get series(): number[] {
    return [...this.seriesValues];
  }

  private get labelText(): string {
    return this.getAttribute("label") || "Messages this month";
  }

  protected override init(): void {
    this.syncLabels();
    this.t0 = now();
    this.from = 0;
    this.sync();
  }

  attributeChangedCallback(name: string): void {
    if (!this.initialized) return;
    if (name === "value") {
      // count from the number on screen to the new value
      this.from = this.shownV ?? 0;
      this.t0 = now();
    } else this.syncLabels();
    this.sync();
    this.kick();
  }

  /** Caption, delta badge and sparkline from their attributes. */
  private syncLabels(): void {
    this.$(".l").textContent = this.labelText;
    const delta = this.getAttribute("delta") ?? "+12.4%";
    const negative = /^-|^−/.test(delta);
    const badge = this.$(".dl");
    badge.textContent = delta;
    badge.hidden = !delta;
    badge.style.setProperty("--c", `var(--_${negative ? "danger" : "ok"})`);
    const data = (this.getAttribute("data") || "").split(",").map(Number).filter(Number.isFinite);
    this.seriesValues =
      data.length > 2 ? data : Array.from({ length: 24 }, (_, k) => 30 + 18 * fbm(k * 0.35, 4.2) + k * 1.4);
  }

  private sync(): void {
    this.$(".sr").textContent = `${this.labelText}: ${this.fmt(this.value)}`;
  }

  private fmt(v: number): string {
    const decimals = this.num("decimals", 0);
    const digits = decimals ? v.toFixed(decimals) : fmtInt(v);
    return `${this.getAttribute("prefix") || ""}${digits}${this.getAttribute("suffix") || ""}`;
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const C = F.cols;
    const R = F.rows;
    const pitch = F.pitch;
    const e = reducedMotion ? 1 : ease3((t - this.t0) / 1.3);
    const v = lerp(this.from, this.value, e);
    this.shownV = v;
    this.hf += ((this.hx >= 0 ? 1 : 0) - this.hf) * Math.min(1, dt * 10);
    const ser = this.seriesValues;
    const n = ser.length;
    // hovered sample; -1 without hover
    const hk = this.hx >= 0 ? Math.round(this.hx * (n - 1)) : -1;
    const numeral = this.$(".n");
    const str = hk >= 0 ? `${Math.round(ser[hk] * 10) / 10}` : this.fmt(v);
    if (numeral.textContent !== str) numeral.textContent = str;
    numeral.classList.toggle("hov", hk >= 0);
    const counting = e < 1;
    const nh = Math.round(NUMERAL_H / pitch);
    F.clear();
    if (counting) {
      // a shimmer of dots runs behind the numeral while it counts and fades as it settles
      const textCols = Math.ceil((numeral.offsetWidth + 12) / pitch);
      const fade = 1 - e;
      for (let j = 0; j < nh; j++) {
        const vv = j / nh;
        for (let i = 0; i < Math.min(C, textCols); i++) {
          const sh = 0.5 + 0.5 * Math.sin(i * 0.4 - t * 12 + vv * 2);
          const edge = clamp((textCols - i) / 8, 0, 1);
          if (bayer(i, j) > sh * sh * 0.55 * edge) continue;
          F.put(i, j, mix(P.accent, P.shine, sh * 0.5), (this.dark ? 0.7 : 0.45) * fade, sh * fade * 0.5);
        }
      }
    }
    // sparkline
    const y0 = (nh + 4) * pitch;
    const hS = this.h - y0 - 2;
    const mn = Math.min(...ser);
    const mx = Math.max(...ser);
    const yAt = (u: number): number => {
      const x = u * (n - 1);
      const k = Math.floor(x);
      const s = lerp(ser[k], ser[Math.min(n - 1, k + 1)], x - k);
      return y0 + (1 - (s - mn) / (mx - mn || 1)) * hS;
    };
    const rev = reducedMotion ? 1 : clamp((t - this.t0) * 1.2, 0, 1);
    let prev: number | null = null;
    for (let i = 0; i < C; i++) {
      const u = i / (C - 1);
      if (u > rev) break;
      const yv = yAt(u);
      const lo = Math.min(yv, prev ?? yv) - 1;
      const hi = Math.max(yv, prev ?? yv) + 1;
      prev = yv;
      const near = hk >= 0 ? Math.exp(-(((u - hk / (n - 1)) * this.w) ** 2) / 120) * this.hf : 0;
      for (let j = Math.floor(y0 / pitch); j < R; j++) {
        const y = (j + 0.5) * pitch;
        if (y >= lo && y <= hi) F.put(i, j, mix(P.accent, P.shine, near * 0.5), 1, 0.25 + near * 0.6);
        else if (y > yv && bayer(i, j) < 0.42 * (1 - (y - yv) / (this.h - yv + 1)) + near * 0.2) {
          F.put(i, j, P.accent, this.dark ? 0.55 : 0.45);
        }
      }
    }
    this.flush(0.8, 4);
    return !reducedMotion && (counting || rev < 1 || Math.abs(this.hf - (this.hx >= 0 ? 1 : 0)) > 0.01);
  }
}

define("hf-stat", HStat);

declare global {
  interface HTMLElementTagNameMap {
    "hf-stat": HStat;
  }
}

export { HStat };
