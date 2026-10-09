/**
 * <px-react> · Pixel reactions
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/react
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-react.tsx.
 */
import {
  PxBase,
  bitmap,
  clamp,
  css,
  define,
  fmtInt,
  mix,
  pixelBurst,
  rand,
  reduced,
  rollText,
  type RGB,
} from "@/lib/lumesec/pixel";

/** A reaction offered by `<px-react>`. */
export type ReactionName = "Love" | "Star" | "Zap" | "Fire" | "Spark";

/** Events fired by `<px-react>`. */
export interface ReactionsEventMap {
  /** Fires on like, unlike and when a reaction is picked. */
  react: CustomEvent<{ liked: boolean; reaction: ReactionName }>;
}

/** Colour of a reaction icon. */
type ReactionTone = "love" | "warn" | "accent" | "fire" | "spark";

/** A lit cell of a reaction icon; `edge` cells form the outline shown while not liked. */
interface IconCell {
  x: number;
  y: number;
  edge: boolean;
}

interface Reaction {
  name: ReactionName;
  tone: ReactionTone;
  cells: IconCell[];
}

/** Lit cells of a 9×8 bitmap, each marked as outline when a neighbour is off. */
function iconCells(rows: readonly string[]): IconCell[] {
  const pts = bitmap(rows);
  const lit = new Set(pts.map(([x, y]) => `${x},${y}`));
  const has = (x: number, y: number): boolean => lit.has(`${x},${y}`);
  return pts.map(([x, y]) => ({
    x,
    y,
    edge: !(has(x - 1, y) && has(x + 1, y) && has(x, y - 1) && has(x, y + 1)),
  }));
}

/** The five reactions, in palette order. */
const REACTIONS: readonly Reaction[] = [
  {
    name: "Love",
    tone: "love",
    cells: iconCells([
      ".##...##.",
      "####.####",
      "#########",
      "#########",
      ".#######.",
      "..#####..",
      "...###...",
      "....#....",
    ]),
  },
  {
    name: "Star",
    tone: "warn",
    cells: iconCells([
      "....#....",
      "...###...",
      "#########",
      ".#######.",
      "..#####..",
      "..##.##..",
      ".##...##.",
      ".#.....#.",
    ]),
  },
  {
    name: "Zap",
    tone: "accent",
    cells: iconCells([
      ".....###.",
      "....###..",
      "...###...",
      "..#######",
      ".#######.",
      "...###...",
      "..###....",
      ".###.....",
    ]),
  },
  {
    name: "Fire",
    tone: "fire",
    cells: iconCells([
      "....#....",
      "...##....",
      "...###.#.",
      "..#####..",
      ".#######.",
      ".###.###.",
      ".##...##.",
      "..#####..",
    ]),
  },
  {
    name: "Spark",
    tone: "spark",
    cells: iconCells([
      "....#....",
      "....#....",
      "...###...",
      "#########",
      "...###...",
      "....#....",
      "....#....",
      ".........",
    ]),
  },
];

/** Number of pixels in the swarm; icons with fewer cells leave the rest hidden. */
const SWARM = 64;
/** Canvas centre in px. */
const MID = 37;
/** Icon cell pitch on the button in px. */
const PITCH = 7;
/** Hold time in ms that opens the palette. */
const LONG_PRESS = 430;

/** A pixel of the swarm. */
interface SwarmPixel {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Opacity. */
  a: number;
  /** Time the pixel starts springing home; it drifts until then after a burst. */
  d: number;
  /** Home position. */
  tx: number;
  ty: number;
  edge: boolean;
  /** Whether the pixel belongs to the icon; extra pixels fade out. */
  real: boolean;
  /** Time the pixel may start fading out; lower rows fade later. */
  fd: number;
}

/** Pixel like button whose heart explodes and snaps back filled; press and hold opens more reactions. */
class Reactions extends PxBase {
  static readonly observedAttributes = ["count"] as const;

  /** Index of the current reaction. */
  private current = 0;
  private liked = false;
  private count = 128;
  private readonly pixels: SwarmPixel[] = [];
  private longPress: ReturnType<typeof setTimeout> | undefined;
  /** Set when a long press opened the palette, so the click that follows does not toggle. */
  private longFired = false;
  private readonly paletteButtons: HTMLButtonElement[] = [];
  private readonly paletteCanvases: HTMLCanvasElement[] = [];
  /**
   * True during the task of a press inside the component. Some browsers (Safari) do not focus a pressed button, so
   * focus can leave the heart while the press is about to pick a reaction; that must not close the palette.
   */
  private pressedInside = false;

