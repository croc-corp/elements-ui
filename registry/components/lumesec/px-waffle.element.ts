/**
 * <px-waffle> · Context waffle
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/waffle
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-waffle.tsx.
 *
 * Demo data: The starting context usage per source is invented; `add()` and `compact()` change it but it
 * cannot be set. It cannot show your own data yet; use it as a template and replace the invented data before
 * it shows anything real.
 */
import { PxBase, define, mix, now, rand, reduced, rollText, type PaletteKey } from "@/lib/lumesec/pixel";

/** Detail of the `change` and `compact` events: filled cells, in thousands of tokens. */
export interface WaffleDetail {
  used: number;
}

/** Events fired by `<px-waffle>`. */
export interface WaffleEventMap {
  /** Fires when cells are added. `used` is the number of filled cells, in thousands of tokens. */
  change: CustomEvent<WaffleDetail>;
  /** Fires after compacting, with the new number of filled cells. */
  compact: CustomEvent<WaffleDetail>;
}

/** A source of context tokens: its legend name, colour and starting size in cells. */
interface ContextSource {
  name: string;
  color: PaletteKey;
  cells: number;
}

/** Sources by category index: 0 System prompt, 1 Tools, 2 Files, 3 Conversation. */
const WAFFLE: readonly ContextSource[] = [
  { name: "System prompt", color: "muted", cells: 6 },
  { name: "Tools", color: "warn", cells: 14 },
  { name: "Files", color: "ok", cells: 38 },
  { name: "Conversation", color: "accent", cells: 52 },
];

/** Category of the conversation, the one Compact shrinks. */
const CONVERSATION = 3;
/** Total cells (200k tokens) in a 20-column grid. */
const CAPACITY = 200;
const GRID_COLS = 20;

/** One filled cell, springing from `(x, y)` to its slot `(tx, ty)`; it starts moving at time `delay`. */
interface WaffleCell {
  cat: number;
  /** Insertion order, which keeps the sort stable. */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  delay: number;
  /** Jump to the slot on the first layout instead of flying in. */
  snap: boolean;
}

/** A compacted cell crumbling away; it waits until `delay`, then falls. */
interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  delay: number;
  age: number;
}

/**
 * Context window as a 200-cell waffle, one cell per thousand tokens; attached files fly in and compacting crumbles the
 * conversation.
 */
