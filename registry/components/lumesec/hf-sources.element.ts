/**
 * <hf-sources> · Sources and citations
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/sources
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-sources.tsx.
 *
 * Demo data: The paragraph, citations and sources are invented; nothing can be set. It cannot show your own
 * data yet; use it as a template and replace the invented data before it shows anything real.
 */
import {
  HF,
  bayer,
  boxMapper,
  clamp,
  css,
  define,
  escapeHtml,
  hsl,
  inRR,
  mix,
  now,
  reduced,
  strHash,
  type Point,
} from "@/lib/lumesec/pixel";

/** A cited source. */
export interface Source {
  /** Title. */
  t: string;
  /** Domain. */
  d: string;
  /** Snippet. */
  s: string;
}

/** Events fired by `<hf-sources>`. */
export interface HSourcesEventMap {
  /** A citation or source chip was clicked. */
  open: CustomEvent<{ source: Source }>;
}

const SOURCES: readonly Source[] = [
  {
    t: "Refresh token rotation, explained",
    d: "docs.example.com",
    s: "Issue a new refresh token on every use and invalidate the old one, so a stolen token works at most once.",
  },
  {
    t: "OAuth 2.0 — refreshing an access token",
    d: "spec.example.org",
    s: "The authorization server MAY issue a new refresh token, in which case the client MUST discard the old one.",
  },
  {
    t: "Clock skew between services",
    d: "blog.example.net",
    s: "A tolerance of 30–60 seconds avoids spurious expiry errors when servers’ clocks drift.",
  },
];

/** The paragraph, split where citations 1 to 3 go. */
const PARAGRAPH: readonly string[] = [
  "Rotating refresh tokens on every use limits the damage of a leaked token",
  ", and the spec lets the server issue a fresh refresh token with each response",
  ". Allowing about 30 seconds of clock skew avoids spurious expiries between services",
  ".",
];

/** Skeleton lines of the loading preview: top offset, width as a fraction, height. */
const SKELETON: readonly (readonly [offsetY: number, widthFraction: number, height: number])[] = [
  [0, 0.35, 8],
  [16, 0.75, 10],
  [36, 0.95, 8],
  [52, 0.6, 8],
];

/** Paragraph with numbered citations; hovering or focusing one draws a dotted beam to its source chip. */
class HSources extends HF {
  /** Index of the active source. */
  private active = 0;
  private activeAt = 0;
  private loadTimer = 0;
  private readonly preview = this.$(".pv");

  constructor() {
    super(
      `
      :host { display: block; }
      .w { position: relative; }
      /* the canvas sits above the chip and preview backgrounds and below all text */
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; z-index: 1; }
      p { position: relative; z-index: 2; margin: 0 0 14px; font-size: 14.5px; line-height: 1.65; }
      sup { line-height: 0; }
      .nw { white-space: nowrap; }
      .cite { position: relative; display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; margin-left: 2px; border: 0; border-radius: 5px; background: color-mix(in srgb, var(--_accent) 16%, transparent); color: var(--_accent); font-size: 11px; font-weight: 700; cursor: pointer; vertical-align: 2px; }
      .lab { position: relative; z-index: 2; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--_muted); margin-bottom: 8px; }
      .ls { position: relative; display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
      .ls li { display: flex; min-width: 0; max-width: 100%; }
      .src { position: relative; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px 0 8px; border-radius: 10px; border: 1px solid var(--_border); background: var(--_surface); color: var(--_fg); font-size: 12.5px; cursor: pointer; transition: border-color .2s; min-width: 0; max-width: 100%; }
      .src > * { position: relative; z-index: 2; }
      .src.on { border-color: color-mix(in srgb, var(--_accent) 60%, var(--_border)); }
      .src .fav { display: grid; place-items: center; width: 18px; height: 18px; flex: none; font-size: 11px; font-weight: 700; line-height: 1; color: #fff; }
      .src b { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--_muted); }
      .src span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pv { position: relative; margin-top: 10px; border: 1px solid var(--_border); border-radius: 12px; background: var(--_surface); padding: 12px 14px; min-height: 84px; }
      .pv .dm { font-size: 11.5px; color: var(--_muted); }
      .pv .pt { font-size: 13.5px; font-weight: 600; margin: 2px 0 4px; }
      .pv .ps { font-size: 12.5px; color: var(--_muted); line-height: 1.5; }
      .pv .bd { position: relative; z-index: 2; transition: opacity .2s; }
      .pv.ld .bd { opacity: 0; }
      `,
      `<div class="w"><canvas class="px" aria-hidden="true"></canvas><p class="tx"></p><div class="lab" id="lab">Sources</div><ul class="ls" role="list" aria-labelledby="lab"></ul><div class="pv" aria-live="polite"><div class="bd"><div class="dm"></div><div class="pt"></div><div class="ps"></div></div></div></div>`,
      2,
      0.72,
    );
  }

