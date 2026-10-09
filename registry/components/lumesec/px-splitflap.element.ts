/**
 * <px-splitflap> · Split-flap board
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/splitflap
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-splitflap.tsx.
 */
import { PxBase, clamp, css, define, mix, reduced, rrect, type RGB } from "@/lib/lumesec/pixel";

/** Characters on each flap, in flip order; anything else shows as a blank tile. */
const FLAPS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.:-/·%+>";

/** Messages shown when the `messages` attribute is missing. */
const DEFAULT_MESSAGES = "LARGE · ULTRACODE|CONTEXT 64% · OK|4 AGENTS RUNNING|DEPLOY 14:02 LIVE|SPEED 182 TOK/S";

/** Number of tiles on the board. */
const TILES = 18;
/** Seconds per flap. */
const FLAP_TIME = 0.042;
/** Seconds between automatic messages. */
const AUTO_INTERVAL = 5600;
/** Opacity of the characters on a tile. */
const INK = 0.92;

/** Half of a tile, above or below the hinge. */
type Half = "top" | "bottom";

/** One tile of the board. */
interface FlapTile {
  /** Character currently showing. */
  cur: string;
  /** Index of `cur` in {@link FLAPS}. */
  idx: number;
  /** Character the tile flips towards. */
  target: string;
  /** Time in seconds at which the tile starts flipping; tiles cascade left to right. */
  start: number;
  /** Progress of the running flap in `[0, 1)`, or -1 when the tile is at rest. */
  p: number;
  /** Index of the character the running flap reveals. */
  nextIdx: number;
}

/** Split-flap departure board whose tiles flip through the alphabet in a monospace font. */
class SplitFlap extends PxBase {
  static readonly observedAttributes = ["messages"] as const;