class Waffle extends PxBase {
  private cells: WaffleCell[] = [];
  private debris: Debris[] = [];
  /** Highlighted category (legend hover or focus), or null. */
  private highlight: number | null = null;
  private seq = 0;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; gap: 10px; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      .tot { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
      :host([data-zone="warn"]) .tot { color: var(--_warn); }
      :host([data-zone="full"]) .tot { color: var(--_danger); }
      canvas.px { height: 164px; }
      ul { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2px 12px; }
      li { display: flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 2px 4px; border-radius: 6px; cursor: default; }
      li:hover { background: color-mix(in srgb, var(--_fg) 7%, transparent); }
      li i { width: 8px; height: 8px; border-radius: 2px; }
      li b { font-weight: 500; font-family: var(--_mono); font-size: 11.5px; color: var(--_muted); }
      .bar { display: flex; gap: 8px; margin-top: 10px; }
      `,
      `<div class="head"><span class="lab">Context window · 1 cell = 1k tokens</span><span class="rollslot tot" aria-live="polite"></span></div>
        <canvas class="px" role="img"></canvas><ul></ul><div class="bar"><button class="pbtn add" type="button">Attach file (+18k)</button><button class="pbtn cmp" type="button">Compact</button></div>`,
    );
    this.$(".add").addEventListener("click", () => this.add(2, 18));
    this.$(".cmp").addEventListener("click", () => this.compact());
  }

  protected override init(): void {
    const list = this.$("ul");
    WAFFLE.forEach((source, i) => {
      const item = document.createElement("li");
      item.tabIndex = 0;
      const swatch = document.createElement("i");
      swatch.style.background = `var(--_${source.color})`;
      const label = document.createElement("span");
      label.textContent = source.name;
      item.append(swatch, label, document.createElement("b"));
      const highlight = (category: number | null): void => {
        this.highlight = category;
        this.kick();
      };
      item.addEventListener("pointerenter", () => highlight(i));
      item.addEventListener("pointerleave", () => highlight(null));
      item.addEventListener("focus", () => highlight(i));
      item.addEventListener("blur", () => highlight(null));
      list.appendChild(item);
      for (let k = 0; k < source.cells; k++) {
        this.cells.push({ cat: i, id: this.seq++, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, delay: 0, snap: true });
      }
    });
    this.sync(false, 1);
  }

  private geometry(): { pitch: number; ox: number; oy: number } {
    const pitch = Math.min(16, this.w / GRID_COLS);
    return { pitch, ox: (this.w - pitch * GRID_COLS) / 2, oy: 2 };
  }

  /** Sort the cells by category and give each its slot in the grid. */
  private placeCells(): void {
    const { pitch, ox, oy } = this.geometry();
    this.cells.sort((a, b) => a.cat - b.cat || a.id - b.id);
    this.cells.forEach((cell, k) => {
      cell.tx = ox + (k % GRID_COLS) * pitch;
      cell.ty = oy + Math.floor(k / GRID_COLS) * pitch;
    });
  }

  protected override resized(): void {
    this.placeCells();
    for (const cell of this.cells) {
      if (cell.snap) {
        cell.x = cell.tx;
        cell.y = cell.ty;
        cell.snap = false;
      }
    }
  }

  /** Update the total, the warning zone, the legend counts and the canvas label. */
  private sync(animate: boolean, dir: number): void {
    const used = this.cells.length;
    this.dataset.zone = used >= 190 ? "full" : used >= 160 ? "warn" : "ok";
    rollText(this.$(".tot"), `${used}k of 200k`, dir, animate);
    this.$$("li b").forEach((count, i) => {
      count.textContent = `${this.cells.filter((cell) => cell.cat === i).length}k`;
    });
    this.canvas.setAttribute("aria-label", `Context window ${used}k of 200k tokens used`);
  }

  /**
   * Adds cells to a source (0 System prompt, 1 Tools, 2 Files, 3 Conversation), up to the 200-cell limit, and
   * fires `change`. When full, the grid shakes and nothing is added. An unknown category or a count below one
   * is ignored; counts are rounded.
   */
  add(category: number, cells: number): void {
    const count = Math.round(cells);
    if (!Number.isInteger(category) || category < 0 || category >= WAFFLE.length || !(count >= 1)) return;
    const room = CAPACITY - this.cells.length;
    if (room <= 0) {
      if (!reduced()) {
        this.canvas.animate(
          [{ transform: "translateX(-5px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }],
          { duration: 300 },
        );
      }
      return;
    }
    const n = Math.min(count, room);
    const start = now();
    for (let k = 0; k < n; k++) {
      // new cells fly in one after another from the top right
      this.cells.push({
        cat: category,
        id: this.seq++,
        x: this.w + 10,
        y: -10,
        vx: rand(-60, 0),
        vy: rand(0, 60),
        tx: 0,
        ty: 0,
        delay: start + k * 0.035,
        snap: false,
      });
    }
    this.placeCells();
    this.sync(true, 1);
    this.emit<WaffleDetail>("change", { used: this.cells.length });
    this.kick();
  }

  /**
   * Keeps a quarter of the Conversation cells (at least 8), crumbles the rest and fires `compact`. Does nothing
   * if there is nothing to remove.
   */
  compact(): void {
    const conversation = this.cells.filter((cell) => cell.cat === CONVERSATION);
    const keep = Math.max(8, Math.round(conversation.length * 0.25));
    if (conversation.length <= keep) return;
    const gone = new Set(conversation.slice(keep).map((cell) => cell.id));
    const start = now();
    for (const cell of this.cells) {
      if (!gone.has(cell.id)) continue;
      this.debris.push({
        x: cell.x,
        y: cell.y,
        vx: rand(-30, 30),
        vy: rand(-80, 0),
        delay: start + rand(0, 0.3),
        age: 0,
      });
    }
    this.cells = this.cells.filter((cell) => !gone.has(cell.id));
    // the remaining cells close the gaps once the debris has started to fall
    for (const cell of this.cells) cell.delay = start + 0.25 + Math.random() * 0.15;
    this.placeCells();
    this.sync(true, -1);
    this.emit<WaffleDetail>("compact", { used: this.cells.length });
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const still = reduced();
    const { pitch, ox, oy } = this.geometry();
    const size = pitch * 0.66;
    const colors = WAFFLE.map((source) => P[source.color]);
    let moving = false;
    this.clear();
    for (let k = this.cells.length; k < CAPACITY; k++) {
      const x = ox + (k % GRID_COLS) * pitch + size / 2 - 1;
      const y = oy + Math.floor(k / GRID_COLS) * pitch + size / 2 - 1;
      this.dot(x, y, P.fg, 0.16, 2);
    }
    for (const cell of this.cells) {
      if (still) {
        cell.x = cell.tx;
        cell.y = cell.ty;
      } else if (t >= cell.delay) {
        const stiffness = 160;
        const damping = 2 * Math.sqrt(stiffness) * 0.72;
        cell.vx += (stiffness * (cell.tx - cell.x) - damping * cell.vx) * dt;
        cell.x += cell.vx * dt;
        cell.vy += (stiffness * (cell.ty - cell.y) - damping * cell.vy) * dt;
        cell.y += cell.vy * dt;
      }
      if (Math.abs(cell.tx - cell.x) + Math.abs(cell.ty - cell.y) > 0.3) moving = true;
      const dim = this.highlight != null && this.highlight !== cell.cat ? 0.25 : 1;
      // fast cells glow
      const speed = Math.min(1, Math.hypot(cell.vx, cell.vy) / 300);
      this.dot(cell.x, cell.y, mix(colors[cell.cat], P.shine, speed * 0.6), dim, size);
    }
    this.debris = this.debris.filter((d) => {
      if (t < d.delay) {
        this.dot(d.x, d.y, colors[CONVERSATION], 1, size);
        return true;
      }
      d.age += dt;
      d.vy += 600 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.age > 0.9) return false;
      this.dot(d.x, d.y, colors[CONVERSATION], 1 - d.age / 0.9, size * (1 - d.age * 0.6));
      return true;
    });
    return moving || this.debris.length > 0;
  }
}

define("px-waffle", Waffle);

export { Waffle };

declare global {
  interface HTMLElementTagNameMap {
    "px-waffle": Waffle;
  }
}
