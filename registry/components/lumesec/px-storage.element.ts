/**
 * <px-storage> · Storage ring
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/storage
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-storage.tsx.
 *
 * Demo data: The storage categories and their sizes are invented; nothing can be set. It cannot show your own
 * data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { PxBase, TAU, define, hash, mix, reduced, rollText, smooth, type RGB, type Range } from "@/lib/lumesec/pixel";

/** A storage category of the demo data. */
export type StorageSegment = "Projects" | "Files" | "Chats" | "Memory" | "Free";

/** Events fired by `<px-storage>`. */
export interface StorageEventMap {
  /** Fires when a segment is pinned or unpinned. `segment` is the category name, or `null` when the pin is cleared. */
  select: CustomEvent<{ segment: StorageSegment | null }>;
}

/** A category, its size and its legend swatch colour. */
interface SegmentSpec {
  name: StorageSegment;
  gb: number;
  /** CSS colour of the legend swatch, matching the ring colour. */
  sw: string;
}

/** Built-in demo data; the last segment is the free space. */
const SEGS: readonly SegmentSpec[] = [
  { name: "Projects", gb: 3.2, sw: "var(--_accent)" },
  { name: "Files", gb: 2.1, sw: "color-mix(in srgb, var(--_accent) 50%, var(--_shine))" },
  { name: "Chats", gb: 1.5, sw: "var(--_ok)" },
  { name: "Memory", gb: 0.9, sw: "var(--_warn)" },
  { name: "Free", gb: 2.3, sw: "color-mix(in srgb, var(--_fg) 25%, transparent)" },
];

const FREE = SEGS.length - 1;
const TOTAL_GB = SEGS.reduce((sum, s) => sum + s.gb, 0);

/** Share of the ring each segment covers, as `[start, end)` fractions clockwise from the top. */
const RANGES: readonly Range[] = (() => {
  let acc = 0;
  return SEGS.map((s): Range => {
    const range: Range = [acc / TOTAL_GB, (acc + s.gb) / TOTAL_GB];
    acc += s.gb;
    return range;
  });
})();

/** Ring size and centre in px. */
const SIZE = 200;
const CENTER = 100;

/** Fraction of a full turn clockwise from 12 o'clock for an offset from the centre. */
const turnOf = (dx: number, dy: number): number => (((Math.atan2(dx, -dy) % TAU) + TAU) % TAU) / TAU;

/** Index of the segment covering the turn fraction `f`, or -1. */
const segmentOf = (f: number): number => RANGES.findIndex(([a, b]) => f >= a && f < b);

/** A pixel of the ring. */
interface RingCell {
  x: number;
  y: number;
  /** Turn fraction clockwise from the top; the sweep reveals cells in this order. */
  f: number;
  seg: number;
  /** Unit vector away from the centre, for the pop-out. */
  ux: number;
  uy: number;
  /** Stable random value for the shimmer phase. */
  rnd: number;
}