  protected override init(): void {
    const cite = (k: number): string =>
      k < 3
        ? `<sup><button class="cite" type="button" data-k="${k}" aria-label="Source ${k + 1}: ${escapeHtml(SOURCES[k].t)}">${k + 1}</button></sup>`
        : "";
    // each citation stays on one line with the word before it and the punctuation after it
    let html = "";
    PARAGRAPH.forEach((part, k) => {
      let text = part;
      if (k > 0) {
        const lead = /^\S*/.exec(text)?.[0] ?? "";
        html += `${escapeHtml(lead)}</span>`;
        text = text.slice(lead.length);
      }
      if (k < 3) {
        const tail = /\S*$/.exec(text)?.[0] ?? "";
        html += `${escapeHtml(text.slice(0, text.length - tail.length))}<span class="nw">${escapeHtml(tail)}${cite(k)}`;
      } else html += escapeHtml(text);
    });
    this.$(".tx").innerHTML = html;
    // chips are buttons: they report `open` and leave navigation to the page
    this.$(".ls").innerHTML = SOURCES.map(
      (s, k) =>
        `<li><button class="src" type="button" data-k="${k}" aria-label="Source ${k + 1}: ${escapeHtml(s.d)}"><span class="fav" aria-hidden="true">${escapeHtml(s.d[0].toUpperCase())}</span><b aria-hidden="true">${k + 1}</b><span>${escapeHtml(s.d)}</span></button></li>`,
    ).join("");
    this.$$(".cite, .src").forEach((el) => {
      const k = Number(el.dataset.k);
      el.addEventListener("pointerenter", () => this.pick(k));
      el.addEventListener("focus", () => this.pick(k));
      el.addEventListener("click", () => {
        this.pick(k);
        this.emit<{ source: Source }>("open", { source: SOURCES[k] });
      });
    });
    this.pick(0, true);
  }

  /** Make source `k` active; the preview shows a loading skeleton for 280 ms first. */
  private pick(k: number, first = false): void {
    if (k === this.active && !first) return;
    this.active = k;
    this.activeAt = now();
    const preview = this.preview;
    const source = SOURCES[k];
    preview.classList.add("ld");
    clearTimeout(this.loadTimer);
    this.loadTimer = window.setTimeout(
      () => {
        this.$(".dm").textContent = source.d;
        this.$(".pt").textContent = source.t;
        this.$(".ps").textContent = source.s;
        preview.classList.remove("ld");
        this.kick();
      },
      first || reduced() ? 0 : 280,
    );
    this.$$(".src").forEach((el) => el.classList.toggle("on", Number(el.dataset.k) === k));
    this.kick();
  }

