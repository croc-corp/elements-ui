/**
 * <hf-kanban> · Kanban board
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/kanban
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-kanban.tsx.
 *
 * Demo data: The three columns and six cards are invented; nothing can be set. It cannot show your own data
 * yet; use it as a template and replace the invented data before it shows anything real.
 */
import {
  HF,
  Sparks,
  bayer,
  boxMapper,
  clamp,
  clientScale,
  define,
  escapeHtml,
  h2,
  hsl,
  inRR,
  mix,
  now,
  reduced,
  segDist,
  strHash,
  toHex,
} from "@/lib/lumesec/pixel";

/** Detail of the `move` event: the card title and the column names. */
export interface KanbanMoveDetail {
  card: string;
  from: string;
  to: string;
}

/** Events fired by `<hf-kanban>`. */
export interface HKanbanEventMap {
  /** A card was dropped or moved by keyboard, including reorders within one column. */
  move: CustomEvent<KanbanMoveDetail>;
}

const COLUMNS = ["To do", "In progress", "Done"];
/** Index of the Done column. */
const DONE = 2;

/** Demo cards: column, title, tag and placeholder assignee initials. */
const CARDS: readonly (readonly [column: number, title: string, tag: string, who: string])[] = [
  [0, "Rotate refresh tokens", "Auth", "AB"],
  [0, "Write migration guide", "Docs", "CD"],
  [0, "Rate-limit the export API", "API", "EF"],
  [1, "Ultracode onboarding", "Growth", "AB"],
  [1, "Fix flaky auth tests", "Tests", "CD"],
  [2, "Dark theme tokens", "Design", "EF"],
];

/** Where a dragged card would land: column, index among the other cards, and those cards. */
interface DropTarget {
  c: number;
  idx: number;
  cards: HTMLElement[];
}

/** A dot of the drag trail, in canvas pixels. */
interface TrailDot {
  x: number;
  y: number;
  t0: number;
}

/** Three-column kanban board: a dragged card leaves a dot trail and a bar marks where it will land. */
class HKanban extends HF {
  /** It also draws on the canvas outside the field, so every flush redraws the whole canvas. */
  protected override partialFlush = false;

  /** The card being dragged by pointer. */
  private dragged: HTMLElement | null = null;
  private trail: TrailDot[] = [];
  private target: DropTarget | null = null;
  private readonly sparks = new Sparks();
  /** Eased 0..1 highlight per column. */
  private readonly columnGlow = [0, 0, 0];
  /** Time and card of the last move; 0 before the first. */
  private landedAt = 0;
  private landed: HTMLElement | null = null;

  constructor() {
    super(
      `
      :host { display: block; }
      .bd { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; -webkit-user-select: none; user-select: none; }
      canvas.px { position: absolute; left: -10px; top: -10px; width: calc(100% + 20px); height: calc(100% + 20px); pointer-events: none; z-index: 0; }
      .col { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 10px 8px 12px; min-height: 230px; min-width: 0; }
      .ch { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; padding: 0 4px 2px; }
      .ch span { color: var(--_muted); font-weight: 500; font-variant-numeric: tabular-nums; }
      .cd { position: relative; z-index: 1; border: 1px solid var(--_border); background: var(--_surface); border-radius: 10px; padding: 9px 10px; cursor: grab; touch-action: none; font-size: 12.5px; line-height: 1.35; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
      .cd:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
      .cd.drag { z-index: 5; cursor: grabbing; box-shadow: 0 16px 34px -12px rgba(0,0,0,.45); pointer-events: none; }
      .cd .mt { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
      .cd .tg { font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 5px; background: var(--_raised); color: var(--_muted); }
      .cd .av { margin-left: auto; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 9px; font-weight: 700; color: #fff; }
      .cd.done .tt { text-decoration: line-through; color: var(--_muted); }
      @media (max-width: 520px) { .bd { grid-template-columns: 1fr; } .col { min-height: 0; } }
      `,
      `<div class="bd"><canvas class="px" aria-hidden="true"></canvas>${COLUMNS.map((c, k) => `<div class="col" data-c="${k}" role="list" aria-label="${c}"><div class="ch">${c}<span></span></div></div>`).join("")}</div><span class="sr" aria-live="polite"></span>`,
      2,
      0.72,
    );
  }

