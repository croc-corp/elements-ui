/**
 * <hf-gantt> · Roadmap
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/gantt
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-gantt.tsx.
 *
 * Demo data: The six tasks, their dates and progress and the today line are invented; only `label` can be set.
 * It cannot show your own data yet; use it as a template and replace the invented data before it shows
 * anything real.
 */
import {
  HF,
  bayer,
  clamp,
  define,
  ease3,
  escapeHtml,
  inRR,
  mix,
  now,
  reduced,
  rollText,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Detail of the `change` event: the task name and its day offsets from 5 October 2026, 0 to 41. */
export interface GanttChangeDetail {
  task: string;
  start: number;
  end: number;
}

/** Events fired by `<hf-gantt>`. */
export interface HGanttEventMap {
  /** A drag ended, or a bar was moved or resized by keyboard. */
  change: CustomEvent<GanttChangeDetail>;
}

/** Demo tasks: name, start day, end day and progress; equal start and end make a milestone. */
const TASKS: readonly (readonly [name: string, start: number, end: number, progress: number])[] = [
  ["Discovery", 0, 6, 1],
  ["Design", 4, 13, 1],
  ["API v2", 9, 25, 0.6],
  ["Ultracode beta", 17, 31, 0.3],
  ["Security review", 25, 33, 0],
  ["Launch", 37, 37, 0],
];

/** A task row: day range `a`..`b`, progress `p`, eased draw positions and its bar button. */
interface GanttTask {
  n: string;
  a: number;
  b: number;
  p: number;
  xa: number;
  xb: number;
  el: HTMLButtonElement | null;
}

/** A pointer drag: the task, the start pointer x and range, and whether it moves the bar or its end. */
interface GanttDrag {
  k: number;
  x0: number;
  a: number;
  b: number;
  mode: "move" | "end";
}

const ROW_H = 34;
/** Day offsets per arrow key. */
const ARROW_DAYS: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };
const WHITE: RGB = [255, 255, 255];

/** Roadmap Gantt chart with dithered progress bars, a pulsing milestone and a today line. */
class HGantt extends HF {
  static observedAttributes = ["label"];

