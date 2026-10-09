/**
 * <px-tasks> · Pixel checklist
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/tasks
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-tasks.tsx.
 */
import { PxBase, SMALL_CHECK, Sparks, clamp, define, mix, now, reduced, rollText } from "@/lib/lumesec/pixel";

/** Events fired by `<px-tasks>`. */
export interface TasksEventMap {
  /** Fires each time a task is checked or unchecked. */
  change: CustomEvent<{ done: number; total: number }>;
}

/** Demo tasks used when the `items` attribute is missing. */
const TASKS: readonly string[] = [
  "Draft the launch post",
  "Record the demo video",
  "Review the pricing page",
  "Ship v2.14 to production",
];

/** A task row and its animation state. */
interface TaskRow {
  button: HTMLButtonElement;
  boxEl: HTMLSpanElement;
  textEl: HTMLSpanElement;
  done: boolean;
  /** Box fill from 0 to 1, growing from the centre. */
  fill: number;
  /** Strike-through progress from 0 to 1; it starts once the box is mostly filled. */
  strike: number;
  /** Measured layout: box left, row centre, text left and width. */
  bx: number;
  cy: number;
  tx: number;
  tw: number;
}

/** Pixel checklist where checking fills the box from the centre and draws a fizzing strike-through. */
class Tasks extends PxBase {
  static readonly observedAttributes = ["items"] as const;

