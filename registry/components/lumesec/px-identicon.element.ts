/**
 * <px-identicon> · Pixel avatar
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/identicon
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-identicon.tsx.
 */
import { PxBase, clamp, css, define, isDark, reduced, strHash, type Point } from "@/lib/lumesec/pixel";

/** Events fired by `<px-identicon>`. */
export interface IdenticonEventMap {
  /**
   * Fires on every edit of the name field and on Shuffle. `name` is the trimmed input (`?` when empty); `hash`
   * is the unsigned 32-bit hash of its lower-cased form.
   */
  change: CustomEvent<{ name: string; hash: number }>;
}

/** Names Shuffle cycles through. */
const NAMES: readonly string[] = [
  "Ada Lovelace",
  "Grace Hopper",
  "Alan Turing",
  "Katherine Johnson",
  "Edsger Dijkstra",
  "Barbara Liskov",
  "Claude Shannon",
  "Margaret Hamilton",
  "Donald Knuth",
  "Frances Allen",
];

/** Cells per side of the avatar. */
const SIZE = 7;
/** Pitch of a cell in px, and its inset from the canvas edge. */
const PITCH = 18;
const INSET = 8;

/** One cell of the 7×7 avatar. Each cell is drawn as 3×3 small squares. */
interface IdenticonCell {
  gx: number;
  gy: number;
  /** 1 when lit. */
  on: number;
  /** The state before the last change, shown during the first half of the flip. */
  prev: number;
  /** Start of the flip; cells further from the centre start later. */
  t0: number;
}

/**
 * Whether the cell at mirrored column `mc` (0–3) of row `gy` is lit. Rows of four bits come from the two
 * name hashes, so the left and right halves mirror each other.
 */
function isLit(gy: number, mc: number, h: number, h2: number): number {
  const k = gy * 4 + mc;
  const pair = (k < 16 ? h >>> (k * 2) : h2 >>> ((k - 16) * 2)) & 3;
  const bit = (k < 16 ? h >>> k : h2 >>> (k - 12)) & 1;
  return pair === 0 || bit === 1 ? 1 : 0;
}

