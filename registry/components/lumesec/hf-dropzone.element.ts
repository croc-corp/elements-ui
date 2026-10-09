/**
 * <hf-dropzone> · Drop zone
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/dropzone
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-dropzone.tsx.
 *
 * Demo data: Upload progress is simulated on a timer; only the file names and sizes come from the files the
 * user drops. It cannot show your own data yet; use it as a template and replace the invented data before it
 * shows anything real.
 */
import { HF, clamp, define, localPoint, mix, reduced, rrSdf } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-dropzone>`. */
export interface HDropzoneEventMap {
  /** Fires once per drop or file-picker selection with every selected file. */
  files: CustomEvent<{ files: File[] }>;
  /** Fires per file when its simulated progress reaches 100%. `size` is in bytes. Not fired for files over 25 MB. */
  uploaded: CustomEvent<{ name: string; size: number }>;
}

/** Height field of the ripple simulation, one value per dot; two buffers alternate every frame. */
interface WaveBuffers {
  prev: Float32Array;
  cur: Float32Array;
}

/** Largest accepted file in bytes; matches the fixed `up to 25 MB each` text. */
const MAX_BYTES = 25e6;

function span(className: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  return el;
}

/**
 * File drop zone drawn as a ripple simulation; dropped or picked files are listed with a simulated dotted progress
 * bar.
 */
class HDropzone extends HF {
  /** Null until the first layout sizes the field. */
  private waves: WaveBuffers | null = null;
  /** True while files are dragged over the zone. */
  private over = false;
  /** Time of the last ambient raindrop. */
  private lastDrop = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      .zone { position: relative; height: 176px; border-radius: 16px; cursor: pointer; overflow: hidden; }
      .zone:focus-visible { outline: 2px solid var(--_accent); outline-offset: 3px; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .msg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 4px; text-align: center; pointer-events: none; padding: 0 16px; }
      .msg b { font-size: 14.5px; font-weight: 600; }
      .msg span { font-size: 12.5px; color: var(--_muted); }
      .msg u { color: var(--_accent); text-decoration: none; font-weight: 600; }
      ul { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
      li { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; font-size: 13px; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--_fg) 4%, transparent); animation: lin .3s cubic-bezier(.2,.8,.2,1); }
      li .n { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
      li .s { font-family: var(--_mono); font-size: 11.5px; color: var(--_muted); }
      li .bar { grid-column: 1 / -1; height: 4px; border-radius: 2px; background-image: radial-gradient(circle, color-mix(in srgb, var(--_fg) 22%, transparent) 0.9px, transparent 1.1px); background-size: 3px 4px; position: relative; overflow: hidden; }
      li .bar i { position: absolute; inset: 0; width: 0; background-image: radial-gradient(circle, var(--_accent) 1px, transparent 1.2px); background-size: 3px 4px; transition: width .2s linear; }
      li.done .bar i { background-image: radial-gradient(circle, var(--_ok) 1px, transparent 1.2px); }
      li.done .s { color: var(--_ok); }
      @keyframes lin { from { opacity: 0; transform: translateY(-4px); } }
      @media (prefers-reduced-motion: reduce) { li { animation: none; } }
      `,
      `<div class="zone" tabindex="0" role="button" aria-label="Upload files: drop them here or press to browse"><canvas class="px" aria-hidden="true"></canvas><div class="msg"><b>Drop files here</b><span>or <u>browse</u> · up to 25 MB each</span></div></div><input type="file" multiple hidden><ul aria-live="polite"></ul>`,
      3,
      0.62,
    );
    const zone = this.$(".zone");
    const input = this.$("input");
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    zone.addEventListener("pointermove", (e) => this.poke(e, 1.2));
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.over = true;
      this.poke(e, 2);
    });
    zone.addEventListener("dragleave", () => {
      this.over = false;
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      this.over = false;
      this.poke(e, 14, 3);
      this.add([...(e.dataTransfer?.files ?? [])]);
    });
    input.addEventListener("change", () => {
      this.splash();
      this.add([...(input.files ?? [])]);
      input.value = "";
    });
  }

  protected override layout(): void {
    const n = this.F.cols * this.F.rows;
    this.waves = { prev: new Float32Array(n), cur: new Float32Array(n) };
  }

  /** Push the water down under the pointer with strength `s` over a square of `rad` cells. */
  private poke(e: MouseEvent, s: number, rad = 1): void {
    const waves = this.waves;
    if (!waves || reduced()) return;
    const F = this.F;
    const [i, j] = F.ij(...localPoint(this.$("canvas"), e));
    const C = F.cols;
    for (let dj = -rad; dj <= rad; dj++) {
      for (let di = -rad; di <= rad; di++) {
        const ii = i + di;
        const jj = j + dj;
        if (ii > 0 && jj > 0 && ii < C - 1 && jj < F.rows - 1) waves.cur[jj * C + ii] += s;
      }
    }
    this.kick();
  }

  /** A large drop in the centre, for files picked with the dialog. */
  private splash(): void {
    const waves = this.waves;
    if (!waves) return;
    const C = this.F.cols;
    const i = C >> 1;
    const j = this.F.rows >> 1;
    for (let dj = -3; dj <= 3; dj++) {
      for (let di = -3; di <= 3; di++) waves.cur[(j + dj) * C + i + di] += 10;
    }
    this.kick();
  }

  /** List up to six files with simulated progress; the list keeps the five most recent rows. */
  private add(files: File[]): void {
    // a drop of text or links carries no files
    if (!files.length) return;
    const list = this.$("ul");
    for (const file of files.slice(0, 6)) {
      const row = document.createElement("li");
      const name = span("n");
      const status = span("s");
      const bar = span("bar");
      const fill = document.createElement("i");
      bar.append(fill);
      row.append(name, status, bar);
      name.textContent = file.name;
      const tooBig = file.size > MAX_BYTES;
      const size = `${(file.size / 1e6).toFixed(file.size < 1e6 ? 2 : 1)} MB`;
      status.textContent = tooBig ? `${size} · too large` : size;
      list.prepend(row);
      if (tooBig) {
        status.style.color = "var(--_danger)";
        continue;
      }
      let progress = 0;
      const timer = setInterval(() => {
        progress = Math.min(100, progress + 6 + Math.random() * 14);
        fill.style.width = `${progress}%`;
        if (progress >= 100) {
          clearInterval(timer);
          row.classList.add("done");
          status.textContent = `${size} · uploaded`;
          this.emit<{ name: string; size: number }>("uploaded", { name: file.name, size: file.size });
        }
      }, 140);
    }
    while (list.children.length > 5) list.lastElementChild?.remove();
    this.emit<{ files: File[] }>("files", { files });
  }

  protected override render(t: number): boolean {
    const waves = this.waves;
    if (!waves) return false;
    const P = this.P;
    const F = this.F;
    const C = F.cols;
    const R = F.rows;
    const reducedMotion = reduced();
    if (!reducedMotion) {
      // an ambient raindrop about once a second
      if (t - this.lastDrop > 1.1) {
        this.lastDrop = t;
        const i = 2 + ((Math.random() * (C - 4)) | 0);
        const j = 2 + ((Math.random() * (R - 4)) | 0);
        waves.cur[j * C + i] += 2.2;
      }
      // two-buffer wave equation: the next state overwrites the previous one, then the buffers swap
      const next = waves.prev;
      const cur = waves.cur;
      for (let j = 1; j < R - 1; j++) {
        for (let i = 1; i < C - 1; i++) {
          const k = j * C + i;
          next[k] = ((cur[k - 1] + cur[k + 1] + cur[k - C] + cur[k + C]) / 2 - next[k]) * 0.972;
        }
      }
      waves.prev = cur;
      waves.cur = next;
    }
    F.clear();
    const height = waves.cur;
    const inset = 6;
    // the dashed border marches unless motion is reduced
    const march = reducedMotion ? 0 : Math.floor(t * 10);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        const [x, y] = F.xy(i, j);
        const k = j * C + i;
        const d = rrSdf(x, y, this.w / 2, this.h / 2, this.w / 2 - inset, this.h / 2 - inset, 12);
        if (Math.abs(d) < 1.6) {
          const on = ((i + j + march) >> 1) % 2 === 0;
          F.put(i, j, this.over ? P.accent : P.fg, on ? (this.over ? 0.95 : 0.4) : 0.08, this.over && on ? 0.6 : 0);
          continue;
        }
        if (d > 0) continue;
        const v = height[k] || 0;
        const slope = i > 0 && i < C - 1 ? height[k + 1] - height[k - 1] : 0;
        const light = clamp(0.1 + Math.abs(v) * 0.22 + Math.max(0, slope) * 0.35 + (this.over ? 0.08 : 0), 0, 1);
        F.put(i, j, mix(P.accent, P.shine, clamp(slope * 0.4, 0, 0.6)), light, Math.max(0, light - 0.45));
      }
    }
    this.flush(0.8, 5);
    return !reducedMotion;
  }
}

define("hf-dropzone", HDropzone);

declare global {
  interface HTMLElementTagNameMap {
    "hf-dropzone": HDropzone;
  }
}

export { HDropzone };
