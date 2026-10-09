/**
 * <hf-flow> · Flow
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/flow
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-flow.tsx.
 *
 * Demo data: The sources, models and 100k request split are invented; only `label` can be set. It cannot show
 * your own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { HF, bayer, clamp, define, ease3, lerp, localPoint, mix, now, reduced, type RGB } from "@/lib/lumesec/pixel";

const SOURCES = ["Chat", "Code", "API"];
const TARGETS = ["Large", "Medium", "Small"];
/** Requests in thousands from each source (row) to each model (column). */
const MATRIX: readonly (readonly number[])[] = [
  [12, 26, 8],
  [18, 14, 2],
  [4, 6, 10],
];

/** A node bar: its top and bottom in px. */
interface FlowNode {
  y0: number;
  y1: number;
}

/** A band from source `i` to model `j` carrying `v`k requests; `a` and `b` are its edges at each end. */
interface FlowLink {
  i: number;
  j: number;
  v: number;
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** A particle travelling along a link: progress `u`, lane across the band and speed. */
interface FlowParticle {
  l: FlowLink;
  u: number;
  lane: number;
  sp: number;
}

const WHITE: RGB = [255, 255, 255];

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** All requests, in thousands. */
const TOTAL = sum(MATRIX.flat());

/** Sankey from three sources to three models, with particles streaming in proportion to traffic. */
class HFlow extends HF {
  static observedAttributes = ["label"];