/** Symmetric 7×7 pixel avatar generated from a typed name. */
class Identicon extends PxBase {
  private readonly cells: IdenticonCell[] = Array.from({ length: SIZE * SIZE }, (_, i) => ({
    on: 0,
    prev: 0,
    t0: -9,
    gx: i % SIZE,
    gy: Math.floor(i / SIZE),
  }));
  private hue = 260;
  private prevHue = 260;
  /** Time of the last hue change. */
  private hueAt = 0;
  /** Pointer position over the canvas; null when the pointer is outside. */
  private mouse: Point | null = null;
  /** Index of the last name Shuffle picked. */
  private nameIndex = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: flex; align-items: center; justify-content: center; gap: 22px; flex-wrap: wrap; }
      canvas.px { width: 142px; height: 142px; border-radius: 18px; background: var(--_track); cursor: crosshair; flex: none; }
      .col { display: grid; gap: 8px; width: 210px; max-width: 100%; }
      .lab { font-size: 12.5px; color: var(--_muted); }
      .in { height: 38px; border-radius: 9px; border: 1px solid var(--_border); background: var(--_surface); padding: 0 12px; font-size: 14px; width: 100%; }
      .in:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
      .row { display: flex; align-items: center; gap: 10px; }
      .hash { font-size: 11.5px; color: var(--_muted); }
      `,
      `<div class="wrap"><canvas class="px" role="img"></canvas><div class="col"><label class="lab" for="nm">Name</label><input id="nm" class="in" autocomplete="off" spellcheck="false" value="Ada Lovelace"><div class="row"><button class="pbtn shuf" type="button">Shuffle</button><span class="mono hash"></span></div></div></div>`,
    );
    const input = this.$<HTMLInputElement>(".in");
    input.addEventListener("input", (e) => {
      // the native event stays inside the shadow root; `change` reports the edit
      e.stopPropagation();
      this.generate();
    });
    this.$(".shuf").addEventListener("click", () => {
      this.nameIndex = (this.nameIndex + 1) % NAMES.length;
      input.value = NAMES[this.nameIndex];
      this.generate();
    });
    const canvas = this.$("canvas");
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse = [e.clientX - r.left, e.clientY - r.top];
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.mouse = null;
      this.kick();
    });
  }

  protected override init(): void {
    this.generate(true);
  }

  /** Rebuild the pattern from the name field; the first call skips the flip and the event. */
  private generate(first = false): void {
    const name = this.$<HTMLInputElement>(".in").value.trim() || "?";
    const h = strHash(name.toLowerCase());
    const h2 = strHash(`${name.toLowerCase()}#salt`);
    this.prevHue = this.hue;
    this.hue = h2 % 360;
    for (const cell of this.cells) {
      const mirrored = cell.gx <= 3 ? cell.gx : 6 - cell.gx;
      const on = isLit(cell.gy, mirrored, h, h2);
      if (on !== cell.on || first) {
        cell.prev = first ? on : cell.on;
        cell.on = on;
        // the flip spreads outward from the centre
        cell.t0 = first ? -9 : this.t + Math.hypot(cell.gx - 3, cell.gy - 3) * 0.035;
      }
    }
    this.$(".hash").textContent = `#${h.toString(16).padStart(8, "0").slice(0, 6)}`;
    this.$("canvas").setAttribute("aria-label", `Pixel avatar for ${name}`);
    this.hueAt = this.t;
    if (!first) this.emit<{ name: string; hash: number }>("change", { name, hash: h });
    this.kick();
  }

  protected override render(t: number): boolean {
    const g = this.ctx;
    if (!g) return false;
    const P = this.P;
    const dark = isDark(P);
    const still = reduced();
    const hueProgress = still ? 1 : clamp((t - this.hueAt) / 0.5, 0, 1);
    // shortest way round the colour wheel
    const hueDelta = ((this.hue - this.prevHue + 540) % 360) - 180;
    const hue = this.prevHue + hueDelta * hueProgress;
    this.clear();
    let busy = hueProgress < 1;
    for (const cell of this.cells) {
      const m = still ? 1 : clamp((t - cell.t0) / 0.22, 0, 1);
      if (m < 1) busy = true;
      // the cell folds flat to the old state, then opens to the new one
      const on = m < 0.5 ? cell.prev : cell.on;
      const fold = m < 0.5 ? 1 - 2 * m : 2 * m - 1;
      const cx = INSET + cell.gx * PITCH + 9;
      const cy = INSET + cell.gy * PITCH + 9;
      let lift = 0;
      if (this.mouse) {
        const d2 = (cx - this.mouse[0]) ** 2 + (cy - this.mouse[1]) ** 2;
        lift = Math.exp(-d2 / 900);
      }
      const scale = 1 + lift * 0.28;
      for (let s = 0; s < 9; s++) {
        const sx = (s % 3) - 1;
        const sy = Math.floor(s / 3) - 1;
        const x = cx + sx * 5.2 * scale - 2.1 * scale;
        const y = cy + (sy * 5.2 * scale - 2.1 * scale) * fold;
        g.globalAlpha = on ? clamp(0.85 + lift * 0.15, 0, 1) : 0.07 + lift * 0.1;
        g.fillStyle = on ? `hsl(${hue} ${dark ? 70 : 62}% ${dark ? 66 + lift * 12 : 50 - lift * 8}%)` : css(P.fg);
        g.fillRect(x, y, 4.2 * scale, 4.2 * scale * Math.max(0.08, fold));
      }
    }
    g.globalAlpha = 1;
    return busy;
  }
}

define("px-identicon", Identicon);

export { Identicon };

declare global {
  interface HTMLElementTagNameMap {
    "px-identicon": Identicon;
  }
}
