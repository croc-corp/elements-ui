/**
 * <px-dissolve> · Dissolve to delete
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/dissolve
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-dissolve.tsx.
 *
 * Demo data: The five chats are invented; nothing can be set. It cannot show your own data yet; use it as a
 * template and replace the invented data before it shows anything real.
 */
import { PxBase, css, define, mix, now, rand, reduced, rollText, type RGB } from "@/lib/lumesec/pixel";

/** Events fired by `<px-dissolve>`. */
export interface DissolveEventMap {
  /** Fires when a row's delete button is pressed, with the chat title. */
  delete: CustomEvent<{ title: string }>;
}

/** Built-in demo chats: title and age. */
const CHATS: readonly (readonly [title: string, time: string])[] = [
  ["Pixel trail for the effort slider", "2m"],
  ["Quarterly board deck outline", "1h"],
  ["Refactor the auth middleware", "3h"],
  ["Trip plan: Lisbon in May", "Yesterday"],
  ["Explain DORA in plain words", "Mon"],
];

/** Trash icon, 16×16 stroke SVG. */
const TRASH =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M6 4V2.6h4V4M3.8 4l.7 9.2c.1.8.7 1.3 1.5 1.3h4c.8 0 1.4-.5 1.5-1.3L12.2 4"/></svg>';

/** A pixel sampled from a deleted row's text, drifting away. */
interface Mote {
  x: number;
  y: number;
  /** Colour sampled from the text. */
  c: RGB;
  vx: number;
  vy: number;
  /** Time the mote starts moving; the row dissolves left to right. */
  d: number;
  age: number;
  /** Lifetime in seconds. */
  max: number;
  /** Phase seed of the drift. */
  s: number;
}

/** The parts of a chat row. */
interface ChatRow {
  li: HTMLLIElement;
  item: HTMLDivElement;
  titleEl: HTMLSpanElement;
  timeEl: HTMLSpanElement;
}

