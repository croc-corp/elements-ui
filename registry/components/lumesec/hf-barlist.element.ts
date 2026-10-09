/**
 * <hf-barlist> · Bar list
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/barlist
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-barlist.tsx.
 */
import { HF, bayer, boxMapper, define, ease3, escapeHtml, fmtInt, mix, now, reduced } from "@/lib/lumesec/pixel";

/** A parsed `label:value` row of the `data` attribute. */
export interface HBarlistItem {
  label: string;
  v: number;
}

const DEFAULT_DATA =
  "src/auth/session.ts:184,src/api/client.ts:121,src/ui/composer.tsx:96,tests/auth.spec.ts:58,README.md:21";

/** Corner radius of a bar in pixels. */
const BAR_RADIUS = 7;

/**
 * Rows of a `data` string: comma-separated `label:value` entries, split at the last colon (labels may contain
 * colons), sorted by value, highest first. An entry without a colon is a label with value 0; empty entries are
 * skipped.
 */
const parseItems = (data: string): HBarlistItem[] =>
  data
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.lastIndexOf(":");
      return i < 0 ? { label: s, v: 0 } : { label: s.slice(0, i).trim(), v: +s.slice(i + 1) || 0 };
    })
    .sort((a, b) => b.v - a.v);

/**
 * Ranked bar list with dithered bars behind the labels that grow in one after another; hover or focus runs a sheen
 * along a bar.
 */
class HBarlist extends HF {
  static observedAttributes = ["data", "label", "unit"];

  /** The rows on screen, parsed from `data` when they were built. */
  private rows: HBarlistItem[] = [];
  /** Index of the hovered or focused row; -1 for none. */
  private hover = -1;
  /** Eased 0–1 highlight per row. */
  private hv: number[] = [];
  /** Time the bars started to grow in. */
  private t0 = 0;
  /** Start time of the sheen per row; unset until the row is first hovered. */
  private sw: (number | undefined)[] = [];

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; justify-content: space-between; font-size: 12px; color: var(--_muted); margin-bottom: 8px; }
      .ls { position: relative; display: grid; gap: 6px; }
      canvas.px { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
      .r { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 32px; padding: 0 10px; font-size: 13px; border-radius: 7px; cursor: default; }
      .r .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--_mono); font-size: 12.5px; }
      .r b { font-weight: 600; font-variant-numeric: tabular-nums; }
      .r:focus-visible { outline: 2px solid var(--_accent); }
      `,
      `<div class="hd"><span class="l" id="l"></span><span class="u"></span></div><div class="ls" role="list" aria-labelledby="l"><canvas class="px" aria-hidden="true"></canvas></div>`,
      2,
      0.74,
    );
  }

  /** Rows parsed from `data` (split at the last colon), sorted by value, highest first. */
  get items(): HBarlistItem[] {
    return parseItems(this.getAttribute("data") || DEFAULT_DATA);
  }

  attributeChangedCallback(name: string): void {
    // before the first connect, init() reads every attribute
    if (!this.initialized) return;
    if (name === "data") this.build();
    else this.renderHeader();
  }

  protected override init(): void {
    this.renderHeader();
    this.build();
  }

  private renderHeader(): void {
    this.$(".l").textContent = this.getAttribute("label") || "Most edited files";
    this.$(".u").textContent = this.getAttribute("unit") || "Edits";
  }

  /** (Re)build the rows from `data`; the bars grow in again. */
  private build(): void {
    const list = this.$(".ls");
    const focused = this.$$(".r").findIndex((row) => row === this.root.activeElement);
    this.$$(".r").forEach((row) => row.remove());
    this.rows = this.items;
    this.hover = -1;
    this.rows.forEach((item, k) => {
      const row = document.createElement("div");
      row.className = "r";
      row.tabIndex = 0;
      row.setAttribute("role", "listitem");
      row.dataset.k = String(k);
      row.innerHTML = `<span class="n">${escapeHtml(item.label)}</span><b>${fmtInt(item.v)}</b>`;
      row.setAttribute("aria-label", `${item.label}: ${fmtInt(item.v)}`);
      const on = (): void => {
        this.hover = k;
        this.sw[k] = now();
        this.kick();
      };
      const off = (): void => {
        if (this.hover === k) this.hover = -1;
        this.kick();
      };
      row.addEventListener("pointerenter", on);
      row.addEventListener("pointerleave", off);
      row.addEventListener("focus", on);
      row.addEventListener("blur", off);
      list.append(row);
    });
    this.hv = this.rows.map(() => 0);
    this.sw = [];
    this.t0 = now();
    // keep keyboard focus on the same row position after a rebuild
    if (focused >= 0) this.$$(".r")[Math.min(focused, this.rows.length - 1)]?.focus();
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const items = this.rows;
    // bars are relative to the largest value; negative values get no bar
    const mx = Math.max(0, items[0]?.v ?? 0) || 1;
    const local = boxMapper(this.$(".ls"));
    const pitch = F.pitch;
    const rr = BAR_RADIUS;
    let busy = false;
    F.clear();
    this.$$(".r").forEach((el, k) => {
      const { x: x0, y: y0, w: rowW, h: rowH } = local(el);
      this.hv[k] += ((k === this.hover ? 1 : 0) - this.hv[k]) * Math.min(1, dt * 10);
      const hv = this.hv[k];
      // rows grow in one after another
      const grow = reducedMotion ? 1 : ease3((t - this.t0) * 1.6 - k * 0.12);
      const w = (Math.max(0, items[k].v) / mx) * rowW * grow;
      const sw = reducedMotion ? 2 : (t - (this.sw[k] ?? -9)) * 1.8;
      if (grow < 1 || sw < 1.2 || Math.abs(hv - (k === this.hover ? 1 : 0)) > 0.01) busy = true;
      for (let j = Math.floor(y0 / pitch); j < (y0 + rowH) / pitch; j++) {
        for (let i = Math.floor(x0 / pitch); i < (x0 + w) / pitch; i++) {
          const [x, y] = F.xy(i, j);
          const lx = x - x0;
          const ly = y - y0;
          const u = lx / Math.max(1, w);
          // rounded left corners; the right end is cut by the bar length
          const qx = Math.max(rr - lx, 0);
          const qy = Math.max(rr - ly, ly - (rowH - rr), 0);
          if (Math.hypot(qx, qy) > rr) continue;
          const front = grow < 1 ? Math.exp(-((w - lx) ** 2) / 30) : 0;
          const sheen = sw < 1.2 ? Math.exp(-(((u - sw) * 6) ** 2)) : 0;
          const dens = 0.22 + 0.4 * u + hv * 0.25 + sheen * 0.5;
          if (bayer(i, j) > dens && front < 0.3) continue;
          F.put(
            i,
            j,
            mix(P.accent, P.shine, sheen * 0.6 + front * 0.5),
            (this.dark ? 0.42 : 0.3) + hv * 0.18 + sheen * 0.3 + front * 0.5,
            sheen * 0.5 + front * 0.7,
          );
        }
      }
    });
    this.flush(0.75, 4);
    return busy;
  }
}

define("hf-barlist", HBarlist);

declare global {
  interface HTMLElementTagNameMap {
    "hf-barlist": HBarlist;
  }
}

export { HBarlist };