  private readonly tiles: FlapTile[] = [];
  /** Index of the current message. */
  private messageIndex = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Tile scale unit; 0 until the first layout. */
  private ps = 0;
  private tileW = 0;
  private tileH = 0;
  private gap = 0;
  /** Canvas font of the characters, set on layout. */
  private font = "";
  /** Baseline offset from the hinge that centres a capital on the tile; measured each frame. */
  private baseline = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      canvas.px { height: 60px; cursor: pointer; }
      .bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
      .hint { font-size: 12px; color: var(--_muted); }
      `,
      `<canvas class="px" role="img"></canvas><div class="bar"><span class="hint">Updates every few seconds</span><button class="pbtn next" type="button">Next message</button></div>`,
    );
    this.$(".next").addEventListener("click", () => this.next());
    this.$("canvas").addEventListener("click", () => this.next());
  }

  /** The `messages` attribute split on `|` without empty entries, or the default list. */
  get messages(): string[] {
    const list = (this.getAttribute("messages") ?? "").split("|").filter((message) => message.trim());
    return list.length ? list : DEFAULT_MESSAGES.split("|");
  }

  set messages(list: string[]) {
    this.setAttribute("messages", list.join("|"));
  }

  attributeChangedCallback(): void {
    // before the first connect, init() shows the first message; later the board starts over with the new list
    if (!this.initialized) return;
    this.messageIndex = 0;
    this.show(this.messages[0]);
    this.restartTimer();
  }

  protected override init(): void {
    for (let i = 0; i < TILES; i++) this.tiles.push({ cur: " ", idx: 0, target: " ", start: 0, p: -1, nextIdx: 0 });
    this.show(this.messages[0]);
  }

  /** Starts the auto-advance timer. */
  override connectedCallback(): void {
    super.connectedCallback();
    this.restartTimer();
  }

  /** Stops the auto-advance timer. */
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.timer);
  }

  /** Advance every 5.6 seconds while on screen, and hold while the pointer or focus is on the board. */
  private restartTimer(): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.onScreen && !document.hidden && !this.matches(":hover, :focus-within")) this.next();
    }, AUTO_INTERVAL);
  }

  /** Advances to the next message and restarts the auto-advance timer. */
  next(): void {
    const messages = this.messages;
    this.messageIndex = (this.messageIndex + 1) % messages.length;
    this.show(messages[this.messageIndex]);
    this.restartTimer();
  }

  /** Flips the board to an arbitrary message without changing the rotation position. */
  show(message: string): void {
    const text = [...message.toUpperCase()]
      .map((ch) => (FLAPS.includes(ch) ? ch : " "))
      .join("")
      .padEnd(TILES)
      .slice(0, TILES);
    this.$("canvas").setAttribute("aria-label", message);
    const now = performance.now() / 1000;
    this.tiles.forEach((tile, i) => {
      tile.target = text[i];
      tile.start = now + i * 0.05;
    });
    this.kick();
  }

  protected override resized(): void {
    const canvas = this.cv;
    if (!canvas) return;
    const ps = clamp((this.w - (TILES - 1) * 2) / (TILES * 7), 1.2, 3.2);
    this.ps = ps;
    this.tileW = ps * 7;
    this.tileH = ps * 10.5;
    this.gap = (this.w - this.tileW * TILES) / (TILES - 1);
    this.font = `600 ${(this.tileH * 0.6).toFixed(2)}px ${this.monoFont}`;
    // the height follows the width so the tiles keep their proportions
    const height = Math.round(this.tileH + 4);
    if (Math.abs(canvas.clientHeight - height) > 1) canvas.style.height = `${height}px`;
  }

  /**
   * Draw the `half` of `ch` above or below the hinge of the tile at `x`, folded towards the hinge by `scale`
   * (1 is flat on the tile, 0 is edge-on).
   */
  private drawHalf(g: CanvasRenderingContext2D, ch: string, half: Half, x: number, scale: number, color: RGB): void {
    const y = 2;
    const w = this.tileW;
    const h = this.tileH;
    const hinge = y + h / 2;
    g.save();
    g.translate(0, hinge);
    g.scale(1, Math.max(0.001, scale));
    g.translate(0, -hinge);
    g.beginPath();
    if (half === "top") g.rect(x, y, w, hinge - y);
    else g.rect(x, hinge, w, y + h - hinge);
    g.clip();
    g.globalAlpha = INK;
    g.fillStyle = css(color);
    g.fillText(ch, x + w / 2, hinge + this.baseline);
    g.restore();
  }

  /** Draw tile `i`: the next character's top half and the current bottom half, with the moving flap on top. */
  private drawTile(g: CanvasRenderingContext2D, tile: FlapTile, i: number): void {
    const P = this.P;
    const ps = this.ps;
    const w = this.tileW;
    const h = this.tileH;
    const x = i * (w + this.gap);
    const y = 2;
    const face = mix(P.track, P.fg, 0.05);
    const faceTop = mix(P.track, P.fg, 0.1);
    const colorOf = (ch: string): RGB => (/[0-9]/.test(ch) ? P.accent : P.fg);
    g.globalAlpha = 1;
    g.save();
    rrect(g, x, y, w, h, ps * 1.1);
    g.clip();
    g.fillStyle = css(face);
    g.fillRect(x, y, w, h);
    g.fillStyle = css(faceTop);
    g.fillRect(x, y, w, h / 2);
    const hinge = y + h / 2;
    if (tile.p < 0) {
      this.drawHalf(g, tile.cur, "top", x, 1, colorOf(tile.cur));
      this.drawHalf(g, tile.cur, "bottom", x, 1, colorOf(tile.cur));
    } else {
      const next = FLAPS[tile.nextIdx];
      const p = tile.p;
      this.drawHalf(g, next, "top", x, 1, colorOf(next));
      this.drawHalf(g, tile.cur, "bottom", x, 1, colorOf(tile.cur));
      if (p < 0.5) {
        // the top flap falls towards the hinge, darkening as it tilts
        const scale = 1 - 2 * p;
        g.globalAlpha = 1;
        g.fillStyle = css(mix(faceTop, P.fg, p * 0.3));
        g.fillRect(x, hinge - (hinge - y) * scale, w, (hinge - y) * scale);
        this.drawHalf(g, tile.cur, "top", x, scale, colorOf(tile.cur));
      } else {
        // then opens downwards with the next character's lower half
        const scale = 2 * p - 1;
        g.globalAlpha = 1;
        g.fillStyle = css(mix(face, P.fg, (1 - p) * 0.3));
        g.fillRect(x, hinge, w, (y + h - hinge) * scale);
        this.drawHalf(g, next, "bottom", x, scale, colorOf(next));
      }
    }
    g.globalAlpha = 0.55;
    g.fillStyle = css(P.track);
    g.fillRect(x, hinge - 0.5, w, 1);
    g.restore();
  }

  /** Advance a tile's flap by `dt` seconds. */
  private step(tile: FlapTile, now: number, dt: number): void {
    if (reduced()) {
      tile.cur = tile.target;
      tile.idx = FLAPS.indexOf(tile.target);
      tile.p = -1;
      return;
    }
    if (now < tile.start) return;
    if (tile.p < 0) {
      tile.p = 0;
      tile.nextIdx = (tile.idx + 1) % FLAPS.length;
    }
    tile.p += dt / FLAP_TIME;
    if (tile.p >= 1) {
      tile.idx = tile.nextIdx;
      tile.cur = FLAPS[tile.idx];
      if (tile.cur === tile.target) {
        tile.p = -1;
      } else {
        tile.p = 0;
        tile.nextIdx = (tile.idx + 1) % FLAPS.length;
      }
    }
  }

  protected override render(_t: number, dt: number): boolean {
    const g = this.ctx;
    if (!this.ps || !g) return false;
    const now = performance.now() / 1000;
    let busy = false;
    this.clear();
    g.font = this.font;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    this.baseline = g.measureText("H").actualBoundingBoxAscent / 2;
    this.tiles.forEach((tile, i) => {
      if (tile.cur !== tile.target) {
        busy = true;
        this.step(tile, now, dt);
      }
      this.drawTile(g, tile, i);
    });
    return busy;
  }
}

define("px-splitflap", SplitFlap);

export { SplitFlap };

declare global {
  interface HTMLElementTagNameMap {
    "px-splitflap": SplitFlap;
  }
}