/** Chat list where deleting a row turns it into pixels sampled from its own text. */
class Dissolve extends PxBase {
  private motes: Mote[] = [];

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { position: relative; }
      canvas.px { position: absolute; left: -24px; top: -24px; width: calc(100% + 48px); height: calc(100% + 48px); pointer-events: none; z-index: 3; }
      ul { list-style: none; margin: 0; padding: 0; }
      li { overflow: hidden; transition: height .36s cubic-bezier(.3,.7,.2,1), opacity .22s; }
      .item { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 6px 0 10px; border-radius: 9px; font-size: 13.5px; }
      .item:hover, .item:focus-within { background: color-mix(in srgb, var(--_fg) 5%, transparent); }
      .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
      .time { font-family: var(--_mono); font-size: 11.5px; color: var(--_muted); white-space: nowrap; }
      .del { width: 28px; height: 28px; border: 0; background: none; border-radius: 7px; color: var(--_muted); cursor: pointer; display: grid; place-items: center; padding: 0; opacity: 0; flex: none; }
      .item:hover .del, .del:focus-visible { opacity: 1; }
      .del:hover { color: var(--_danger); background: color-mix(in srgb, var(--_danger) 12%, transparent); }
      .del svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
      .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 12px; color: var(--_muted); }
      @media (hover: none) { .del { opacity: 1; } }
      `,
      `<div class="wrap"><ul aria-label="Recent chats"></ul><canvas class="px" aria-hidden="true"></canvas></div><div class="foot"><span class="rollslot cnt" aria-live="polite"></span><button class="pbtn restore" type="button">Restore all</button></div>`,
    );
    this.$(".restore").addEventListener("click", () => this.restore());
  }

  protected override init(): void {
    const list = this.$("ul");
    CHATS.forEach((_, i) => list.appendChild(this.createRow(i)));
    this.updateCount(false, 1);
  }

  /** The list item for chat `i`. */
  private createRow(i: number): HTMLLIElement {
    const [title, time] = CHATS[i];
    const li = document.createElement("li");
    li.dataset.i = String(i);
    const item = document.createElement("div");
    item.className = "item";
    const titleEl = document.createElement("span");
    titleEl.className = "t";
    titleEl.textContent = title;
    const timeEl = document.createElement("span");
    timeEl.className = "time";
    timeEl.textContent = time;
    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.innerHTML = TRASH;
    del.setAttribute("aria-label", `Delete “${title}”`);
    item.append(titleEl, timeEl, del);
    li.appendChild(item);
    del.addEventListener("click", () => this.dissolve({ li, item, titleEl, timeEl }, title, time));
    return li;
  }

  /** Rows still in the list, including rows that are dissolving. */
  private listItems(): HTMLLIElement[] {
    return [...this.$("ul").querySelectorAll("li")];
  }

  private updateCount(animate: boolean, dir: number): void {
    const n = this.$("ul").querySelectorAll("li:not([data-gone])").length;
    rollText(this.$(".cnt"), n ? `${n} chat${n > 1 ? "s" : ""}` : "No chats left", dir, animate);
  }

  /** Draw the row's text on a scratch canvas and turn its lit pixels into motes. */
  private sample(row: ChatRow, title: string, time: string, ox: number, oy: number, rowRect: DOMRect): void {
    const P = this.P;
    const W = Math.max(1, Math.ceil(rowRect.width));
    const H = Math.max(1, Math.ceil(rowRect.height));
    const scratch = document.createElement("canvas");
    scratch.width = W;
    scratch.height = H;
    const c = scratch.getContext("2d", { willReadFrequently: true });
    if (!c) return;
    const titleRect = row.titleEl.getBoundingClientRect();
    const timeRect = row.timeEl.getBoundingClientRect();
    c.textBaseline = "middle";
    // the title is clipped where its ellipsis would start
    c.save();
    c.beginPath();
    c.rect(0, 0, titleRect.right - rowRect.left, H);
    c.clip();
    c.font = `500 13.5px ${getComputedStyle(row.titleEl).fontFamily}`;
    c.fillStyle = css(P.fg);
    c.fillText(title, titleRect.left - rowRect.left, H / 2);
    c.restore();
    c.font = `11.5px ${this.monoFont}`;
    c.fillStyle = css(P.muted);
    c.fillText(time, timeRect.left - rowRect.left, H / 2);
    const data = c.getImageData(0, 0, W, H).data;
    const start = now();
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const i = (y * W + x) * 4;
        if (data[i + 3] <= 90) continue;
        this.motes.push({
          x: ox + x,
          y: oy + y,
          c: [data[i], data[i + 1], data[i + 2]],
          vx: 0,
          vy: 0,
          d: start + rand(0, 0.25) + (x / W) * 0.45,
          age: 0,
          max: rand(0.6, 1.15),
          s: Math.random() * 10,
        });
      }
    }
  }

  /** Delete a row: its text dissolves into motes, then the gap closes. */
  private dissolve(row: ChatRow, title: string, time: string): void {
    const { li, item } = row;
    const canvas = this.cv;
    if (li.dataset.gone || !canvas) return;
    li.dataset.gone = "1";
    // the row is about to hide: hand keyboard focus to the next row, the previous one or Restore all
    if (li.contains(this.root.activeElement)) this.focusAfterDelete(li);
    const still = reduced();
    const canvasRect = canvas.getBoundingClientRect();
    const rowRect = item.getBoundingClientRect();
    if (!still) this.sample(row, title, time, rowRect.left - canvasRect.left, rowRect.top - canvasRect.top, rowRect);
    item.style.visibility = "hidden";
    setTimeout(
      () => {
        li.style.height = `${li.offsetHeight}px`;
        // read layout so the height transition starts from the measured height
        li.getBoundingClientRect();
        li.style.height = "0px";
        li.style.opacity = "0";
      },
      still ? 0 : 380,
    );
    setTimeout(
      () => {
        li.remove();
        this.updateCount(true, -1);
      },
      still ? 0 : 760,
    );
    this.emit<{ title: string }>("delete", { title });
    this.kick();
  }

  /** Move focus from a deleted row to the delete button of a neighbouring row, or to Restore all. */
  private focusAfterDelete(gone: HTMLLIElement): void {
    const rows = this.listItems().filter((li) => li === gone || !li.dataset.gone);
    const at = rows.indexOf(gone);
    const neighbour = rows[at + 1] ?? rows[at - 1];
    const target = neighbour?.querySelector<HTMLButtonElement>(".del") ?? this.$(".restore");
    target.focus();
  }

  /** Puts every deleted chat back in its original position, including rows still dissolving. */
  restore(): void {
    const list = this.$("ul");
    // a row that is still dissolving is replaced now rather than vanishing after the restore
    for (const li of this.listItems()) {
      if (li.dataset.gone) li.remove();
    }
    const present = new Set(this.listItems().map((li) => li.dataset.i));
    let added = 0;
    CHATS.forEach((_, i) => {
      if (present.has(String(i))) return;
      const li = this.createRow(i);
      const next = this.listItems().find((other) => Number(other.dataset.i) > i);
      list.insertBefore(li, next || null);
      added++;
      if (!reduced()) {
        li.style.height = "0px";
        li.style.opacity = "0";
        li.getBoundingClientRect();
        li.style.height = "40px";
        li.style.opacity = "1";
        setTimeout(() => {
          li.style.height = "";
        }, 420);
      }
    });
    if (added) this.updateCount(true, 1);
  }

  protected override render(t: number, dt: number): boolean {
    this.clear();
    const still = reduced();
    const P = this.P;
    this.motes = this.motes.filter((p) => {
      if (t < p.d) {
        this.dot(p.x, p.y, p.c, 1, 1.6);
        return true;
      }
      p.age += dt;
      if (p.age > p.max || still) return false;
      // drift right and up on a wobbling path
      p.vx += (70 + Math.sin(p.s + p.age * 6) * 60) * dt;
      p.vy += (-40 + Math.cos(p.s * 1.7 + p.age * 5) * 50) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const f = p.age / p.max;
      this.dot(p.x, p.y, mix(p.c, P.accent, Math.min(1, f * 1.5)), 1 - f, 1.6 + f);
      return true;
    });
    return this.motes.length > 0;
  }
}

define("px-dissolve", Dissolve);

export { Dissolve };

declare global {
  interface HTMLElementTagNameMap {
    "px-dissolve": Dissolve;
  }
}