  private hover: FlowLink | null = null;
  private particles: FlowParticle[] = [];
  /** Fractional particles owed; one spawns per whole unit. */
  private spawn = 0;
  /** Eased 0..1 strength of the hover isolation. */
  private hoverFade = 0;
  private t0 = 0;
  private sourceNodes: FlowNode[] = [];
  private targetNodes: FlowNode[] = [];
  private links: FlowLink[] = [];
  private readonly tip = this.$(".tip");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; }
      .hd b { font-size: 13.5px; font-weight: 600; }
      .hd span { font-size: 12px; color: var(--_muted); }
      .g { display: grid; grid-template-columns: 58px 1fr 62px; gap: 8px; }
      .col { position: relative; }
      .lb { position: absolute; transform: translateY(-50%); font-size: 12px; line-height: 1.25; white-space: nowrap; }
      .lb small { display: block; color: var(--_muted); font-size: 11px; font-variant-numeric: tabular-nums; }
      .col.l .lb { right: 0; text-align: right; }
      .box { position: relative; }
      canvas.px { width: 100%; height: 220px; cursor: crosshair; }
      .tip { position: absolute; transform: translate(-50%, calc(-100% - 10px)); background: var(--_raised); border: 1px solid var(--_border); border-radius: 7px; padding: 4px 8px; font-size: 11.5px; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .12s; box-shadow: 0 4px 14px rgba(0,0,0,.14); }
      .tip.on { opacity: 1; }
      `,
      `<div class="hd"><b class="ti"></b><span class="sub"></span></div><div class="g"><div class="col l"></div><div class="box"><canvas class="px" role="img"></canvas><div class="tip"></div></div><div class="col r"></div></div>`,
      2,
      0.72,
    );
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => this.pick(...localPoint(canvas, e)));
    canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.tip.classList.remove("on");
      this.kick();
    });
  }

  attributeChangedCallback(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Where requests go";
  }

  protected override init(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Where requests go";
    this.$(".sub").textContent = `${TOTAL}k requests · last 7 days`;
    const flows = (i: number): string => TARGETS.map((d, j) => `${MATRIX[i][j]}k to ${d}`).join(", ");
    this.$("canvas").setAttribute("aria-label", SOURCES.map((s, i) => `${s}: ${flows(i)}`).join(". "));
    this.t0 = now();
  }

  protected override layout(): void {
    const H = this.h;
    const gap = 12;
    const scale = (H - gap * 2) / TOTAL;
    const sourceValues = MATRIX.map((row) => sum(row));
    const targetValues = TARGETS.map((_, j) => MATRIX.reduce((a, row) => a + row[j], 0));
    const stack = (values: readonly number[]): FlowNode[] => {
      let y = 0;
      return values.map((v) => {
        const node = { y0: y, y1: y + v * scale };
        y += v * scale + gap;
        return node;
      });
    };
    this.sourceNodes = stack(sourceValues);
    this.targetNodes = stack(targetValues);
    // each link takes the next slice of its source and of its target
    const sourceOffsets = this.sourceNodes.map((n) => n.y0);
    const targetOffsets = this.targetNodes.map((n) => n.y0);
    this.links = [];
    MATRIX.forEach((row, i) => {
      row.forEach((v, j) => {
        const h = v * scale;
        this.links.push({
          i,
          j,
          v,
          a0: sourceOffsets[i],
          a1: sourceOffsets[i] + h,
          b0: targetOffsets[j],
          b1: targetOffsets[j] + h,
        });
        sourceOffsets[i] += h;
        targetOffsets[j] += h;
      });
    });
    const labels = (el: HTMLElement, nodes: FlowNode[], names: readonly string[], values: readonly number[]): void => {
      el.innerHTML = nodes
        .map(
          (n, k) => `<span class="lb" style="top:${(n.y0 + n.y1) / 2}px">${names[k]}<small>${values[k]}k</small></span>`,
        )
        .join("");
    };
    labels(this.$(".col.l"), this.sourceNodes, SOURCES, sourceValues);
    labels(this.$(".col.r"), this.targetNodes, TARGETS, targetValues);
  }

  /** Top and bottom of link `l` at canvas x, eased with a smoothstep between the two ends. */
  private band(l: FlowLink, x: number): [top: number, bottom: number] {
    const u = clamp((x - 10) / (this.w - 20), 0, 1);
    const s = u * u * (3 - 2 * u);
    return [lerp(l.a0, l.b0, s), lerp(l.a1, l.b1, s)];
  }

  private pick(x: number, y: number): void {
    const link = this.links.find((q) => {
      const [a, b] = this.band(q, x);
      return y >= a && y <= b;
    });
    if (link === this.hover) return;
    this.hover = link ?? null;
    const tip = this.tip;
    if (link) {
      const [a] = this.band(link, x);
      tip.textContent = `${SOURCES[link.i]} → ${TARGETS[link.j]} · ${link.v}k`;
      tip.style.left = `${clamp(x, 60, this.w - 60)}px`;
      tip.style.top = `${a}px`;
      tip.classList.add("on");
    } else {
      tip.classList.remove("on");
    }
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    if (!this.links.length) return false;
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const W = this.w;
    const sourceColors = [P.accent, P.ok, P.warn];
    // bands shift towards a second colour per model
    const targetColors = [P.shine, P.danger, P.muted].map((c, k) => mix(c, sourceColors[k], 0.3));
    this.hoverFade += ((this.hover ? 1 : 0) - this.hoverFade) * Math.min(1, dt * 10);
    const grow = R0 ? 1 : ease3((t - this.t0) * 0.9);
    if (!R0) {
      // about 34 particles a second, picked in proportion to traffic
      this.spawn += dt * 34;
      while (this.spawn > 1) {
        this.spawn--;
        let r = Math.random() * TOTAL;
        let link = this.links[0];
        for (const q of this.links) {
          r -= q.v;
          if (r <= 0) {
            link = q;
            break;
          }
        }
        this.particles.push({ l: link, u: 0, lane: 0.15 + Math.random() * 0.7, sp: 0.35 + Math.random() * 0.25 });
      }
      for (const p of this.particles) p.u += dt * p.sp;
      this.particles = this.particles.filter((p) => p.u < 1);
    }
    F.clear();
    for (let i = 0; i < F.cols; i++) {
      const [x] = F.xy(i, 0);
      const u = clamp((x - 10) / (W - 20), 0, 1);
      if (u > grow + 0.001 && x > 10) continue;
      for (const l of this.links) {
        const [a, b] = this.band(l, x);
        const on = this.hover === l;
        const dim = this.hover && !on ? 1 - 0.65 * this.hoverFade : 1;
        const col = mix(sourceColors[l.i], targetColors[l.j], u * 0.8);
        for (let j = Math.floor(a / pp); j < b / pp; j++) {
          const [, y] = F.xy(i, j);
          const edge = y - a < 1.2 || b - y < 1.2;
          if (!edge && bayer(i, j) > (on ? 0.85 : 0.42)) continue;
          F.put(i, j, col, (edge ? 0.75 : 0.85) * dim, on ? 0.3 : 0.04);
        }
      }
    }
    // node bars
    const bars = (nodes: FlowNode[], x0: number, cols: readonly RGB[]): void => {
      nodes.forEach((n, k) => {
        for (let j = Math.floor(n.y0 / pp); j < n.y1 / pp; j++) {
          for (let i = Math.floor(x0 / pp); i < (x0 + 8) / pp; i++) F.put(i, j, cols[k], 1, 0.3);
        }
      });
    };
    bars(this.sourceNodes, 0, sourceColors);
    bars(this.targetNodes, W - 8, targetColors);
    for (const p of this.particles) {
      if (p.u > grow) continue;
      const x = 10 + p.u * (W - 20);
      const [a, b] = this.band(p.l, x);
      const y = lerp(a, b, p.lane);
      const on = !this.hover || this.hover === p.l;
      F.plot(x, y, WHITE, on ? 0.95 : 0.25, on ? 0.7 : 0);
      F.plot(x - pp, y, WHITE, on ? 0.5 : 0.1, on ? 0.3 : 0);
    }
    this.flush(0.85, 4);
    return !R0 || grow < 1;
  }
}

define("hf-flow", HFlow);

export { HFlow };

declare global {
  interface HTMLElementTagNameMap {
    "hf-flow": HFlow;
  }
}