  protected override init(): void {
    const cols = this.$$(".col");
    for (const [c, title, tag, who] of CARDS) {
      const el = document.createElement("div");
      el.className = `cd${c === DONE ? " done" : ""}`;
      el.tabIndex = 0;
      el.setAttribute("role", "listitem");
      const avatar = toHex(hsl(strHash(who) % 360, 0.5, 0.5));
      el.innerHTML = `<div class="tt">${escapeHtml(title)}</div><div class="mt"><span class="tg">${escapeHtml(tag)}</span><span class="av" style="background:${avatar}">${escapeHtml(who)}</span></div>`;
      el.setAttribute("aria-label", `${title}. ${tag}. Arrow keys move the card.`);
      this.wire(el);
      cols[c].append(el);
    }
    this.counts();
  }

  /** Show the number of cards in each column header. */
  private counts(): void {
    this.$$(".col").forEach((col) => {
      col.querySelector(".ch span")!.textContent = String(col.querySelectorAll(".cd").length);
    });
  }

  /** Pointer drag (after 5px of movement) and arrow-key moves for one card. */
  private wire(el: HTMLElement): void {
    let sx = 0;
    let sy = 0;
    let scale = 1;
    let started = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      sx = e.clientX;
      sy = e.clientY;
      scale = clientScale(el);
      started = false;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      if (!started && Math.hypot(e.clientX - sx, e.clientY - sy) > 5) {
        started = true;
        this.dragged = el;
        el.classList.add("drag");
        this.trail = [];
      }
      if (!started) return;
      const dx = (e.clientX - sx) / scale;
      const dy = (e.clientY - sy) / scale;
      const tilt = clamp(dx * 0.02, -3, 3);
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${tilt}deg)`;
      this.findTarget(e.clientX, e.clientY);
      this.kick();
    });
    const end = (): void => {
      if (!started) return;
      started = false;
      this.drop();
    };
    el.addEventListener("pointerup", end);
    // a cancelled drag (a scroll, an interruption) snaps the card back
    el.addEventListener("pointercancel", () => {
      this.target = null;
      end();
    });
    el.addEventListener("keydown", (e) => {
      const col = el.parentElement;
      if (!col) return;
      const ci = Number(col.dataset.c);
      const cards = [...col.querySelectorAll(".cd")];
      const i = cards.indexOf(el);
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = clamp(ci + (e.key === "ArrowRight" ? 1 : -1), 0, COLUMNS.length - 1);
        if (next !== ci) this.move(el, next, Infinity);
      } else if (e.key === "ArrowUp" && i > 0) {
        e.preventDefault();
        this.move(el, ci, i - 1);
      } else if (e.key === "ArrowDown" && i < cards.length - 1) {
        e.preventDefault();
        this.move(el, ci, i + 1);
      }
    });
  }

  /** Find the column under the pointer (with 20px of slack) and the index the dragged card would take. */
  private findTarget(x: number, y: number): void {
    const cols = this.$$(".col");
    const c = cols.findIndex((col) => {
      const r = col.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top - 20 && y <= r.bottom + 20;
    });
    if (c < 0) {
      this.target = null;
      return;
    }
    const cards = [...cols[c].querySelectorAll<HTMLElement>(".cd")].filter((card) => card !== this.dragged);
    let idx = cards.length;
    for (let k = 0; k < cards.length; k++) {
      const r = cards[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        idx = k;
        break;
      }
    }
    this.target = { c, idx, cards };
  }

  /**
   * Move a card to column `c` at `idx` with a FLIP slide from `origin` (where a dragged card was let go) or from its
   * current place; dropping into Done bursts sparks.
   */
  private move(el: HTMLElement, c: number, idx: number, origin?: DOMRect): void {
    const first = origin ?? el.getBoundingClientRect();
    const col = this.$$(".col")[c];
    const from = Number(el.parentElement?.dataset.c);
    const cards = [...col.querySelectorAll(".cd")].filter((card) => card !== el);
    const ref = cards[Math.min(idx, cards.length)] || null;
    col.insertBefore(el, ref);
    el.classList.toggle("done", c === DONE);
    const last = el.getBoundingClientRect();
    const scale = clientScale(el, last);
    if (!reduced()) {
      el.animate(
        [
          { transform: `translate(${(first.left - last.left) / scale}px, ${(first.top - last.top) / scale}px)` },
          { transform: "none" },
        ],
        { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    }
    el.focus({ preventScroll: true });
    this.counts();
    const title = el.querySelector(".tt")!.textContent ?? "";
    this.$(".sr").textContent = `${title} moved to ${COLUMNS[c]}`;
    const canvas = this.cv;
    if (c === DONE && from !== DONE && canvas) {
      const P = this.P;
      const box = boxMapper(canvas)(last);
      this.sparks.add(box.x + box.w / 2, box.y + box.h / 2, 30, [P.ok, P.shine], {
        speed: [50, 180],
        life: [0.35, 0.8],
      });
    }
    this.landedAt = now();
    this.landed = el;
    this.emit<KanbanMoveDetail>("move", { card: title, from: COLUMNS[from], to: COLUMNS[c] });
    this.kick();
  }

  /** End a pointer drag: move the card to the target, or let it snap back. */
  private drop(): void {
    const el = this.dragged;
    if (!el) return;
    el.classList.remove("drag");
    // where the card was let go; the FLIP slide starts there
    const dropped = el.getBoundingClientRect();
    el.style.transform = "";
    if (this.target) this.move(el, this.target.c, this.target.idx, dropped);
    this.dragged = null;
    this.target = null;
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const pp = F.pitch;
    const local = boxMapper(canvas);
    let busy = !!this.dragged;
    F.clear();
    this.$$(".col").forEach((col, k) => {
      const { x: x0, y: y0, w, h } = local(col);
      const on = this.target && this.target.c === k ? 1 : 0;
      this.columnGlow[k] += (on - this.columnGlow[k]) * Math.min(1, dt * 10);
      if (Math.abs(on - this.columnGlow[k]) > 0.01) busy = true;
      const hl = this.columnGlow[k];
      for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < (x0 + w) / pp; i++) {
          const [x, y] = F.xy(i, j);
          const sd = inRR(x - x0, y - y0, w, h, 12);
          if (sd > 0) continue;
          if (sd > -1.5) {
            F.put(i, j, mix(P.border, P.accent, hl), 0.6 + hl * 0.4, hl * 0.5);
            continue;
          }
          if (bayer(i, j) < 0.3 + hl * 0.2) F.put(i, j, mix(P.raised, P.accent, hl * 0.35), 0.9, 0);
        }
      }
      // done column: faint check watermark, left of the card count
      if (k === DONE) {
        const cx = x0 + w - 34;
        const cy = y0 + 13;
        for (let j = Math.floor((cy - 6) / pp); j <= (cy + 6) / pp; j++) {
          for (let i = Math.floor((cx - 7) / pp); i <= (cx + 7) / pp; i++) {
            const [x, y] = F.xy(i, j);
            const dx = x - cx;
            const dy = y - cy;
            if (Math.min(segDist(dx, dy, -5, 0, -1.5, 4), segDist(dx, dy, -1.5, 4, 5.5, -4)) < 1.2) {
              F.put(i, j, P.ok, 0.9, 0.2);
            }
          }
        }
      }
    });
    // insertion bar
    if (this.dragged && this.target) {
      const col = local(this.$$(".col")[this.target.c]);
      const cards = this.target.cards;
      let y: number;
      if (!cards.length) y = col.y + 34;
      else if (this.target.idx >= cards.length) {
        const above = local(cards[cards.length - 1]);
        y = above.y + above.h + 4;
      } else y = local(cards[this.target.idx]).y - 4;
      const x0 = col.x + 10;
      const x1 = col.x + col.w - 10;
      for (let j = Math.floor((y - 1.5) / pp); j <= (y + 1.5) / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < x1 / pp; i++) F.put(i, j, mix(P.accent, P.shine, 0.5), 1, 0.8);
      }
    }
    // drag trail
    if (this.dragged) {
      const r = local(this.dragged);
      this.trail.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, t0: t });
    }
    this.trail = this.trail.filter((q) => t - q.t0 < 0.45);
    for (const q of this.trail) {
      const a = 1 - (t - q.t0) / 0.45;
      for (let k = 0; k < 3; k++) {
        const x = q.x + (h2(q.t0 * 100, k) - 0.5) * 40;
        const y = q.y + (h2(k, q.t0 * 100) - 0.5) * 20;
        F.plot(x, y, mix(P.accent, P.shine, a), a, a * 0.8);
      }
      busy = true;
    }
    // landing ring
    const land = this.landedAt ? clamp(1 - (t - this.landedAt) / 0.5, 0, 1) : 0;
    if (land > 0 && this.landed) {
      busy = true;
      const r = local(this.landed);
      const x0 = r.x - 3;
      const y0 = r.y - 3;
      const w = r.w + 6;
      const h = r.h + 6;
      for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < (x0 + w) / pp; i++) {
          const [x, y] = F.xy(i, j);
          const sd = inRR(x - x0, y - y0, w, h, 12);
          if (sd <= 0 && sd > -1.8) F.put(i, j, mix(P.accent, P.shine, 0.4), land, land);
        }
      }
    }
    this.flush(0.8, 5);
    const sparking = this.ctx ? this.sparks.step(this.ctx, dt) : false;
    return busy || sparking;
  }
}

define("hf-kanban", HKanban);

export { HKanban };

declare global {
  interface HTMLElementTagNameMap {
    "hf-kanban": HKanban;
  }
}
