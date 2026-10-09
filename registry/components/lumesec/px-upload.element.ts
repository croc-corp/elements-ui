/**
 * <px-upload> · Pixel upload
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/upload
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-upload.tsx.
 *
 * Demo data: Nothing is uploaded and the progress is simulated; the file name and size come from the chosen
 * file and `limit-mb` can be set. It cannot show your own data yet; use it as a template and replace the
 * invented data before it shows anything real.
 */
import { PxBase, bitmap, clamp, define, lerp, mix, reduced, rollText, type Point } from "@/lib/lumesec/pixel";

/** Phase of the upload; the host carries `data-state` outside `idle`. */
export type UploadState = "idle" | "uploading" | "error" | "done";

/** A file passed to the upload, by name and size in bytes. */
export interface UploadFile {
  name: string;
  size: number;
}

/** Events fired by `<px-upload>`. */
export interface UploadEventMap {
  /**
   * Fires when a file is over the limit. `size` is in bytes. It does not bubble, so it never reaches the
   * window's global `error` handlers; listen on the element.
   */
  error: CustomEvent<UploadFile>;
  /** Fires when the simulated upload completes. `size` is in bytes. */
  uploaded: CustomEvent<UploadFile>;
}

/** The file icon, 10×12 cells. */
const DOC = bitmap([
  "######....",
  "#....##...",
  "#....#.#..",
  "#....####.",
  "#........#",
  "#.######.#",
  "#........#",
  "#.######.#",
  "#........#",
  "#.####...#",
  "#........#",
  "##########",
]);

/** The check the progress bar regroups into. */
const BIG_CHECK = bitmap([
  "..........##",
  ".........###",
  "........###.",
  ".......###..",
  "##....###...",
  "###..###....",
  ".#####.....",
  "..###......",
]);

const IDLE_TEXT = "Drop a file, or click to choose";

/** A pixel of the file icon. */
interface IconPixel {
  x: number;
  y: number;
  /** Whether the pixel is in place; it is off while it flies. */
  on: boolean;
}

/** Fields shared by every flying pixel. */
interface FlyerPath {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Start time and duration of the flight. */
  t0: number;
  dur: number;
}

/** A pixel in flight: icon → bar while uploading, bar → check when done, check → icon on reset. */
type Flyer = FlyerPath & ({ kind: "bar" | "check" } | { kind: "home"; k: number });

/** Positions computed for the current size. */
interface UploadLayout {
  icon: IconPixel[];
  /** Icon pixel indices in launch order: bottom-right first. */
  order: number[];
  barCells: Point[];
  check: Point[];
}

/** `48.2 MB` for a size in bytes. */
const formatMb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