  protected override render(t: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const local = boxMapper(canvas);
    const busy = !R0;
    F.clear();
    // favicon tiles: dots on a colour from the domain's hash, under the domain's first letter set as text
    this.$$(".src").forEach((el, k) => {
      const fav = el.querySelector<HTMLElement>(".fav")!;
      const { x: x0, y: y0 } = local(fav);
      const domain = SOURCES[k].d;
      const on = k === this.active;
      const hue = strHash(domain) % 360;
      // the gaps between dots show the surface: a light theme gets a pale tile with a dark letter
      const bg = this.dark ? hsl(hue, 0.55, 0.55) : hsl(hue, 0.7, 0.8);
      fav.style.color = this.dark ? "#fff" : css(hsl(hue, 0.6, 0.3));
      for (let j = Math.floor(y0 / pp); j < (y0 + 18) / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < (x0 + 18) / pp; i++) {
          const [x, y] = F.xy(i, j);
          if (inRR(x - x0, y - y0, 18, 18, 5) > 0) continue;
          F.put(i, j, bg, 1, on ? 0.3 : 0);
        }
      }
    });
    // beam from the active citation to its source chip
    const citation = this.root.querySelector(`.cite[data-k="${this.active}"]`);
    const chip = this.root.querySelector(`.src[data-k="${this.active}"]`);
    if (citation && chip) {
      const a = local(citation);
      const b = local(chip);
      const ax = a.x + a.w / 2;
      const ay = a.y + a.h + 2;
      const bx = b.x + b.w / 2;
      const by = b.y - 2;
      const age = R0 ? 9 : t - this.activeAt;
      const grow = clamp(age / 0.35, 0, 1);
      const N = 90;
      // cubic Bézier that leaves the citation vertically and enters the chip vertically
      const my = (ay + by) / 2;
      const pointAt = (u: number): Point => {
        const v = 1 - u;
        const x = v ** 3 * ax + 3 * v ** 2 * u * ax + 3 * v * u * u * bx + u ** 3 * bx;
        const y = v ** 3 * ay + 3 * v ** 2 * u * my + 3 * v * u * u * my + u ** 3 * by;
        return [x, y];
      };
      for (let q = 0; q <= N * grow; q++) {
        const [x, y] = pointAt(q / N);
        if (q % 2 === 0) F.plot(x, y, mix(P.accent, P.muted, 0.3), 0.75, 0.15);
      }
      if (!R0) {
        for (let p = 0; p < 2; p++) {
          const [x, y] = pointAt(((t * 0.7 + p * 0.5) % 1) * grow);
          for (let dx = -2; dx <= 2; dx += pp) {
            for (let dy = -2; dy <= 2; dy += pp) F.plot(x + dx, y + dy, mix(P.accent, P.shine, 0.6), 1, 0.9);
          }
        }
      }
      // glow ring around the citation marker
      const rx = a.x - 3;
      const ry = a.y - 3;
      for (let j = Math.floor(ry / pp); j < (a.y + a.h + 3) / pp; j++) {
        for (let i = Math.floor(rx / pp); i < (a.x + a.w + 3) / pp; i++) {
          const [x, y] = F.xy(i, j);
          const sd = inRR(x - rx, y - ry, a.w + 6, a.h + 6, 7);
          if (sd <= 0 && sd > -1.6) F.put(i, j, P.accent, 1, 0.6);
        }
      }
    }
    // skeleton shimmer in the preview while it "loads"
    const preview = this.preview;
    if (preview.classList.contains("ld")) {
      const r = local(preview);
      const x0 = r.x + 14;
      const y0 = r.y + 14;
      const sheen = ((t * 1.5) % 1.4) - 0.2;
      for (const [oy, wf, hh] of SKELETON) {
        const w = (r.w - 28) * wf;
        for (let j = Math.floor((y0 + oy) / pp); j < (y0 + oy + hh) / pp; j++) {
          for (let i = Math.floor(x0 / pp); i < (x0 + w) / pp; i++) {
            const [x] = F.xy(i, j);
            const u = (x - x0) / (r.w - 28);
            const g = Math.exp(-((u - sheen) ** 2) / 0.01);
            F.put(i, j, mix(P.track, P.accent, g * 0.6), bayer(i, j) < 0.7 ? 1 : 0.6, g * 0.3);
          }
        }
      }
    }
    this.flush(0.75, 4);
    return busy;
  }
}

define("hf-sources", HSources);

export { HSources };

declare global {
  interface HTMLElementTagNameMap {
    "hf-sources": HSources;
  }
}