/** Pixel donut chart of storage use; pointing at a segment pushes its pixels outward and click pins it. */
class Storage extends PxBase {
  private cells: RingCell[] = [];
  private hovered: number | null = null;
  private locked: number | null = null;
  /** Pop-out of each segment, from 0 to 1. */
  private pop: number[] = SEGS.map(() => 0);
  /** Start of the clockwise sweep. */
  private sweepStart = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: flex; align-items: center; justify-content: center; gap: 22px; flex-wrap: wrap; }
      .dial { position: relative; width: 200px; height: 200px; }
      canvas.px { width: 200px; height: 200px; cursor: pointer; }
      .center { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 2px; pointer-events: none; text-align: center; }
      .center .rollslot { justify-items: center; }
      .big { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .small { font-size: 12px; color: var(--_muted); }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; min-width: 160px; }
      li button { display: flex; align-items: center; gap: 9px; width: 100%; border: 0; background: none; padding: 5px 8px; border-radius: 7px; cursor: pointer; font-size: 13px; text-align: left; }
      li button:hover, li button[aria-pressed="true"] { background: color-mix(in srgb, var(--_fg) 7%, transparent); }
      .sw { width: 9px; height: 9px; border-radius: 2px; flex: none; }
      .sz { margin-left: auto; color: var(--_muted); font-family: var(--_mono); font-size: 12px; font-variant-numeric: tabular-nums; padding-left: 12px; }
      `,
      `<div class="wrap"><div class="dial"><canvas class="px" role="img"></canvas><div class="center"><span class="rollslot big"></span><span class="rollslot small"></span></div></div><ul></ul></div>`,
    );
    const list = this.$("ul");
    SEGS.forEach((s, i) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      const swatch = document.createElement("span");
      swatch.className = "sw";
      swatch.style.background = s.sw;
      const name = document.createElement("span");
      name.textContent = s.name;
      const size = document.createElement("span");
      size.className = "sz";
      size.textContent = `${s.gb.toFixed(1)} GB`;
      button.append(swatch, name, size);
      button.addEventListener("pointerenter", () => this.hover(i));
      button.addEventListener("pointerleave", () => this.hover(null));
      button.addEventListener("focus", () => this.hover(i));
      button.addEventListener("blur", () => this.hover(null));
      button.addEventListener("click", () => this.lock(i));
      item.appendChild(button);
      list.appendChild(item);
    });
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => this.hover(this.segmentAt(e)));
    canvas.addEventListener("pointerleave", () => this.hover(null));
    canvas.addEventListener("click", (e) => this.lock(this.segmentAt(e)));
  }

  protected override init(): void {
    this.cells = [];
    for (let y = 2.5; y < SIZE; y += 5) {
      for (let x = 2.5; x < SIZE; x += 5) {
        const dx = x - CENTER;
        const dy = y - CENTER;
        const r = Math.hypot(dx, dy);
        if (r < 56 || r > 92) continue;
        const f = turnOf(dx, dy);
        const seg = segmentOf(f);
        this.cells.push({ x, y, f, seg: seg < 0 ? FREE : seg, ux: dx / r, uy: dy / r, rnd: hash(x * 3.1 + y * 7.3) });
      }
    }
    this.sweepStart = performance.now() / 1000;
    this.updateLabel(false);
    this.$("canvas").setAttribute("aria-label", `Storage: ${SEGS.map((s) => `${s.name} ${s.gb} GB`).join(", ")}`);
  }

  /** The segment under the pointer, or null off the ring. */
  private segmentAt(e: MouseEvent): number | null {
    const canvas = this.cv;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const dx = e.clientX - r.left - CENTER;
    const dy = e.clientY - r.top - CENTER;
    const d = Math.hypot(dx, dy);
    if (d < 50 || d > 100) return null;
    const i = segmentOf(turnOf(dx, dy));
    return i < 0 ? null : i;
  }

  private hover(i: number | null): void {
    if (i === this.hovered) return;
    this.hovered = i;
    this.updateLabel(true);
    this.kick();
  }

  /**
   * Pins the segment at `index` (0 to 4), or unpins it if it is already pinned or `index` is null, and fires
   * `select`. Other values are ignored.
   */
  lock(index: number | null): void {
    if (index !== null && !(Number.isInteger(index) && index >= 0 && index < SEGS.length)) return;
    this.locked = this.locked === index ? null : index;
    this.updateLabel(true);
    this.emit<{ segment: StorageSegment | null }>("select", {
      segment: this.locked == null ? null : SEGS[this.locked].name,
    });
    this.kick();
  }

  /** Index of the pinned segment, else the hovered one, else `null`. */
  get active(): number | null {
    return this.locked ?? this.hovered;
  }

  /** Show the active segment's size and share in the centre, or the total use. */
  private updateLabel(animate: boolean): void {
    const a = this.active;
    const used = TOTAL_GB - SEGS[FREE].gb;
    const big = a == null ? `${used.toFixed(1)} GB` : `${SEGS[a].gb.toFixed(1)} GB`;
    const small =
      a == null
        ? `of ${TOTAL_GB.toFixed(0)} GB used`
        : `${SEGS[a].name} · ${Math.round((SEGS[a].gb / TOTAL_GB) * 100)}%`;
    const dir = a == null ? -1 : 1;
    rollText(this.$(".big"), big, dir, animate);
    rollText(this.$(".small"), small, dir, animate);
    this.$$("li button").forEach((button, j) => button.setAttribute("aria-pressed", String(this.locked === j)));
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const a = this.active;
    const still = reduced();
    const colors: RGB[] = [P.accent, mix(P.accent, P.shine, 0.5), P.ok, P.warn, P.fg];
    const reveal = still ? 1 : smooth(0, 1, (t - this.sweepStart) / 1.1);
    let moving = reveal < 1;
    this.pop = this.pop.map((p, i) => {
      const target = a === i ? 1 : 0;
      const next = still ? target : p + (target - p) * Math.min(1, dt * 12);
      if (Math.abs(next - target) > 0.002) moving = true;
      return next;
    });
    this.clear();
    for (const c of this.cells) {
      if (c.f > reveal) continue;
      const pop = this.pop[c.seg];
      const shimmer = still ? 0 : 0.12 * Math.sin(t * 2 + c.rnd * 20);
      let alpha = c.seg === FREE ? 0.16 : 0.78 + shimmer;
      if (a != null && a !== c.seg) alpha *= 0.35;
      alpha += pop * 0.2;
      // the sweep front glows as it passes
      const edge = reveal < 1 ? Math.max(0, 1 - (reveal - c.f) * 18) : 0;
      const offset = pop * 7;
      const color = mix(colors[c.seg], P.shine, Math.max(edge, pop * 0.25));
      this.dot(c.x + c.ux * offset - 1.6, c.y + c.uy * offset - 1.6, color, alpha + edge * 0.5, 3.2);
    }
    // the idle shimmer keeps the loop running unless motion is reduced
    return moving || !still;
  }
}

define("px-storage", Storage);

export { Storage };

declare global {
  interface HTMLElementTagNameMap {
    "px-storage": Storage;
  }
}