/** Upload drop zone where the file icon dissolves pixel by pixel into the progress bar. */
class Upload extends PxBase {
  private phase: UploadState = "idle";
  /** Null until the first layout; files started before that are ignored. */
  private layout: UploadLayout | null = null;
  private flyers: Flyer[] = [];
  /** Whether a drag is over the zone. */
  private over = false;
  /** Upload progress from 0 to 1. */
  private progress = 0;
  private fileName = "";
  private fileSize = 0;
  /** Time the file was started. */
  private startedAt = 0;
  /** Simulated upload time in seconds. */
  private duration = 0;
  /** Icon pixels launched towards the bar, and those that arrived. */
  private launched = 0;
  private arrived = 0;
  /** Bar pixels that landed in the check. */
  private checkLanded = 0;
  /** Returns to idle after an error or a success. */
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super(
      `
      :host { display: block; }
      .zone { position: relative; height: 178px; border-radius: 14px; cursor: pointer; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .msg { position: absolute; left: 0; right: 0; bottom: 30px; display: grid; justify-items: center; gap: 3px; pointer-events: none; text-align: center; padding: 0 12px; }
      .msg .rollslot { justify-items: center; }
      .l1 { font-size: 13.5px; font-weight: 500; }
      .l2 { font-size: 12px; color: var(--_muted); font-family: var(--_mono); min-height: 1.3em; }
      :host([data-state="error"]) .l1 { color: var(--_danger); }
      :host([data-state="done"]) .l1 { color: var(--_ok); }
      .bar { display: flex; justify-content: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
      `,
      `<div class="zone" tabindex="0" role="button" aria-label="Upload a file: click or drop"><canvas class="px"></canvas><div class="msg"><span class="rollslot l1"></span><span class="l2"></span></div><input type="file" hidden></div><span class="sr" aria-live="polite"></span>
        <div class="bar"><button class="pbtn sample" type="button">Use a sample file</button><button class="pbtn big" type="button">Try a 48 MB file</button></div>`,
    );
    const zone = this.$(".zone");
    const input = this.$("input");
    zone.addEventListener("click", () => {
      if (this.phase === "idle") input.click();
    });
    zone.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && this.phase === "idle") {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) this.start(file.name, file.size);
      input.value = "";
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.over = true;
      this.kick();
    });
    zone.addEventListener("dragleave", () => {
      this.over = false;
      this.kick();
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      this.over = false;
      // only the first file of a drop is used
      const file = e.dataTransfer?.files?.[0];
      if (file) this.start(file.name, file.size);
    });
    this.$(".sample").addEventListener("click", () => this.start("q3-report.pdf", 2.4e6));
    this.$(".big").addEventListener("click", () => this.start("dataset-full.csv", 48.2e6));
  }

  /** The size limit in bytes, from `limit-mb`; 30 MB when it is missing, invalid or not positive. */
  get limit(): number {
    const mb = this.num("limit-mb", 30);
    return (mb > 0 ? mb : 30) * 1e6;
  }

  protected override init(): void {
    rollText(this.$(".l1"), IDLE_TEXT, 1, false);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.resetTimer);
    // a removed zone starts over at the prompt rather than mid-upload
    if (this.phase !== "idle") this.reset();
  }

  /**
   * Show the status line. The drop zone is a button, whose content assistive technology does not read out, so
   * the text is also written to a live region beside it.
   */
  private status(text: string, dir: number): void {
    rollText(this.$(".l1"), text, dir);
    this.$(".sr").textContent = text;
  }

  protected override resized(): void {
    const cx = this.w / 2;
    const ps = 4;
    const icon = DOC.map(([x, y]): IconPixel => ({ x: cx - 20 + x * ps, y: 18 + y * ps, on: true }));
    const order = icon
      .map((p, i): Point => [i, p.x + p.y])
      .sort((a, b) => b[1] - a[1])
      .map((entry) => entry[0]);
    const barCells: Point[] = [];
    const barW = Math.min(220, this.w - 40);
    const columns = Math.floor(barW / 4);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < columns; c++) barCells.push([cx - barW / 2 + c * 4, this.h - 18 + r * 4]);
    }
    const check = BIG_CHECK.map(([x, y]): Point => [cx - 24 + x * 4, 26 + y * 4]);
    this.layout = { icon, order, barCells, check };
  }

  /**
   * Runs the upload animation for a file of `size` bytes. Ignored unless the component is idle, and for a size
   * that is not a finite number of at least 0.
   */
  start(name: string, size: number): void {
    const layout = this.layout;
    if (this.phase !== "idle" || !layout || !(Number.isFinite(size) && size >= 0)) return;
    this.fileName = name;
    this.fileSize = size;
    this.startedAt = this.t;
    this.progress = 0;
    this.launched = 0;
    this.arrived = 0;
    this.flyers = [];
    for (const p of layout.icon) p.on = true;
    this.$(".l2").textContent = `${name} · ${formatMb(size)}`;
    if (size > this.limit) {
      this.phase = "error";
      this.dataset.state = "error";
      this.status(`Over the ${formatMb(this.limit).replace(".0", "")} limit`, 1);
      // `error` does not bubble: a bubbling event of that name would reach window.onerror
      this.emit<UploadFile>("error", { name, size }, { bubbles: false });
      this.resetTimer = setTimeout(() => this.reset(), 2600);
    } else {
      this.phase = "uploading";
      this.dataset.state = "uploading";
      this.duration = clamp((size / 1e6) * 0.6, 1.6, 3.4);
      this.status(`Uploading ${name}`, 1);
    }
    this.kick();
  }

  /** Returns to the idle drop zone. After a success the check flies back into the file icon. */
  reset(): void {
    clearTimeout(this.resetTimer);
    const layout = this.layout;
    const from = this.phase === "done" && layout ? layout.check : null;
    this.phase = "idle";
    delete this.dataset.state;
    rollText(this.$(".l1"), IDLE_TEXT, -1);
    this.$(".sr").textContent = "";
    this.$(".l2").textContent = "";
    this.flyers = [];
    if (layout) {
      if (from && !reduced()) {
        layout.icon.forEach((p, k) => {
          p.on = false;
          const [x0, y0] = from[k % from.length];
          this.flyers.push({ x0, y0, x1: p.x, y1: p.y, t0: this.t + k * 0.006, dur: 0.55, kind: "home", k });
        });
      } else {
        for (const p of layout.icon) p.on = true;
      }
    }
    this.kick();
  }

  /** Launch icon pixels in step with the progress; once all arrived, regroup the bar into the check. */
  private advance(layout: UploadLayout, t: number, still: boolean): void {
    const { icon, order, barCells, check } = layout;
    const n = icon.length;
    const bars = barCells.length;
    this.progress = Math.min(1, (t - this.startedAt) / this.duration);
    const due = Math.floor(this.progress * n);
    while (this.launched < due) {
      const p = icon[order[this.launched]];
      p.on = false;
      const [x1, y1] = barCells[Math.min(bars - 1, Math.floor((this.launched / n) * bars))];
      this.flyers.push({ x0: p.x, y0: p.y, x1, y1, t0: t, dur: still ? 0.01 : 0.55, kind: "bar" });
      this.launched++;
    }
    const sent = formatMb(this.fileSize * this.progress);
    this.$(".l2").textContent = `${Math.round(this.progress * 100)}% · ${sent} of ${formatMb(this.fileSize)}`;
    if (this.progress >= 1 && this.arrived >= n) {
      this.phase = "done";
      this.dataset.state = "done";
      this.status("Uploaded", 1);
      this.$(".l2").textContent = `${this.fileName} · ${formatMb(this.fileSize)}`;
      this.checkLanded = 0;
      this.flyers = barCells.map(([x0, y0], k): Flyer => {
        const [x1, y1] = check[k % check.length];
        return { x0, y0, x1, y1, t0: t + (k % 50) * 0.006, dur: still ? 0.01 : 0.6, kind: "check" };
      });
      this.emit<UploadFile>("uploaded", { name: this.fileName, size: this.fileSize });
      this.resetTimer = setTimeout(() => this.reset(), 2800);
    }
  }

  /** Dashed border that marches while idle and lights up while a file is dragged over. */
  private drawBorder(t: number, still: boolean): void {
    const P = this.P;
    const { w, h } = this;
    const step = Math.floor(t * 8);
    const hot = this.over;
    const perimeter: Point[] = [];
    for (let x = 6; x < w - 6; x += 6) perimeter.push([x, 4]);
    for (let y = 4; y < h - 4; y += 6) perimeter.push([w - 6, y]);
    for (let x = w - 6; x > 6; x -= 6) perimeter.push([x, h - 6]);
    for (let y = h - 6; y > 4; y -= 6) perimeter.push([6, y]);
    perimeter.forEach(([x, y], i) => {
      const lit = (i + (still ? 0 : step)) % 4 < 2;
      this.dot(x, y, hot ? P.accent : P.fg, lit ? (hot ? 0.9 : 0.35) : 0.1, 2);
    });
  }

  protected override render(t: number): boolean {
    const layout = this.layout;
    if (!layout) return false;
    const P = this.P;
    const still = reduced();
    const { icon, barCells, check } = layout;
    const n = icon.length;
    const bars = barCells.length;
    if (this.phase === "uploading") this.advance(layout, t, still);
    this.clear();
    this.drawBorder(t, still);

    // icon: bobs while idle, lifts under a drag, shakes red on error
    const hot = this.over;
    const bob = this.phase === "idle" && !still ? Math.sin(t * 2) * 2 - (hot ? 5 : 0) : 0;
    const shake = this.phase === "error" && t - this.startedAt < 0.45 && !still ? Math.sin(t * 70) * 3 : 0;
    const iconColor = this.phase === "error" ? P.danger : hot ? mix(P.accent, P.shine, 0.3) : P.accent;
    for (const p of icon) {
      if (p.on) this.dot(p.x + shake, p.y + bob, iconColor, 0.9, 3.2);
    }

    // progress bar
    if (this.phase === "uploading") {
      const lit = (this.arrived / n) * bars;
      barCells.forEach(([x, y], k) => {
        const on = k < lit;
        this.dot(x, y, on ? mix(P.accent, P.shine, k > lit - 4 ? 0.6 : 0) : P.fg, on ? 0.95 : 0.12, 3);
      });
    }

    // flyers arc from start to end
    let checkComplete = this.phase === "done";
    this.flyers = this.flyers.filter((f) => {
      const u = clamp((t - f.t0) / f.dur, 0, 1);
      const e = u * u * (3 - 2 * u);
      const x = lerp(f.x0, f.x1, e);
      const y = lerp(f.y0, f.y1, e) - Math.sin(u * Math.PI) * (f.kind === "bar" ? 26 : 14);
      if (t >= f.t0) this.dot(x, y, f.kind === "check" ? P.ok : mix(P.accent, P.shine, 0.5), 1, 3);
      if (u >= 1) {
        if (f.kind === "bar") this.arrived++;
        if (f.kind === "check") this.checkLanded++;
        if (f.kind === "home") icon[f.k].on = true;
        return false;
      }
      if (f.kind === "check") checkComplete = false;
      return true;
    });
    if (this.phase === "done") {
      const f = checkComplete ? 1 : Math.min(1, (this.checkLanded / bars) * 1.3);
      for (const [x, y] of check) this.dot(x, y, P.ok, 0.95 * f, 3.2);
    }
    // the border marches and the icon bobs; under reduced motion only uploads and flying pixels need frames
    return !still || this.phase === "uploading" || this.flyers.length > 0;
  }
}

define("px-upload", Upload);

export { Upload };

declare global {
  interface HTMLElementTagNameMap {
    "px-upload": Upload;
  }
}
