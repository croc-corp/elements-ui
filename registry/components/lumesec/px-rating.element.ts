/**
 * <px-rating> · Pixel stars
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/rating
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-rating.tsx.
 */
import { PxBase, Sparks, bitmap, clamp, define, mix, reduced, rollText } from "@/lib/lumesec/pixel";

/** Events fired by `<px-rating>`. */
export interface RatingEventMap {
  /** Fires when a rating from 1 to 5 is picked by pointer, keyboard or `pick()`; not when `value` is set. */
  change: CustomEvent<{ value: number }>;
}

const STAR = bitmap([
  "....#....",
  "...###...",
  "#########",
  ".#######.",
  "..#####..",
  "..##.##..",
  ".##...##.",
  ".#.....#.",
]);

const RATE_WORDS = ["Terrible", "Not great", "Okay", "Good", "Loved it"] as const;

/** Horizontal distance between stars in px. */
const STAR_PITCH = 48;

/** Five pixel stars that fill like liquid as you hover; picking one pops it with sparks and rolls the label. */
class Rating extends PxBase {
  /** Current rating from 1 to 5, or 0 before one is picked. */
  private rating = 0;
  /** Star under the pointer (1 to 5), or null. */
  private hover: number | null = null;
  /** Animated fill level in stars. */
  private fill = 0;
  /** Pop amount per star, 1 when picked, easing to 0. */
  private readonly pop = [0, 0, 0, 0, 0];
  private readonly sparks = new Sparks();
  /** Rating shown by the label, for the roll direction. */
  private lastShown = 0;
  private readonly canvas = this.$("canvas");

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: grid; justify-items: center; gap: 10px; }
      canvas.px { width: 236px; height: 52px; cursor: pointer; border-radius: 8px; }
      .lab { font-size: 14px; font-weight: 500; }
      .lab .rollslot { justify-items: center; }
      .q { font-size: 12.5px; color: var(--_muted); }
      `,
      `<div class="wrap"><span class="q">How was this answer?</span><canvas class="px" tabindex="0" role="slider" aria-label="Rating" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0"></canvas><span class="lab"><span class="rollslot l"></span></span></div>`,
    );
    const canvas = this.canvas;
    canvas.addEventListener("pointermove", (e) => {
      this.hover = this.indexAt(e);
      this.label();
      this.kick();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.label();
      this.kick();
    });
    canvas.addEventListener("click", (e) => this.pick(this.indexAt(e)));
    canvas.addEventListener("keydown", (e) => {
      let v = this.rating;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") v++;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") v--;
      else if (e.key === "Home") v = 1;
      else if (e.key === "End") v = 5;
      else if (/^[1-5]$/.test(e.key)) v = Number(e.key);
      else return;
      e.preventDefault();
      v = clamp(v, 1, 5);
      // a key that leaves the rating as it is (ArrowRight at five stars) picks nothing
      if (v !== this.rating) this.pick(v);
    });
  }

  /** Current rating from 1 to 5, or 0 before one is picked. Setting it updates the stars without firing `change`. */
  get value(): number {
    return this.rating;
  }

  set value(value: number) {
    const v = Math.round(value);
    if (v >= 0 && v <= 5) this.apply(v);
  }

  protected override init(): void {
    rollText(this.$(".l"), "Tap a star", 1, false);
  }

  /** The star (1 to 5) under the pointer. */
  private indexAt(e: MouseEvent): number {
    const r = this.canvas.getBoundingClientRect();
    return clamp(Math.floor((e.clientX - r.left + 5) / STAR_PITCH) + 1, 1, 5);
  }

  private label(): void {
    const v = this.hover ?? this.rating;
    rollText(this.$(".l"), v ? RATE_WORDS[v - 1] : "Tap a star", v >= this.lastShown ? 1 : -1);
    this.lastShown = v;
  }

  /**
   * Sets the rating to 1 to 5 (rounded), pops the star, updates the label and ARIA values and fires `change`.
   * Other values are ignored.
   */
  pick(value: number): void {
    const v = Math.round(value);
    if (!(v >= 1 && v <= 5)) return;
    this.apply(v);
    this.pop[v - 1] = 1;
    const P = this.P;
    const cx = (v - 1) * STAR_PITCH + 18 + 4;
    const cy = 26;
    this.sparks.add(cx, cy, 10 + v * 5, [P.warn, P.shine, P.accent], { speed: [40, 150] });
    this.emit<{ value: number }>("change", { value: v });
  }

  /** Show rating `v` (0 to 5) in the stars, the label and the slider values. */
  private apply(v: number): void {
    this.rating = v;
    this.canvas.setAttribute("aria-valuenow", String(v));
    if (v) this.canvas.setAttribute("aria-valuetext", `${v} of 5, ${RATE_WORDS[v - 1]}`);
    else this.canvas.removeAttribute("aria-valuetext");
    this.label();
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const still = reduced();
    const target = this.hover ?? this.rating;
    const ps = 4;
    const d = target - this.fill;
    this.fill = still ? target : this.fill + clamp(d, -dt * 9, dt * 9);
    this.clear();
    let busy = Math.abs(d) > 0.001;
    const previewing = this.hover !== null && this.hover !== this.rating;
    for (let i = 0; i < 5; i++) {
      const amount = clamp(this.fill - i, 0, 1);
      const x0 = i * STAR_PITCH + 4;
      const y0 = 10;
      this.pop[i] = Math.max(0, this.pop[i] - dt * 2.4);
      if (this.pop[i] > 0) busy = true;
      const scale = 1 + Math.sin(this.pop[i] * Math.PI) * 0.35;
      const cx = x0 + 18;
      const cy = y0 + 16;
      for (const [x, y] of STAR) {
        // the fill edge ripples like liquid while it moves
        const wave = busy && !still ? Math.sin(t * 12 + y * 0.9) * 0.06 : 0;
        const lit = (x + 0.5) / 9 < amount + wave;
        const front = lit && (x + 0.5) / 9 > amount - 0.2 && amount < 1;
        const px = cx + (x * ps - 18 + 0.5) * scale;
        const py = cy + (y * ps - 16 + 0.5) * scale;
        const color = lit ? (previewing ? mix(P.warn, P.fg, 0.15) : P.warn) : P.fg;
        this.dot(px, py, front ? mix(color, P.shine, 0.5) : color, lit ? 1 : 0.14, ps * 0.85 * scale);
      }
    }
    const sparking = this.sparks.step(ctx, dt);
    return busy || sparking;
  }
}

define("px-rating", Rating);

export { Rating };

declare global {
  interface HTMLElementTagNameMap {
    "px-rating": Rating;
  }
}