  private readonly tasks: GanttTask[] = TASKS.map(([n, a, b, p]) => ({ n, a, b, p, xa: a, xb: b, el: null }));
  /** Days shown: weeks 41 to 46 of 2026. */
  private readonly days = 42;
  /** Day of the today line, 25 October 2026. */
  private readonly today = 20;
  private drag: GanttDrag | null = null;
  /** Focused or dragged task, or -1. */
  private active = -1;
  private t0 = 0;
  private readonly box = this.$(".box");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 8px; }
      .hd b { font-size: 13.5px; font-weight: 600; }
      .hd span { font-size: 12px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      /* on narrow screens the names shrink with an ellipsis before the chart gets too small for its week labels */
      .g { display: grid; grid-template-columns: minmax(0, max-content) minmax(136px, 1fr); column-gap: 12px; }
      .wk { grid-column: 2; display: flex; justify-content: space-between; font-size: 10.5px; color: var(--_muted); margin-bottom: 4px; padding-right: 4px; }
      .nm { grid-column: 1; display: grid; grid-auto-rows: 34px; align-items: center; font-size: 12.5px; white-space: nowrap; min-width: 0; }
      .nm span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .box { position: relative; grid-column: 2; touch-action: none; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .bar { position: absolute; height: 22px; transform: translateY(-50%); border-radius: 7px; cursor: grab; }
      .bar.ms { width: 20px; margin-left: -10px; cursor: default; }
      .bar:active { cursor: grabbing; }
      .ft { font-size: 11.5px; color: var(--_muted); margin-top: 8px; }
      `,
      `<div class="hd"><b class="ti"></b><span class="rollslot st" aria-live="polite"></span></div><div class="g"><div class="wk"></div><div class="nm"></div><div class="box"><canvas class="px" aria-hidden="true"></canvas></div></div><div class="ft" id="hint">Drag a bar to move it, drag its right end to resize. Arrow keys move, Shift+arrows resize.</div>`,
      2,
      0.74,
    );
    const box = this.box;
    box.addEventListener("pointerdown", (e) => {
      const target = e.target;
      const el = target instanceof Element ? target.closest<HTMLElement>(".bar") : null;
      if (!el || e.button !== 0) return;
      const k = Number(el.dataset.k);
      const task = this.tasks[k];
      if (task.a === task.b) return;
      const r = el.getBoundingClientRect();
      box.setPointerCapture(e.pointerId);
      // within 10px of the right end the drag resizes
      this.drag = { k, x0: e.clientX, a: task.a, b: task.b, mode: e.clientX > r.right - 10 ? "end" : "move" };
      this.active = k;
      this.kick();
    });
    box.addEventListener("pointermove", (e) => {
      const drag = this.drag;
      if (!drag) return;
      // a day's on-screen width, which differs from its CSS width inside a zoomed ancestor
      const dayWidth = box.getBoundingClientRect().width / this.days;
      const days = Math.round((e.clientX - drag.x0) / dayWidth);
      const task = this.tasks[drag.k];
      if (drag.mode === "move") {
        const len = drag.b - drag.a;
        task.a = clamp(drag.a + days, 0, this.days - 1 - len);
        task.b = task.a + len;
      } else {
        task.b = clamp(drag.b + days, task.a + 1, this.days - 1);
      }
      this.sync(drag.k);
      this.kick();
    });
    const up = (): void => {
      const drag = this.drag;
      if (!drag) return;
      this.drag = null;
      // a press without a move changes nothing
      const task = this.tasks[drag.k];
      if (task.a !== drag.a || task.b !== drag.b) this.emitChange(task);
      this.kick();
    };
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
  }

  /** Short date of day offset `d` from 5 October 2026 (`Oct 9`). */
  private date(d: number): string {
    const base = new Date(2026, 9, 5);
    base.setDate(base.getDate() + d);
    return base.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  attributeChangedCallback(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Q4 roadmap";
  }

  protected override init(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Q4 roadmap";
    this.$(".wk").innerHTML = Array.from({ length: 6 }, (_, k) => `<span>W${41 + k}</span>`).join("");
    this.$(".nm").innerHTML = this.tasks.map((task) => `<span>${escapeHtml(task.n)}</span>`).join("");
    const box = this.box;
    box.style.height = `${this.tasks.length * ROW_H}px`;
    this.tasks.forEach((task, k) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `bar${task.a === task.b ? " ms" : ""}`;
      el.dataset.k = String(k);
      if (task.a !== task.b) el.setAttribute("aria-describedby", "hint");
      el.style.background = "none";
      el.style.border = "0";
      el.addEventListener("focus", () => {
        this.active = k;
        this.sync(k);
        this.kick();
      });
      el.addEventListener("blur", () => {
        if (this.active === k) this.active = -1;
        this.kick();
      });
      el.addEventListener("keydown", (e) => {
        if (task.a === task.b) return;
        const step = ARROW_DAYS[e.key];
        if (!step) return;
        e.preventDefault();
        if (e.shiftKey) {
          task.b = clamp(task.b + step, task.a + 1, this.days - 1);
        } else {
          const len = task.b - task.a;
          task.a = clamp(task.a + step, 0, this.days - 1 - len);
          task.b = task.a + len;
        }
        this.sync(k);
        this.emitChange(task);
        this.kick();
      });
      box.append(el);
      task.el = el;
      this.labelBar(k);
    });
    rollText(this.$(".st"), `Today · ${this.date(this.today)}`, 1, false);
    this.t0 = now();
  }

  protected override layout(): void {
    this.tasks.forEach((_, k) => this.place(k));
  }

  /** Name task `k`'s bar button with the task, its dates and progress. Set on init, before the first layout. */
  private labelBar(k: number): void {
    const task = this.tasks[k];
    task.el?.setAttribute(
      "aria-label",
      task.a === task.b
        ? `${task.n}: ${this.date(task.a)}`
        : `${task.n}: ${this.date(task.a)} to ${this.date(task.b)}, ${Math.round(task.p * 100)}% done`,
    );
  }

  /** Position task `k`'s bar button over its drawn bar and label it. */
  private place(k: number): void {
    const task = this.tasks[k];
    const dw = this.w / this.days;
    const el = task.el;
    if (!el) return;
    const milestone = task.a === task.b;
    el.style.top = `${k * ROW_H + ROW_H / 2}px`;
    el.style.left = `${milestone ? (task.a + 0.5) * dw : task.a * dw}px`;
    if (!milestone) el.style.width = `${(task.b - task.a + 1) * dw}px`;
    this.labelBar(k);
  }

  /** Place task `k` and roll its dates into the status. */
  private sync(k: number): void {
    this.place(k);
    const task = this.tasks[k];
    const dates = task.a === task.b ? this.date(task.a) : `${this.date(task.a)} – ${this.date(task.b)}`;
    rollText(this.$(".st"), `${task.n} · ${dates}`, 1, true);
  }

  private emitChange(task: GanttTask): void {
    this.emit<GanttChangeDetail>("change", { task: task.n, start: task.a, end: task.b });
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const dw = this.w / this.days;
    const intro = R0 ? 9 : (t - this.t0) * 1.5;
    const busy = !R0;
    F.clear();
    // week lines
    for (let wk = 1; wk < 6; wk++) {
      const i = Math.round((wk * 7 * dw) / pp);
      for (let j = 0; j < F.rows; j += 2) F.put(i, j, P.muted, 0.25);
    }
    const follow = Math.min(1, R0 ? 1 : dt * 18);
    this.tasks.forEach((task, k) => {
      task.xa += (task.a - task.xa) * follow;
      task.xb += (task.b - task.xb) * follow;
      const cy = k * ROW_H + ROW_H / 2;
      const on = this.active === k;
      const g = clamp(intro - k * 0.12, 0, 1);
      if (task.a === task.b) {
        // milestone diamond
        const cx = (task.xa + 0.5) * dw;
        const s = 9 * (R0 ? 1 : 0.9 + 0.1 * Math.sin(t * 4)) * g;
        for (let j = Math.floor((cy - 11) / pp); j <= (cy + 11) / pp; j++) {
          for (let i = Math.floor((cx - 11) / pp); i <= (cx + 11) / pp; i++) {
            const [x, y] = F.xy(i, j);
            const d = Math.abs(x - cx) + Math.abs(y - cy);
            if (d < s) F.put(i, j, d > s - 2 ? mix(P.warn, P.shine, 0.3) : P.warn, 1, d > s - 2 ? 0.7 : 0.3);
          }
        }
        return;
      }
      const x0 = task.xa * dw + 1;
      const w = ((task.xb - task.xa + 1) * dw - 2) * ease3(g);
      const h = 22;
      const y0 = cy - h / 2;
      const progress = task.p;
      for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < (x0 + w) / pp; i++) {
          const [x, y] = F.xy(i, j);
          const lx = x - x0;
          const ly = y - y0;
          const sd = inRR(lx, ly, w, h, 7);
          if (sd > 0) continue;
          const edge = sd > -1.5;
          const done = lx / w <= progress;
          const c = progress >= 1 ? P.ok : P.accent;
          if (edge) {
            F.put(i, j, on ? mix(c, P.shine, 0.4) : c, on ? 1 : 0.8, on ? 0.5 : 0.1);
            continue;
          }
          // the done part is dense, the rest sparse
          if (!done && bayer(i, j) > 0.14) continue;
          if (done && bayer(i, j) > 0.78) continue;
          F.put(i, j, done ? mix(c, P.shine, on ? 0.3 : 0) : c, done ? 0.85 : 0.6, on ? 0.2 : 0.04);
        }
      }
      // resize grip
      if (on) {
        for (let j = Math.floor((cy - 5) / pp); j <= (cy + 5) / pp; j++) {
          F.put(Math.round((x0 + w - 5) / pp), j, WHITE, 0.9, 0.4);
        }
      }
    });
    // today line with a scanning glint
    const tx = (this.today + 0.5) * dw;
    const sy = R0 ? -99 : ((t * 60) % (this.h + 40)) - 20;
    for (let j = 0; j < F.rows; j++) {
      const [, y] = F.xy(0, j);
      const glint = Math.exp(-((y - sy) ** 2) / 120);
      F.put(Math.round(tx / pp - 0.5), j, mix(P.danger, P.shine, glint * 0.6), 0.7 + glint * 0.3, 0.25 + glint * 0.7);
    }
    this.flush(0.8, 4);
    return busy;
  }
}

define("hf-gantt", HGantt);

export { HGantt };

declare global {
  interface HTMLElementTagNameMap {
    "hf-gantt": HGantt;
  }
}
