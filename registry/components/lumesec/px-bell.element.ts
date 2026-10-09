/**
 * <px-bell> · Notification bell
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/bell
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-bell.tsx.
 */
import {
  PxBase,
  Sparks,
  bitmap,
  css,
  define,
  mix,
  now,
  reduced,
  rollText,
  type Point,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<px-bell>`. */
export interface BellEventMap {
  /** Fires on each new notification with the new unread count. */
  notify: CustomEvent<{ unread: number }>;
  /** Fires when everything is marked as read, from a click on the bell or from `clearAll()`. */
  read: CustomEvent<Record<string, never>>;
}

const BELL = bitmap([
  "......#......",
  "....#####....",
  "...#######...",
  "..#########..",
  "..#########..",
  "..#########..",
  "..#########..",
  ".###########.",
  "#############",
  "#############",
]);

const CLAPPER = bitmap(["###", ".#."]);

const WHITE: RGB = [255, 255, 255];

/** How long a ring swings, in seconds. */
const RING_TIME = 3;

/**
 * Pixel notification bell that swings with a lagging clapper and pops its badge on new items; clicking it clears the
 * badge in a spray of pixels.
 */
class Bell extends PxBase {
  static readonly observedAttributes = ["count"] as const;

  /** Unread count; read from the `count` attribute on connect. */
  private unread = 0;
  /** Start of the last ring; far in the past while the bell rests. */
  private ring = -9;
  /** Badge pop, 1 on a new notification, easing to 0. */
  private badgePop = 0;
  /** Start times of the sound waves. */
  private waves: number[] = [];
  private readonly sparks = new Sparks();
  /** Monospace font stack for the badge count, read on layout. */
  private mono = "monospace";

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { display: grid; justify-items: center; gap: 10px; }
      .bell { border: 0; background: none; padding: 0; border-radius: 16px; cursor: pointer; }
      canvas.px { width: 180px; height: 116px; }
      .row { display: flex; align-items: center; gap: 10px; }
      .cnt { font-size: 13.5px; font-weight: 500; }
      `,
      `<div class="wrap"><button class="bell" type="button" aria-label="Notifications"><canvas class="px"></canvas></button><div class="row"><span class="rollslot cnt" aria-live="polite"></span><button class="pbtn ping" type="button">Notify</button></div></div>`,
    );
    this.$(".ping").addEventListener("click", () => this.notify());
    this.$(".bell").addEventListener("click", () => this.clearAll());
  }

  protected override init(): void {
    this.unread = this.countAttribute();
    this.showCount(false, 1);
  }

  attributeChangedCallback(): void {
    // before the first connect, init() reads the attribute
    if (!this.initialized) return;
    const count = this.countAttribute();
    if (count === this.unread) return;
    const dir = count > this.unread ? 1 : -1;
    this.unread = count;
    this.showCount(true, dir);
    this.kick();
  }

  /** The `count` attribute as a whole number of at least 0; 2 when it is missing or invalid. */
  private countAttribute(): number {
    return Math.max(0, Math.round(this.num("count", 2)));
  }

  /** Show the count below the bell and in the bell's label. */
  private showCount(animate: boolean, dir: number): void {
    rollText(this.$(".cnt"), this.unread ? `${this.unread} unread` : "All caught up", dir, animate);
    this.$(".bell").setAttribute(
      "aria-label",
      this.unread ? `Notifications, ${this.unread} unread. Mark all as read` : "Notifications, all caught up",
    );
  }

  /** Adds one unread notification, rings the bell and fires `notify`. */
  notify(): void {
    this.unread++;
    this.ring = now();
    this.badgePop = 1;
    const start = now();
    for (let k = 0; k < 3; k++) this.waves.push(start + k * 0.16);
    this.showCount(true, 1);
    this.emit<{ unread: number }>("notify", { unread: this.unread });
    this.kick();
  }

  /** Marks everything as read and fires `read`. Does nothing when the count is already zero. */
  clearAll(): void {
    if (!this.unread) return;
    const P = this.P;
    const [bx, by] = this.badgePos();
    this.sparks.add(bx, by, 26, [P.danger, P.shine, P.accent], { speed: [40, 170] });
    this.unread = 0;
    // a short, already-fading swing
    this.ring = now() - 0.6;
    this.showCount(true, -1);
    this.emit("read");
    this.kick();
  }

  protected override resized(): void {
    this.mono = this.monoFont;
  }

  private badgePos(): Point {
    return [this.w / 2 + 22, 18];
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const still = reduced();
    const ps = 4;
    const px0 = this.w / 2;
    const py0 = 14;
    const age = t - this.ring;
    const swinging = !still && age <= RING_TIME;
    // the clapper lags the bell by a fixed phase
    const bellAngle = swinging ? 0.5 * Math.exp(-age * 1.6) * Math.sin(age * 15) : 0;
    const clapperAngle = swinging ? 0.6 * Math.exp(-age * 1.6) * Math.sin(age * 15 - 0.9) : 0;
    this.badgePop = Math.max(0, this.badgePop - dt * 2.5);
    this.clear();

    /** `(x, y)` rotated by `a` around the hanging point. */
    const rotate = (x: number, y: number, a: number): Point => [
      px0 + x * Math.cos(a) - y * Math.sin(a),
      py0 + x * Math.sin(a) + y * Math.cos(a),
    ];
    for (const [x, y] of CLAPPER) {
      const [qx, qy] = rotate((x - 1) * ps, 44 + y * ps, clapperAngle);
      this.dot(qx - 1.7, qy - 1.7, P.fg, 0.9, ps * 0.85);
    }
    const bellColor = this.unread ? mix(P.fg, P.accent, 0.15) : P.fg;
    for (const [x, y] of BELL) {
      const [qx, qy] = rotate((x - 6) * ps, y * ps, bellAngle);
      this.dot(qx - 1.7, qy - 1.7, bellColor, 0.92, ps * 0.85);
    }

    this.waves = this.waves.filter((start) => {
      const a = t - start;
      if (a > 0.9) return false;
      if (a < 0) return true;
      const r = 34 + a * 70;
      for (const side of [0, Math.PI]) {
        for (let k = -4; k <= 4; k++) {
          const angle = side + k * 0.13;
          const x = px0 + Math.cos(angle) * r - 1.2;
          const y = py0 + 26 + Math.sin(angle) * r - 1.2;
          this.dot(x, y, P.accent, (1 - a / 0.9) * 0.9, 2.4);
        }
      }
      return true;
    });

    if (this.unread) {
      const [bx, by] = this.badgePos();
      const scale = 1 + Math.sin(this.badgePop * Math.PI) * 0.4;
      const R = 10 * scale;
      for (let y = -R; y <= R; y += 2.5) {
        for (let x = -R; x <= R; x += 2.5) {
          if (Math.hypot(x, y) <= R) this.dot(bx + x - 1.1, by + y - 1.1, P.danger, 1, 2.2);
        }
      }
      // a solid core behind the count, so the digits do not sit on the gaps between the dots
      ctx.globalAlpha = 1;
      ctx.fillStyle = css(P.danger);
      ctx.beginPath();
      ctx.arc(bx, by, R * 0.82, 0, Math.PI * 2);
      ctx.fill();
      const text = this.unread > 9 ? "9+" : String(this.unread);
      ctx.font = `600 ${(11 * scale).toFixed(2)}px ${this.mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      // centre the digits' ink, not the em box, on the badge
      const metrics = ctx.measureText(text);
      ctx.globalAlpha = 1;
      ctx.fillStyle = css(WHITE);
      ctx.fillText(text, bx, by + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
    }
    const sparking = this.sparks.step(ctx, dt);
    return age < RING_TIME || this.waves.length > 0 || sparking || this.badgePop > 0;
  }
}

define("px-bell", Bell);

export { Bell };

declare global {
  interface HTMLElementTagNameMap {
    "px-bell": Bell;
  }
}
