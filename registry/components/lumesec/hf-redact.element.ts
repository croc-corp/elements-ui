/**
 * <hf-redact> · PII redaction
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/redact
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-redact.tsx.
 */
import {
  HF,
  bayer,
  boxMapper,
  define,
  escapeHtml,
  h2,
  inRR,
  mix,
  now,
  reduced,
  rollText,
  type PaletteKey,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-redact>`. */
export interface HRedactEventMap {
  /**
   * Fires on connect, when the Redact switch changes and 160 ms after the text is edited. `text` is the output
   * pane: placeholders when `redacted` is `true`, the original otherwise.
   */
  change: CustomEvent<{ redacted: boolean; text: string }>;
}

/** Kind of personal data; placeholders are numbered per kind (`EMAIL_1`). */
type PiiKind = "NAME" | "EMAIL" | "IBAN" | "PHONE";

/** A detected span of personal data in the text. */
interface PiiMatch {
  k: PiiKind;
  /** Start and end offsets in the text. */
  a: number;
  b: number;
  /** The matched text. */
  s: string;
}

/** A kept match with its placeholder and the time its highlight appeared. */
interface PiiToken extends PiiMatch {
  ph: string;
  t0: number;
}

const PII: readonly { k: PiiKind; re: RegExp }[] = [
  { k: "EMAIL", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { k: "IBAN", re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g },
  { k: "PHONE", re: /\+\d{1,3}(?:[ -]?\d{2,4}){2,4}/g },
];

/** Palette colour of each kind, for the highlight and the legend. */
const KIND_COLOR: Readonly<Record<PiiKind, PaletteKey>> = {
  NAME: "danger",
  EMAIL: "accent",
  IBAN: "warn",
  PHONE: "ok",
};

const REDACT_SAMPLE =
  "Hi, I’m Jane Doe from the Hamburg office. Please refund the March invoice to IBAN DE89 3704 0044 0532 0130 00 and send the receipt to jane.doe@example.com. If anything is unclear, call me on +49 151 2345 6789.";

const WHITE: RGB = [255, 255, 255];

/** Shows text next to what a model would see, with names, emails, IBANs and phone numbers swapped for placeholders. */
class HRedact extends HF {
  private redacted = true;
  private tokens: PiiToken[] = [];
  private text = "";
  private counts = new Map<PiiKind, number>();
  private editTimer = 0;
  private readonly switchButton = this.$<HTMLButtonElement>(".sw");
  private readonly input = this.$("textarea");
  private readonly output = this.$(".o");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .hd b { font-size: 13.5px; font-weight: 600; }
      .sw { display: inline-flex; align-items: center; gap: 8px; border: 0; background: none; color: var(--_fg); font-size: 12.5px; font-weight: 500; cursor: pointer; padding: 2px; border-radius: 8px; }
      .sw i { position: relative; width: 34px; height: 20px; border-radius: 10px; background: var(--_track); transition: background .2s; }
      .sw i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .25s cubic-bezier(.3,1.4,.5,1); }
      .sw[aria-checked="true"] i { background: var(--_accent); }
      .sw[aria-checked="true"] i::after { transform: translateX(14px); }
      .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 10px; }
      .pane { position: relative; display: grid; gap: 6px; align-content: start; border: 1px solid var(--_border); border-radius: 12px; background: var(--_surface); padding: 10px 12px; min-width: 0; }
      .pl { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--_muted); }
      textarea { width: 100%; min-height: 128px; resize: vertical; border: 0; background: none; color: var(--_fg); font-family: var(--_font); font-size: 13.5px; line-height: 1.6; padding: 0; outline: none; }
      .o { position: relative; z-index: 2; font-size: 13.5px; line-height: 1.6; min-height: 128px; word-break: break-word; }
      .tk { position: relative; padding: 1px 3px; border-radius: 4px; font-family: var(--_mono); font-size: 12px; font-weight: 600; transition: color .25s; }
      .tk.raw { font-family: var(--_font); font-size: 13.5px; font-weight: 400; }
      .out canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; z-index: 1; }
      .ft { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; font-size: 12px; color: var(--_muted); }
      .ft .cnt { color: var(--_fg); font-weight: 600; }
      .ft i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; background: var(--c); }
      `,
      `<div class="hd"><b class="ti"></b><button class="sw" type="button" role="switch" aria-checked="true"><i></i>Redact</button></div>
        <div class="two"><label class="pane"><span class="pl">Your text</span><textarea spellcheck="false"></textarea></label><div class="pane out"><canvas class="px" aria-hidden="true"></canvas><span class="pl">What the model sees</span><div class="o"></div></div></div>
        <div class="ft"><span class="rollslot cnt"></span><span class="lg"></span></div><span class="sr" aria-live="polite"></span>`,
      2,
      0.72,
    );
    this.switchButton.addEventListener("click", () => {
      this.redacted = !this.redacted;
      this.switchButton.setAttribute("aria-checked", String(this.redacted));
      // every highlight replays its transition
      this.tokens.forEach((token) => {
        token.t0 = now();
      });
      this.paint(true);
    });
    this.input.addEventListener("input", () => {
      clearTimeout(this.editTimer);
      this.editTimer = window.setTimeout(() => this.build(true), 160);
    });
  }

  /** The parsed `names`. */
  get names(): string[] {
    return (this.getAttribute("names") || "Jane Doe")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  protected override init(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Before it leaves your device";
    this.input.value = (this.textContent ?? "").trim() || REDACT_SAMPLE;
    this.input.setAttribute("aria-label", "Your text");
    this.build(false);
  }

  /** Detect personal data in the input; matches keep their animation time across edits. */
  private build(anim: boolean): void {
    const text = this.input.value;
    const hits: PiiMatch[] = [];
    for (const pattern of PII) {
      for (const m of text.matchAll(pattern.re)) {
        const a = m.index ?? 0;
        hits.push({ k: pattern.k, a, b: a + m[0].length, s: m[0] });
      }
    }
    for (const name of this.names) {
      let i = -1;
      while ((i = text.indexOf(name, i + 1)) >= 0) hits.push({ k: "NAME", a: i, b: i + name.length, s: name });
    }
    // earliest first, longest first; overlapping matches are dropped
    hits.sort((x, y) => x.a - y.a || y.b - x.b);
    const keep: PiiMatch[] = [];
    let end = -1;
    for (const hit of hits) {
      if (hit.a >= end) {
        keep.push(hit);
        end = hit.b;
      }
    }
    const counts = new Map<PiiKind, number>();
    const previous = new Map(this.tokens.map((token) => [token.s, token]));
    this.tokens = keep.map((hit) => {
      const count = (counts.get(hit.k) ?? 0) + 1;
      counts.set(hit.k, count);
      const t0 = previous.get(hit.s)?.t0 ?? (anim ? now() : -9);
      return { ...hit, ph: `${hit.k}_${count}`, t0 };
    });
    this.text = text;
    this.counts = counts;
    this.paint(anim);
  }

  /** Render the output pane, the count and the legend, and fire `change`. */
  private paint(anim: boolean): void {
    let html = "";
    let last = 0;
    this.tokens.forEach((token, k) => {
      const label = this.redacted ? token.ph : token.s;
      html +=
        escapeHtml(this.text.slice(last, token.a)) +
        `<span class="tk ${this.redacted ? "" : "raw"}" data-k="${k}">${escapeHtml(label)}</span>`;
      last = token.b;
    });
    this.output.innerHTML = html + escapeHtml(this.text.slice(last));
    const n = this.tokens.length;
    const items = `${n} item${n === 1 ? "" : "s"}`;
    const status = this.redacted ? `${items} protected` : `${items} exposed`;
    rollText(this.$(".cnt"), status, this.redacted ? 1 : -1, anim);
    // announce the count, not the whole output pane, and only when it changes after the first render
    if (anim) this.$(".sr").textContent = status;
    this.$(".lg").innerHTML = [...this.counts]
      .map(([k, v]) => `<span><i style="--c:var(--_${KIND_COLOR[k]})"></i>${k.toLowerCase()} ${v}</span>`)
      .join(" · ");
    const text = this.redacted ? (this.output.textContent ?? "") : this.text;
    this.emit<{ redacted: boolean; text: string }>("change", { redacted: this.redacted, text });
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
    let busy = false;
    F.clear();
    this.$$(".tk").forEach((el) => {
      const token = this.tokens[Number(el.dataset.k)];
      if (!token) return;
      const age = R0 ? 9 : t - token.t0;
      const c = P[KIND_COLOR[token.k]];
      for (const r of el.getClientRects()) {
        const { x: x0, y: y0, w, h: hh } = local(r);
        for (let j = Math.floor(y0 / pp); j < (y0 + hh) / pp; j++) {
          for (let i = Math.floor(x0 / pp); i < (x0 + w) / pp; i++) {
            const [x, y] = F.xy(i, j);
            const lx = x - x0;
            const ly = y - y0;
            if (inRR(lx, ly, w, hh, 4) > 0) continue;
            if (this.redacted) {
              if (age < 0.45) {
                // the placeholder resolves out of noise
                busy = true;
                const fade = 1 - age / 0.45;
                if (h2(i, j + Math.floor(t * 40)) < 0.6 * fade + 0.2) {
                  F.put(i, j, mix(c, WHITE, h2(j, i) * 0.6), 0.9, 0.5 * fade);
                }
                continue;
              }
              const edge = ly < 1.5 || ly > hh - 1.5;
              if (!edge && bayer(i, j) > 0.5) continue;
              F.put(i, j, edge ? c : mix(c, P.surface, this.dark ? 0.55 : 0.7), edge ? 0.85 : 1, edge ? 0.25 : 0);
            } else if (age < 0.5) {
              // the highlight dissolves from the top
              busy = true;
              const f = age / 0.5;
              if (ly / hh < f + (h2(i, j) - 0.5) * 0.4) continue;
              F.put(i, j, c, 0.85 * (1 - f), 0.4 * (1 - f));
            } else if (ly > hh - 1.6 && i % 2 === 0) {
              F.put(i, j, c, 0.8, 0.1);
            }
          }
        }
      }
    });
    this.flush(0.75, 4);
    return busy;
  }
}

define("hf-redact", HRedact);

export { HRedact };

declare global {
  interface HTMLElementTagNameMap {
    "hf-redact": HRedact;
  }
}