  constructor() {
    super(
      `
      :host { display: block; }
      .wrap { position: relative; display: flex; align-items: center; justify-content: center; gap: 14px; }
      .heart { position: relative; width: 76px; height: 76px; border-radius: 20px; border: 1px solid var(--_border); background: var(--_surface); padding: 0; cursor: pointer; touch-action: manipulation; transition: transform .15s cubic-bezier(.2,.8,.2,1); }
      .heart:active { transform: scale(.94); }
      canvas.px { width: 74px; height: 74px; }
      .side { display: grid; gap: 2px; }
      .count { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .hint { font-size: 12px; color: var(--_muted); }
      .palette {
        position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translateX(-50%); display: flex; gap: 2px; padding: 5px;
        border-radius: 13px; background: var(--_surface); border: 1px solid var(--_border); box-shadow: 0 12px 30px -12px rgba(0,0,0,.45); z-index: 8;
      }
      .palette button { width: 40px; height: 40px; border: 0; border-radius: 9px; background: none; cursor: pointer; display: grid; place-items: center; padding: 0; transition: transform .15s cubic-bezier(.2,1.4,.4,1), background-color .15s; }
      .palette button:hover, .palette button:focus-visible { transform: scale(1.2) translateY(-3px); background: var(--_raised); }
      .palette canvas { width: 27px; height: 24px; }
      `,
      `<div class="wrap"><button class="heart" type="button" aria-pressed="false" aria-haspopup="menu" aria-expanded="false" aria-label="Like. Press and hold for more reactions"><canvas class="px"></canvas><span class="fxl"></span></button>
        <div class="side"><span class="rollslot count"></span><span class="hint">Click, or press and hold</span></div>
        <div class="palette" role="menu" aria-label="Reactions" hidden></div></div>`,
    );
    const button = this.$(".heart");
    button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.longFired = false;
      clearTimeout(this.longPress);
      this.longPress = setTimeout(() => {
        this.longFired = true;
        this.openPalette(false);
      }, LONG_PRESS);
    });
    const cancel = (): void => clearTimeout(this.longPress);
    button.addEventListener("pointerup", cancel);
    button.addEventListener("pointerleave", cancel);
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("click", () => {
      if (this.longFired) {
        this.longFired = false;
        return;
      }
      this.toggle();
    });
    button.addEventListener("contextmenu", (e) => e.preventDefault());
    button.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.openPalette(true);
      }
    });
    // focus leaving the component (Tab, a click elsewhere on the page) closes the palette
    this.$(".wrap").addEventListener("focusout", (e) => {
      if (this.pressedInside) return;
      const next = e.relatedTarget;
      if (!(next instanceof Node) || !this.$(".wrap").contains(next)) this.closePalette();
    });
    // pressing anywhere else in the component closes the palette
    this.root.addEventListener("pointerdown", (e) => {
      this.pressedInside = true;
      setTimeout(() => {
        this.pressedInside = false;
      });
      if (this.$(".palette").hidden) return;
      const inside = e
        .composedPath()
        .some(
          (node) => node instanceof Element && (node.classList.contains("palette") || node.classList.contains("heart")),
        );
      if (!inside) this.closePalette();
    });
  }

  protected override init(): void {
    for (let k = 0; k < SWARM; k++) {
      this.pixels.push({ x: MID, y: MID, vx: 0, vy: 0, a: 0, d: 0, tx: MID, ty: MID, edge: false, real: false, fd: 0 });
    }
    this.count = this.countAttribute();
    rollText(this.$(".count"), fmtInt(this.count), 1, false);
    this.retarget(true, false);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.longPress);
    this.closePalette();
  }

  attributeChangedCallback(): void {
    // before the first connect, init() reads the attribute
    if (!this.initialized) return;
    const count = this.countAttribute();
    if (count === this.count) return;
    rollText(this.$(".count"), fmtInt(count), count > this.count ? 1 : -1);
    this.count = count;
  }

  /** The `count` attribute as a whole number of at least 0; 128 when it is missing or invalid. */
  private countAttribute(): number {
    return Math.max(0, Math.round(this.num("count", 128)));
  }

  private colorOf(tone: ReactionTone): RGB {
    const P = this.P;
    switch (tone) {
      case "love":
        return mix(P.danger, P.shine, 0.08);
      case "warn":
        return P.warn;
      case "accent":
        return P.accent;
      case "fire":
        return mix(P.warn, P.danger, 0.55);
      case "spark":
        return mix(P.accent, P.shine, 0.45);
    }
  }

  /** Point every swarm pixel at its cell of the current icon; a burst throws them outward first. */
  private retarget(snap: boolean, burst: boolean): void {
    const cells = REACTIONS[this.current].cells;
    this.pixels.forEach((p, k) => {
      const cell = cells[k % cells.length];
      const homeX = MID - 4.5 * PITCH + cell.x * PITCH;
      const homeY = MID - 4 * PITCH + cell.y * PITCH + 1;
      p.tx = homeX;
      p.ty = homeY;
      p.edge = cell.edge;
      p.real = k < cells.length;
      if (snap) {
        p.x = homeX;
        p.y = homeY;
      }
      if (burst && !reduced()) {
        const angle = Math.atan2(p.y - MID, p.x - MID) + rand(-0.6, 0.6);
        const speed = rand(120, 280);
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.d = this.t + 0.12;
      } else {
        p.d = 0;
      }
      p.fd = this.t + ((homeY - 9) / 7) * 0.04;
    });
    this.kick();
  }

  /** Likes or unlikes with the current reaction and adjusts the count by one. */
  toggle(): void {
    this.liked = !this.liked;
    this.count += this.liked ? 1 : -1;
    rollText(this.$(".count"), fmtInt(this.count), this.liked ? 1 : -1);
    this.$(".heart").setAttribute("aria-pressed", String(this.liked));
    this.retarget(false, this.liked);
    if (this.liked) {
      pixelBurst(this, this.$(".fxl"), this.$(".heart"), {
        count: 26,
        colors: ["--_danger", "--_shine", "--_accent"],
        speed: [70, 200],
        jitter: 22,
      });
    }
    this.emit<{ liked: boolean; reaction: ReactionName }>("react", {
      liked: this.liked,
      reaction: REACTIONS[this.current].name,
    });
  }

  /** Build the palette buttons on first use. */
  private buildPalette(palette: HTMLElement): void {
    REACTIONS.forEach((reaction, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", reaction.name);
      const canvas = document.createElement("canvas");
      button.appendChild(canvas);
      button.addEventListener("click", () => this.pick(i));
      button.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (d) {
          e.preventDefault();
          this.paletteButtons[(i + d + REACTIONS.length) % REACTIONS.length].focus();
        }
        if (e.key === "Escape") {
          this.closePalette();
          this.$(".heart").focus();
        }
      });
      palette.appendChild(button);
      this.paletteButtons.push(button);
      this.paletteCanvases.push(canvas);
    });
  }

  /** Open the reaction palette, painting the icons in the current theme; `focus` moves focus to the current one. */
  private openPalette(focus: boolean): void {
    const palette = this.$(".palette");
    if (!this.paletteButtons.length) this.buildPalette(palette);
    const dpr = Math.min(devicePixelRatio || 1, 3);
    this.paletteCanvases.forEach((canvas, i) => {
      canvas.width = 27 * dpr;
      canvas.height = 24 * dpr;
      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, 27, 24);
      g.fillStyle = css(this.colorOf(REACTIONS[i].tone));
      for (const cell of REACTIONS[i].cells) g.fillRect(cell.x * 3, cell.y * 3, 2.5, 2.5);
    });
    palette.hidden = false;
    this.$(".heart").setAttribute("aria-expanded", "true");
    if (!reduced()) {
      palette.animate(
        [
          { opacity: 0, transform: "translateX(-50%) translateY(6px) scale(.9)" },
          { opacity: 1, transform: "translateX(-50%) translateY(0) scale(1)" },
        ],
        { duration: 220, easing: "cubic-bezier(.2,1.3,.4,1)" },
      );
    }
    if (focus) this.paletteButtons[this.current].focus();
  }

  private closePalette(): void {
    this.$(".palette").hidden = true;
    this.$(".heart").setAttribute("aria-expanded", "false");
  }

  /**
   * Selects reaction 0 to 4 (`Love`, `Star`, `Zap`, `Fire`, `Spark`), marks it liked and moves focus to the button.
   * Other values are ignored.
   */
  pick(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= REACTIONS.length) return;
    this.closePalette();
    const wasLiked = this.liked;
    this.current = index;
    this.liked = true;
    if (!wasLiked) {
      this.count++;
      rollText(this.$(".count"), fmtInt(this.count), 1);
    }
    const button = this.$(".heart");
    button.setAttribute("aria-pressed", "true");
    button.setAttribute("aria-label", `${REACTIONS[index].name}. Press and hold for more reactions`);
    this.retarget(false, true);
    pixelBurst(this, this.$(".fxl"), button, {
      count: 22,
      colors: ["--_accent", "--_shine", "--_warn"],
      speed: [60, 190],
      jitter: 22,
    });
    button.focus();
    this.emit<{ liked: boolean; reaction: ReactionName }>("react", { liked: true, reaction: REACTIONS[index].name });
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const color = this.colorOf(REACTIONS[this.current].tone);
    const still = reduced();
    let busy = false;
    this.clear();
    for (const p of this.pixels) {
      if (t >= p.d) {
        if (still) {
          p.x = p.tx;
          p.y = p.ty;
          p.vx = 0;
          p.vy = 0;
        } else {
          const stiffness = 260;
          const damping = 2 * Math.sqrt(stiffness) * 0.6;
          p.vx += (stiffness * (p.tx - p.x) - damping * p.vx) * dt;
          p.vy += (stiffness * (p.ty - p.y) - damping * p.vy) * dt;
        }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // after a burst the pixels drift and slow down before springing home
      if (t < p.d) {
        p.vx *= Math.exp(-dt * 6);
        p.vy *= Math.exp(-dt * 6);
      }
      // liked: the filled icon; not liked: only the outline
      const want = !p.real ? 0 : this.liked ? 1 : p.edge ? 0.5 : 0;
      if (t >= p.fd || want > p.a) p.a += clamp(want - p.a, -dt * 5, dt * 6);
      const moving = Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.3 || Math.abs(p.vx) > 1;
      if (moving || Math.abs(want - p.a) > 0.01) busy = true;
      if (p.a > 0.01) this.dot(p.x - 3, p.y - 3, this.liked ? color : P.muted, p.a, 6);
    }
    return busy;
  }
}

define("px-react", Reactions);

export { Reactions };

declare global {
  interface HTMLElementTagNameMap {
    "px-react": Reactions;
  }
}
