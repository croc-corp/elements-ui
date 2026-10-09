/**
 * <hf-funnel> · Funnel
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/funnel
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-funnel.tsx.
 */
import {
  HF,
  bayer,
  clamp,
  define,
  ease3,
  escapeHtml,
  fmtInt,
  lerp,
  localPoint,
  mix,
  now,
  reduced,
  type RGB,
} from "@/lib/lumesec/pixel";

/** A parsed `Label:count` stage of the `data` attribute. */
export interface HFunnelStage {
  label: string;
  v: number;
}

/** A dot falling through the funnel. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Index of the stage the dot last entered. */
  st: number;
  /** True once the dot dropped out; it turns red and drifts off the side. */
  out: boolean;
  /** Opacity. */
  a: number;
}

/** Height of a stage row in pixels; matches the `.r` rows next to the canvas. */
const ROW_H = 44;

const WHITE: RGB = [255, 255, 255];

/**
 * Funnel chart where dots fall through the stages in proportion to conversion and drop-outs turn red and drift off
 * the side.
 */
class HFunnel extends HF {
  static observedAttributes = ["data"];

  /** The stages on screen, parsed from `data` when the rows were built. */
  private rows: HFunnelStage[] = [];
  private parts: Particle[] = [];
  /** Fractional particles owed to the spawn rate. */
  private acc = 0;
  /** Index of the highlighted stage; -1 for none. */
  private focused = -1;
  /** Eased 0–1 highlight per stage. */
  private hv: number[] = [];
  /** Time the stages started to grow in. */
  private t0 = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      .g { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; }
      .cw { grid-column: 1; grid-row: 1 / span 9; position: relative; min-height: 0; }
      canvas.px { position: absolute; inset: 0; width: 100%; height: 100%; }
      .r { grid-column: 2; display: grid; align-content: center; height: 44px; font-size: 13px; transition: opacity .2s; cursor: default; }
      .r b { font-weight: 600; font-variant-numeric: tabular-nums; }
      .r span { font-size: 11.5px; color: var(--_muted); }
      :host([data-focus]) .r:not(.on) { opacity: .4; }
      `,
      `<div class="g"><div class="cw"><canvas class="px" role="img"></canvas></div></div>`,
      2,
      0.72,
    );
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const [, y] = localPoint(canvas, e);
      if (this.rows.length) this.setFocus(clamp(Math.floor(y / ROW_H), 0, this.rows.length - 1));
    });
    canvas.addEventListener("pointerleave", () => this.setFocus(-1));
  }

  /**
   * Stages parsed from the `data` attribute: `Label:count` pairs split at the last colon. Empty entries are
   * skipped; a missing, invalid or negative count is 0.
   */
  get stages(): HFunnelStage[] {
    return (this.getAttribute("data") || "Visited:12400,Signed up:4210,Activated:2380,Paid:910")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.lastIndexOf(":");
        if (i < 0) return { label: s, v: 0 };
        return { label: s.slice(0, i).trim(), v: Math.max(0, +s.slice(i + 1) || 0) };
      });
  }

  attributeChangedCallback(): void {
    // before the first connect, init() builds the rows
    if (this.initialized) this.build();
  }

  protected override init(): void {
    this.build();
  }

  /** (Re)build the text rows from `data`; the stages grow in again. */
  private build(): void {
    const stages = this.stages;
    this.rows = stages;
    this.parts = [];
    this.setFocus(-1);
    this.$$(".r").forEach((row) => row.remove());
    const grid = this.$(".g");
    stages.forEach((s, k) => {
      const row = document.createElement("div");
      row.className = "r";
      row.dataset.k = String(k);
      const previous = k ? stages[k - 1].v : 0;
      let conversion = "Top of funnel";
      if (k) conversion = previous ? `${((s.v / previous) * 100).toFixed(1)}% from previous` : "–";
      row.innerHTML = `<b>${escapeHtml(s.label)} · ${fmtInt(s.v)}</b><span>${conversion}</span>`;
      row.addEventListener("pointerenter", () => this.setFocus(k));
      row.addEventListener("pointerleave", () => this.setFocus(-1));
      grid.append(row);
    });
    this.hv = stages.map(() => 0);
    this.t0 = now();
    this.$("canvas").setAttribute("aria-label", stages.map((s) => `${s.label} ${fmtInt(s.v)}`).join(", "));
    this.kick();
  }

  private setFocus(k: number): void {
    if (k === this.focused) return;
    this.focused = k;
    this.toggleAttribute("data-focus", k >= 0);
    this.$$(".r").forEach((r) => r.classList.toggle("on", Number(r.dataset.k) === k));
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const st = this.rows;
    const n = st.length;
    if (!n) {
      F.clear();
      this.flush(0.85, 4);
      return false;
    }
    const top = st[0].v || 1;
    const W = this.w;
    const pitch = F.pitch;
    /** Width of stage `k`, relative to the first with a 6% minimum. */
    const wid = (k: number): number => Math.max(0.06, st[k].v / top) * (W - 8);
    const grow = reducedMotion ? 1 : ease3((t - this.t0) * 1.4);
    st.forEach((_, k) => {
      this.hv[k] += ((k === this.focused ? 1 : 0) - this.hv[k]) * Math.min(1, dt * 10);
    });
    // particles
    if (!reducedMotion) {
      this.acc += dt * 46;
      while (this.acc > 1) {
        this.acc--;
        const w0 = wid(0);
        this.parts.push({
          x: W / 2 + (Math.random() - 0.5) * w0 * 0.9,
          y: 2,
          vx: 0,
          vy: 30 + Math.random() * 30,
          st: 0,
          out: false,
          a: 1,
        });
      }
      for (const p of this.parts) {
        p.y += p.vy * dt;
        p.x += p.vx * dt;
        const k = Math.floor(p.y / ROW_H);
        if (!p.out && k > p.st && k < n) {
          // entering a stage: drop out with the conversion loss of this step
          if (Math.random() > st[k].v / (st[k - 1].v || 1)) {
            p.out = true;
            p.vx = (p.x < W / 2 ? -1 : 1) * (40 + Math.random() * 50);
          }
          p.st = k;
        }
        if (!p.out && k < n) {
          const half = (wid(k) / 2) * 0.92;
          p.x = clamp(p.x, W / 2 - half, W / 2 + half);
        }
        if (p.out) p.a -= dt * 1.8;
      }
      this.parts = this.parts.filter((p) => p.a > 0 && p.y < n * ROW_H);
    }
    F.clear();
    for (let k = 0; k < n; k++) {
      const w = wid(k) * grow;
      const x0 = W / 2 - w / 2;
      const y0 = k * ROW_H + 5;
      const y1 = (k + 1) * ROW_H - 5;
      const hv = this.hv[k];
      const dim = this.focused >= 0 && this.focused !== k ? 0.4 : 1;
      const nw = k < n - 1 ? wid(k + 1) * grow : w;
      for (let j = Math.floor(y0 / pitch); j < y1 / pitch; j++) {
        for (let i = Math.floor(x0 / pitch); i < (x0 + w) / pitch; i++) {
          const [x, y] = F.xy(i, j);
          const u = Math.abs(x - W / 2) / (w / 2);
          const edge = u > 0.97 || y < y0 + 1.5 || y > y1 - 1.5;
          const dens = 0.3 + 0.5 * (1 - u) + hv * 0.2;
          if (!edge && bayer(i, j) > dens) continue;
          F.put(i, j, mix(P.accent, P.shine, hv * 0.4 + (edge ? 0.2 : 0)), (edge ? 0.9 : 0.62) * dim, hv * 0.3);
        }
      }
      // neck between stages
      if (k < n - 1) {
        for (let j = Math.floor(y1 / pitch); j < (y1 + 10) / pitch; j++) {
          const [, y] = F.xy(0, j);
          const ww = lerp(w, nw, (y - y1) / 10);
          for (let i = Math.floor((W / 2 - ww / 2) / pitch); i < (W / 2 + ww / 2) / pitch; i++) {
            if (bayer(i, j) < 0.18) F.put(i, j, P.accent, 0.4 * dim);
          }
        }
      }
    }
    for (const p of this.parts) {
      F.plot(p.x, p.y, p.out ? P.danger : WHITE, (p.out ? 0.9 : 0.95) * p.a, p.out ? 0.5 * p.a : 0.6);
    }
    this.flush(0.85, 4);
    return !reducedMotion || grow < 1;
  }
}

define("hf-funnel", HFunnel);

declare global {
  interface HTMLElementTagNameMap {
    "hf-funnel": HFunnel;
  }
}

export { HFunnel };
