/**
 * <hf-marquee> · Logo marquee
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/marquee
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-marquee.tsx.
 *
 * Demo data: The ten wordmarks are fictional placeholder logos; only `label` can be set. It cannot show your
 * own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { HF, bayer, define, escapeHtml, localPoint, mix, reduced, rrSdf, type Point } from "@/lib/lumesec/pixel";

/** Font family of a wordmark. */
type LogoFamily = "sans" | "serif" | "mono";

/** Fictional placeholder wordmarks: name, weight, family and letter spacing in em. */
const LOGOS: readonly (readonly [name: string, weight: number, family: LogoFamily, spacing: number])[] = [
  ["VELUNOR", 800, "sans", 0.18],
  ["Quarrybyte", 700, "sans", 0],
  ["halvane", 600, "serif", 0],
  ["OSTREL", 300, "sans", 0.32],
  ["Brindlefield", 700, "serif", 0],
  ["kovaline", 800, "sans", -0.02],
  ["MORROWGATE", 600, "serif", 0.12],
  ["Zentaro", 500, "sans", 0.06],
  ["Fernhook", 700, "mono", 0],
  ["AURELLIO", 400, "serif", 0.24],
];

/** Gap between two wordmarks in pixels; a separator dot sits in its middle. */
const GAP = 48;
/** Height of a row and the top of each row, in pixels. */
const ROW_H = 40;
const ROW_TOP = [6, 58] as const;
/** Drift speed in pixels per second. */
const SPEED = 36;

/** A wordmark's left edge and width inside one cycle of its row. */
interface LogoBox {
  x: number;
  w: number;
}

/** One marquee row: its moving track, the wordmark elements, and the boxes of one cycle. */
interface MarqueeRow {
  track: HTMLElement;
  logos: HTMLElement[];
  boxes: LogoBox[];
  /** Width of one full cycle in pixels; 0 until measured. */
  total: number;
}

/** The markup of one wordmark. */
function logoHtml([name, weight, family, spacing]: (typeof LOGOS)[number]): string {
  const font = family === "serif" ? "var(--serif)" : family === "mono" ? "var(--_mono)" : "var(--_font)";
  const size = family === "serif" ? 25 : 22;
  // letter spacing also trails the last letter; the same space in front keeps the box centred on the ink
  const lead = spacing > 0 ? `padding-left:${spacing}em;` : "";
  return `<span class="lg" style="font-family:${font};font-weight:${weight};font-size:${size}px;letter-spacing:${spacing}em;${lead}">${escapeHtml(name)}</span>`;
}

/**
 * Two rows of placeholder wordmarks drifting in opposite directions over dotted rules; the row under the pointer slows
 * down and the wordmark under it lights up on a dotted plate.
 */
class HMarquee extends HF {
  /** Scroll offset of each row in pixels, within one cycle. */
  private readonly offsets = [0, 0];
  /** Eased speed factor of each row; 0.15 under the pointer. */
  private readonly speeds = [1, 1];
  /** Pointer position over the stage, or null. */
  private pointer: Point | null = null;
  private readonly rows: MarqueeRow[];
  /** The wordmark currently lit, if any. */
  private lit: HTMLElement | null = null;