  private readonly rows: TaskRow[] = [];
  private measured = false;
  private readonly sparks = new Sparks();
  /** Time the completion wave starts. */
  private partyAt = -9;
  private partyFired = true;

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { position: relative; padding-bottom: 36px; }
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; z-index: 2; }
      ul { list-style: none; margin: 0; padding: 0; }
      .row { display: flex; align-items: center; gap: 12px; width: 100%; height: 42px; border: 0; background: none; padding: 0 8px; border-radius: 9px; cursor: pointer; text-align: left; font-size: 14px; }
      .row:hover { background: color-mix(in srgb, var(--_fg) 5%, transparent); }
      .box { width: 16px; height: 16px; flex: none; }
      .txt { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color .4s ease .15s; }
      .row[aria-checked="true"] .txt { color: var(--_muted); }
      .foot { position: absolute; right: 8px; bottom: 2px; font-size: 12px; color: var(--_muted); }
      :host([data-all]) .foot { color: var(--_ok); font-weight: 500; }
      `,
      `<div class="wrap"><ul></ul><canvas class="px" aria-hidden="true"></canvas><span class="foot"><span class="rollslot cnt" aria-live="polite"></span></span></div>`,
    );
  }

  protected override init(): void {
    this.buildRows();
    this.updateCount(false, 1);
  }

  attributeChangedCallback(): void {
    // before the first connect, init() builds the list; later a new list starts unchecked
    if (!this.initialized) return;
    this.buildRows();
    this.partyFired = true;
    this.updateCount(false, 1);
    this.kick();
  }

  /** One checkbox row per task of the `items` attribute, or the demo tasks. */
  private buildRows(): void {
    const list = this.$("ul");
    list.replaceChildren();
    this.rows.length = 0;
    this.measured = false;
    const items = (this.getAttribute("items") ?? "").split("|").filter((item) => item.trim());
    (items.length ? items : TASKS).forEach((text, i) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "row";
      button.setAttribute("role", "checkbox");
      button.setAttribute("aria-checked", "false");
      const boxEl = document.createElement("span");
      boxEl.className = "box";
      const textEl = document.createElement("span");
      textEl.className = "txt";
      textEl.textContent = text;
      button.append(boxEl, textEl);
      button.addEventListener("click", () => this.toggle(i));
      item.appendChild(button);
      list.appendChild(item);
      this.rows.push({ button, boxEl, textEl, done: false, strike: 0, fill: 0, bx: 0, cy: 0, tx: 0, tw: 0 });
    });
    // with the built-in demo tasks the first one starts checked
    if (!items.length) {
      const first = this.rows[0];
      first.done = true;
      first.strike = 1;
      first.fill = 1;
      first.button.setAttribute("aria-checked", "true");
    }
  }

  private measure(): void {
    for (const row of this.rows) {
      row.bx = row.boxEl.offsetLeft;
      row.cy = row.button.offsetTop + row.button.offsetHeight / 2;
      row.tx = row.textEl.offsetLeft;
      row.tw = row.textEl.offsetWidth;
    }
    this.measured = true;
  }

  protected override resized(): void {
    this.measure();
  }

  private get doneCount(): number {
    return this.rows.filter((row) => row.done).length;
  }

  private updateCount(animate: boolean, dir: number): void {
    const done = this.doneCount;
    const total = this.rows.length;
    this.toggleAttribute("data-all", done === total);
    rollText(this.$(".cnt"), done === total ? "All done" : `${done} of ${total} done`, dir, animate);
  }

  /** Checks or unchecks the task at `index` and fires `change`. An index without a task is ignored. */
  toggle(index: number): void {
    const row: TaskRow | undefined = this.rows[index];
    if (!row) return;
    const P = this.P;
    row.done = !row.done;
    row.button.setAttribute("aria-checked", String(row.done));
    if (row.done) this.sparks.add(row.bx + 8, row.cy, 10, [P.accent, P.shine], { speed: [30, 110] });
    this.updateCount(true, row.done ? 1 : -1);
    const done = this.doneCount;
    if (done === this.rows.length) {
      this.partyAt = now() + 0.55;
      this.partyFired = false;
    }
    this.emit<{ done: number; total: number }>("change", { done, total: this.rows.length });
    this.kick();
  }

  /** Animate and draw one row: box outline, fill, check and strike-through. Returns whether it is still moving. */
  private drawRow(row: TaskRow, t: number, dt: number, still: boolean): boolean {
    const P = this.P;
    const target = row.done ? 1 : 0;
    if (still) {
      row.fill = target;
      row.strike = target;
    } else {
      row.fill += clamp(target - row.fill, -dt * 5, dt * 5);
      const strikeTarget = row.done ? (row.fill >= 0.6 ? 1 : 0) : 0;
      row.strike += clamp(strikeTarget - row.strike, -dt * 4, dt / 0.45);
    }
    const moving = Math.abs(row.fill - target) > 0.001 || Math.abs(row.strike - target) > 0.001;
    const x0 = row.bx;
    const y0 = row.cy - 8;
    // dotted outline that fades as the box fills
    const outline = 0.3 * (1 - row.fill) + 0.1;
    for (let k = 0; k < 6; k++) {
      const o = k * 3;
      this.dot(x0 + o, y0, P.fg, outline, 2);
      this.dot(x0 + o, y0 + 15, P.fg, outline, 2);
      this.dot(x0, y0 + o, P.fg, outline, 2);
      this.dot(x0 + 15, y0 + o, P.fg, outline, 2);
    }
    if (row.fill > 0) {
      for (let cy = 0; cy < 5; cy++) {
        for (let cx = 0; cx < 5; cx++) {
          if (Math.hypot(cx - 2, cy - 2) / 2.83 > row.fill * 1.15) continue;
          this.dot(x0 + 1 + cx * 3, y0 + 1 + cy * 3, P.accent, 1, 2.8);
        }
      }
      if (row.fill > 0.75) {
        const alpha = (row.fill - 0.75) * 4;
        for (const [cx, cy] of SMALL_CHECK) this.dot(x0 + 1 + cx * 2, y0 + 3 + cy * 2, P.surface, alpha, 2);
      }
    }
    if (row.strike > 0) {
      const length = row.tw * row.strike;
      for (let x = 0; x < length; x += 3) {
        // the head of the line fizzes while it is drawn
        const head = length - x < 9 && row.strike < 1;
        const wobble = head && !still ? Math.sin(t * 40 + x) : 0;
        this.dot(row.tx + x, row.cy - 1 + wobble, head ? mix(P.accent, P.shine, 0.5) : P.muted, head ? 1 : 0.85, 2);
      }
      if (row.done && row.strike < 1 && !still && Math.random() < 0.5) {
        this.sparks.add(row.tx + length, row.cy, 1, [P.accent, P.shine], { speed: [20, 80], life: [0.2, 0.45] });
      }
    }
    return moving;
  }

  protected override render(t: number, dt: number): boolean {
    const g = this.ctx;
    if (!this.rows.length || !g) return false;
    if (!this.measured) this.measure();
    const P = this.P;
    const still = reduced();
    const total = this.rows.length;
    let busy = false;
    this.clear();
    for (const row of this.rows) {
      if (this.drawRow(row, t, dt, still)) busy = true;
    }

    // progress bar along the bottom; a green wave runs through it once everything is done
    const done = this.doneCount;
    const barY = this.h - 16;
    const barX = 8;
    const barW = Math.max(40, this.w - 120);
    const columns = Math.floor(barW / 4);
    const frac = this.rows.reduce((sum, row) => sum + row.strike, 0) / total;
    const all = done === total && frac > 0.999;
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < 2; r++) {
        const u = (c + 0.5) / columns;
        const on = u <= frac;
        let color = all ? P.ok : P.accent;
        let alpha = on ? 0.9 : 0.12;
        if (all && !still) {
          const wave = Math.exp(-(((u - (((t - this.partyAt) * 0.9) % 1.6)) / 0.06) ** 2));
          color = mix(color, P.shine, wave * 0.8);
          alpha = Math.min(1, alpha + wave * 0.3);
        }
        this.dot(barX + c * 4, barY + r * 4, on ? color : P.fg, alpha, 2.6);
      }
    }
    if (done === total && !this.partyFired && t >= this.partyAt) {
      this.partyFired = true;
      for (let k = 0; k < 6; k++) {
        this.sparks.add(barX + (barW * k) / 5, barY, 12, [P.ok, P.shine, P.accent], {
          speed: [40, 170],
          angle: -Math.PI / 2,
          spread: Math.PI,
        });
      }
    }
    const sparking = this.sparks.step(g, dt);
    return busy || sparking || !this.partyFired || (all && !still && t - this.partyAt < 6);
  }
}

define("px-tasks", Tasks);

export { Tasks };

declare global {
  interface HTMLElementTagNameMap {
    "px-tasks": Tasks;
  }
}