  constructor() {
    super(
      `
      :host { display: block; --serif: Georgia, "Times New Roman", serif; }
      .lab { text-align: center; font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--_muted); margin-bottom: 10px; }
      .st { position: relative; height: 104px; overflow: hidden; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .rw { position: absolute; left: 0; right: 0; height: 40px; overflow: hidden; pointer-events: none;
        -webkit-mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent); mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent); }
      .tk { position: absolute; left: 0; top: 0; height: 100%; display: flex; align-items: center; white-space: nowrap; will-change: transform; }
      .lg { flex: none; margin-right: ${GAP}px; line-height: 1; color: var(--_muted); transition: color .2s; }
      .lg.on { color: var(--_accent); }
      `,
      `<div class="lab"></div><div class="st"><canvas class="px" aria-hidden="true"></canvas>${ROW_TOP.map((top) => `<div class="rw" style="top:${top}px" aria-hidden="true"><div class="tk"></div></div>`).join("")}</div><span class="sr"></span>`,
      2,
      0.72,
    );
    this.rows = this.$$(".tk").map((track) => ({ track, logos: [], boxes: [], total: 0 }));
    const stage = this.$(".st");
    stage.addEventListener("pointermove", (e) => {
      this.pointer = localPoint(stage, e);
      this.kick();
    });
    stage.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.kick();
    });
  }

  protected override init(): void {
    this.$(".lab").textContent = this.getAttribute("label") || "Placeholder logos · teams building with it";
    this.$(".sr").textContent = `Logos: ${LOGOS.map((logo) => logo[0]).join(", ")}`;
    // remeasure once web fonts have loaded, since the wordmarks change width
    document.fonts?.ready.then(() => {
      this.layout();
      this.kick();
    });
  }

  /** Fill each track with enough cycles to cover the width while it drifts, and measure one cycle. */
  protected override layout(): void {
    this.rows.forEach((row, r) => {
      // the second row starts halfway through the list
      const list = r ? [...LOGOS.slice(5), ...LOGOS.slice(0, 5)] : LOGOS;
      const cycle = list.map(logoHtml).join("");
      if (!row.logos.length) {
        row.track.innerHTML = cycle;
        row.logos = [...row.track.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
      }
      const first = row.logos.slice(0, list.length);
      row.boxes = first.map((el) => ({ x: el.offsetLeft, w: el.offsetWidth }));
      row.total = first.reduce((sum, el) => sum + el.offsetWidth + GAP, 0);
      if (!row.total) return;
      const copies = Math.ceil(this.w / row.total) + 2;
      if (row.logos.length !== copies * list.length) {
        row.track.innerHTML = cycle.repeat(copies);
        row.logos = [...row.track.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
      }
    });
  }

  protected override render(_t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const C = F.cols;
    const W = this.w;
    const pointer = this.pointer;
    let lit: HTMLElement | null = null;
    let plate: LogoBox | null = null;
    let plateTop = 0;
    F.clear();
    // dotted rules above, between and below the rows, faded at both edges with dither
    for (const y of [2, 52, 102]) {
      const j = Math.floor(y / pp);
      for (let i = 0; i < C; i += 2) {
        const e = Math.min(i, C - 1 - i) / (C * 0.14);
        // dither on every other cell, so each rule fades at the same rate whatever its row
        if (e < 1 && bayer(i >> 1, j) > e) continue;
        F.put(i, j, P.muted, 0.35);
      }
    }
    for (const [r, row] of this.rows.entries()) {
      const total = row.total;
      if (!total) continue;
      const top = ROW_TOP[r];
      const dir = r ? 1 : -1;
      const near = !!pointer && Math.abs(pointer[1] - (top + ROW_H / 2)) < 24;
      this.speeds[r] += ((near ? 0.15 : 1) - this.speeds[r]) * Math.min(1, dt * 4);
      if (!R0) this.offsets[r] = (this.offsets[r] + dir * dt * SPEED * this.speeds[r] + total) % total;
      // the track starts one cycle to the left, so it always covers the stage
      const shift = this.offsets[r] - total;
      row.track.style.transform = `translateX(${shift.toFixed(2)}px)`;
      const perCycle = row.boxes.length;
      const copies = Math.round(row.logos.length / perCycle);
      for (let copy = 0; copy < copies; copy++) {
        for (const [k, box] of row.boxes.entries()) {
          const x = shift + copy * total + box.x;
          if (x > W || x + box.w + GAP < 0) continue;
          // separator dot in the middle of the gap after each wordmark
          const sx = x + box.w + GAP / 2;
          const fade = Math.min(1, Math.min(sx, W - sx) / (W * 0.14));
          if (fade > 0) {
            for (let dj = -1; dj <= 0; dj++) {
              for (let di = -1; di <= 0; di++) F.plot(sx + di * pp, top + ROW_H / 2 + dj * pp, P.muted, fade * 0.55);
            }
          }
          if (near && pointer && pointer[0] >= x && pointer[0] <= x + box.w) {
            lit = row.logos[copy * perCycle + k] ?? null;
            plate = { x, w: box.w };
            plateTop = top;
          }
        }
      }
    }
    // the wordmark under the pointer sits on a dotted plate with bloom
    if (plate) this.drawPlate(plate, plateTop);
    this.flush(0.8, 4);
    if (lit !== this.lit) {
      this.lit?.classList.remove("on");
      this.lit = lit;
      this.lit?.classList.add("on");
    }
    return !R0;
  }

  private drawPlate(box: LogoBox, top: number): void {
    const P = this.P;
    const F = this.F;
    const pp = F.pitch;
    const pad = 12;
    const cx = box.x + box.w / 2;
    const cy = top + ROW_H / 2;
    const bx = box.w / 2 + pad;
    const by = ROW_H / 2 - 2;
    for (let j = Math.floor((cy - by) / pp); j <= (cy + by) / pp; j++) {
      for (let i = Math.floor((cx - bx) / pp); i <= (cx + bx) / pp; i++) {
        const [x, y] = F.xy(i, j);
        const sd = rrSdf(x, y, cx, cy, bx, by, 9);
        if (sd > 0) continue;
        const edge = sd > -1.6;
        if (!edge && bayer(i, j) > 0.3) continue;
        F.put(i, j, edge ? mix(P.accent, P.shine, 0.3) : mix(P.accent, P.surface, 0.5), edge ? 0.8 : 0.5, edge ? 0.5 : 0.1);
      }
    }
  }
}

define("hf-marquee", HMarquee);

export { HMarquee };

declare global {
  interface HTMLElementTagNameMap {
    "hf-marquee": HMarquee;
  }
}
