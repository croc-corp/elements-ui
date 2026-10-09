/**
 * <hf-mention> · @mention field
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/mention
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-mention.tsx.
 *
 * Demo data: The six suggestions (files, people and an agent) are invented; only `label`, `placeholder` and
 * `value` can be set. It cannot show your own data yet; use it as a template and replace the invented data
 * before it shows anything real.
 */
import {
  DISABLED_CSS,
  FormMixin,
  HF,
  bayer,
  boxMapper,
  clamp,
  define,
  escapeHtml,
  hsl,
  inRR,
  mix,
  now,
  reduced,
  rollText,
  strHash,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Events fired by `<hf-mention>`. */
export interface HMentionEventMap {
  /** Fires on each edit and after a mention is inserted, with the full text. */
  input: CustomEvent<{ value: string }>;
  /** Fires when a suggestion is inserted. `value` is the mention without the `@`, for example `src/auth/session.ts`. */
  mention: CustomEvent<{ value: string }>;
}

/** What a mention refers to: a file, a person or an agent. */
type MentionKind = "f" | "p" | "a";

/** A built-in suggestion. */
interface Mention {
  /** The text after `@`. */
  value: string;
  description: string;
  kind: MentionKind;
}

const MENTIONS: readonly Mention[] = [
  { value: "src/auth/session.ts", description: "File · modified", kind: "f" },
  { value: "src/api/client.ts", description: "File", kind: "f" },
  { value: "docs/README.md", description: "File", kind: "f" },
  { value: "ada", description: "Ada Lovelace · Design", kind: "p" },
  { value: "grace", description: "Grace Hopper · Backend", kind: "p" },
  { value: "reviewer", description: "Agent · reviews diffs", kind: "a" },
];

const WHITE: RGB = [255, 255, 255];

/** Four-pointed star field like the engine's `sparkSdf`, a little fuller; values below 1 are inside. */
const sparkSdf2 = (dx: number, dy: number, s: number): number =>
  Math.pow(Math.abs(dx) / s, 0.75) + Math.pow(Math.abs(dy) / s, 0.75);

/**
 * Textarea with @mention suggestions for files, people and agents; matched letters are marked and inserted mentions
 * become dotted chips.
 */
class HMention extends FormMixin(HF) {
  static readonly observedAttributes = ["label", "placeholder"] as const;

  /** The query after `@` while the suggestion list is open; null when it is closed. */
  private q: string | null = null;
  /** Matching suggestions, at most five. */
  private res: Mention[] = [];
  /** Index of the highlighted suggestion. */
  private hi = 0;
  /** Spring position and velocity of the highlight slab, in pixels from the top of the menu. */
  private hy = 0;
  private vy = 0;
  /** Time each mention (`@value`) was inserted, for its flash. */
  private readonly flash = new Map<string, number>();
  /** Time the list opened. */
  private openT = 0;
  /** The text on first connect; form reset restores it. */
  private defaultText = "";

  constructor() {
    super(
      `
      :host { display: block; }
      ${DISABLED_CSS}
      .lab { display: block; font-size: 12.5px; font-weight: 500; margin-bottom: 6px; }
      .wr { position: relative; }
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; z-index: 1; }
      .f { position: relative; border: 1px solid var(--_border); border-radius: 12px; background: var(--_surface); transition: border-color .2s, box-shadow .2s; }
      .f:focus-within { border-color: color-mix(in srgb, var(--_accent) 60%, var(--_border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--_accent) 13%, transparent); }
      textarea, .mir { display: block; width: 100%; margin: 0; padding: 12px 14px; font-size: 14px; line-height: 1.6; font-family: var(--_font); letter-spacing: 0; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; border: 0; }
      textarea { position: relative; z-index: 2; resize: none; background: transparent; color: var(--_fg); outline: none; min-height: 92px; }
      textarea:focus-visible { outline: none; }
      textarea::placeholder { color: var(--_muted); opacity: .8; }
      .mir { position: absolute; inset: 0; visibility: hidden; overflow: hidden; }
      .menu { position: relative; margin-top: 6px; border: 1px solid var(--_border); border-radius: 12px; background: var(--_surface); padding: 5px; }
      .op { position: relative; z-index: 2; display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; background: none; padding: 7px 9px; border-radius: 8px; cursor: pointer; color: var(--_fg); }
      .op i { display: block; width: 22px; height: 22px; flex: none; }
      .op b { font-weight: 500; font-size: 13px; font-family: var(--_mono); }
      .op b mark { background: none; color: var(--_accent); font-weight: 700; }
      .op span { margin-left: auto; font-size: 11.5px; color: var(--_muted); white-space: nowrap; }
      .hint { display: grid; font-size: 12px; color: var(--_muted); margin-top: 6px; }
      .hint .roll { white-space: normal; }
      `,
      `<label class="lab" for="ta"></label><div class="wr"><canvas class="px" aria-hidden="true"></canvas><div class="f"><div class="mir" aria-hidden="true"></div><textarea id="ta" rows="3" spellcheck="false" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="menu" aria-describedby="hint"></textarea></div><div class="menu" id="menu" role="listbox" aria-label="Suggestions" hidden></div></div><span class="rollslot hint" id="hint"></span>`,
      2,
      0.72,
    );
    const ta = this.$("textarea");
    ta.addEventListener("input", (e) => {
      // the host fires its own `input` event with the text; keep the textarea's native one inside
      e.stopPropagation();
      this.scan();
      this.sync();
      this.emit<{ value: string }>("input", { value: ta.value });
    });
    ta.addEventListener("click", () => this.scan());
    ta.addEventListener("keyup", (e) => {
      if (!["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(e.key)) this.scan();
    });
    ta.addEventListener("scroll", () => this.kick());
    ta.addEventListener("blur", () =>
      setTimeout(() => {
        if (this.root.activeElement !== ta) this.close();
      }, 120),
    );
    ta.addEventListener("keydown", (e) => {
      if (this.q == null || !this.res.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.highlight((this.hi + (e.key === "ArrowDown" ? 1 : -1) + this.res.length) % this.res.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        this.pick(this.hi);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  /** The textarea text. Setting it replaces the text and updates the chips and form value without firing events. */
  get value(): string {
    return this.$("textarea").value;
  }

  set value(v: string) {
    this.$("textarea").value = v;
    this.sync();
  }

  protected override init(): void {
    this.syncLabels();
    this.defaultText = this.getAttribute("value") || "Can @grace look at @src/auth/session.ts before we ship?";
    this.$("textarea").value = this.defaultText;
    rollText(this.$(".hint"), "Type @ to mention · ↑↓ to choose · Enter to insert", 1, false);
    this.sync();
  }

  attributeChangedCallback(): void {
    if (this.initialized) this.syncLabels();
  }

  /** Restores the text from the first connect. */
  formResetCallback(): void {
    this.close();
    this.value = this.defaultText;
  }

  /** Disables the textarea while the element or its fieldset is disabled. */
  override formDisabledCallback(disabled: boolean): void {
    super.formDisabledCallback(disabled);
    if (disabled) this.close();
    this.$("textarea").disabled = disabled;
  }

  /** The visible label (which names the textarea) and the placeholder. */
  private syncLabels(): void {
    this.$(".lab").textContent = this.getAttribute("label") || "Message";
    this.$("textarea").placeholder = this.getAttribute("placeholder") || "Type @ to mention a file, person or agent";
  }

  /** Open, filter or close the list from the `@query` before the caret. */
  private scan(): void {
    const ta = this.$("textarea");
    const before = ta.value.slice(0, ta.selectionStart);
    const m = /(^|\s)@([\w./-]*)$/.exec(before);
    if (!m) {
      this.close();
      return;
    }
    const q = m[2].toLowerCase();
    const res = MENTIONS.filter(
      (o) => o.value.toLowerCase().includes(q) || o.description.toLowerCase().includes(q),
    ).slice(0, 5);
    const wasOpen = this.q != null;
    this.q = q;
    this.res = res;
    if (!wasOpen) {
      this.hi = 0;
      this.openT = now();
    }
    this.hi = Math.min(this.hi, Math.max(0, res.length - 1));
    this.paint();
  }

  /** Highlight suggestion `k`: the textarea points at it with `aria-activedescendant`. */
  private highlight(k: number): void {
    this.hi = k;
    this.$$(".op").forEach((op, i) => op.setAttribute("aria-selected", String(i === k)));
    const ta = this.$("textarea");
    if (this.res[k]) ta.setAttribute("aria-activedescendant", `op-${k}`);
    else ta.removeAttribute("aria-activedescendant");
    this.kick();
  }

  /** Render the suggestion list with the matched letters marked. */
  private paint(): void {
    const menu = this.$(".menu");
    const q = this.q || "";
    menu.hidden = !this.res.length;
    menu.innerHTML = this.res
      .map((o, k) => {
        const i = o.value.toLowerCase().indexOf(q);
        const label =
          i >= 0 && q
            ? `${escapeHtml(o.value.slice(0, i))}<mark>${escapeHtml(o.value.slice(i, i + q.length))}</mark>${escapeHtml(o.value.slice(i + q.length))}`
            : escapeHtml(o.value);
        return `<button class="op" type="button" role="option" id="op-${k}" data-k="${k}" data-kind="${o.kind}" aria-selected="${k === this.hi}" tabindex="-1"><i></i><b>@${label}</b><span>${escapeHtml(o.description)}</span></button>`;
      })
      .join("");
    this.$$(".op").forEach((button) => {
      button.addEventListener("pointerdown", (e) => {
        // keep the focus in the textarea
        e.preventDefault();
        this.pick(Number(button.dataset.k));
      });
      button.addEventListener("pointerenter", () => this.highlight(Number(button.dataset.k)));
    });
    this.highlight(this.hi);
  }

  private close(): void {
    if (this.q == null) return;
    this.q = null;
    this.res = [];
    this.$(".menu").hidden = true;
    this.$("textarea").removeAttribute("aria-activedescendant");
    this.kick();
  }

  /** Replace the `@query` before the caret with suggestion `k`. */
  private pick(k: number): void {
    const o = this.res[k];
    if (!o) return;
    const ta = this.$("textarea");
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const after = ta.value.slice(pos);
    const replaced = before.replace(/@([\w./-]*)$/, `@${o.value} `);
    ta.value = replaced + after;
    ta.selectionStart = ta.selectionEnd = replaced.length;
    ta.focus();
    this.flash.set(`@${o.value}`, now());
    this.close();
    this.sync();
    this.emit<{ value: string }>("mention", { value: o.value });
    this.emit<{ value: string }>("input", { value: ta.value });
    rollText(this.$(".hint"), `Mentioned @${o.value}`, 1, true);
  }

  /** Mirror the text with known mentions wrapped in spans, grow the textarea and submit the text. */
  private sync(): void {
    const ta = this.$("textarea");
    const txt = ta.value;
    const known = new Set(MENTIONS.map((o) => `@${o.value}`));
    let html = "";
    let last = 0;
    const re = /@[\w./-]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) {
      if (!known.has(m[0])) continue;
      html +=
        escapeHtml(txt.slice(last, m.index)) +
        `<span class="m" data-v="${escapeHtml(m[0])}">${escapeHtml(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    // the zero-width space keeps a trailing line break measurable
    this.$(".mir").innerHTML = html + escapeHtml(txt.slice(last)) + "​";
    ta.style.height = "auto";
    ta.style.height = `${Math.max(92, ta.scrollHeight)}px`;
    this.setFormValue(txt);
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const pitch = F.pitch;
    const local = boxMapper(canvas);
    const ta = this.$("textarea");
    let busy = false;
    F.clear();
    const mirror = this.$(".mir");
    mirror.scrollTop = ta.scrollTop;
    const fr = this.$(".f").getBoundingClientRect();
    // mention chips, drawn under the mirrored spans
    for (const span of mirror.querySelectorAll<HTMLElement>(".m")) {
      const flashedAt = this.flash.get(span.dataset.v ?? "");
      const fl = flashedAt !== undefined ? clamp(1 - (t - flashedAt) / 0.8, 0, 1) : 0;
      if (fl > 0) busy = true;
      for (const r of span.getClientRects()) {
        if (r.bottom > fr.bottom || r.top < fr.top) continue;
        const box = local(r);
        const x0 = box.x - 3;
        const y0 = box.y + 1;
        const w = box.w + 6;
        const h = box.h - 2;
        for (let j = Math.floor(y0 / pitch); j < (y0 + h) / pitch; j++) {
          for (let i = Math.floor(x0 / pitch); i < (x0 + w) / pitch; i++) {
            const [x, y] = F.xy(i, j);
            const lx = x - x0;
            const ly = y - y0;
            if (inRR(lx, ly, w, h, 5) > 0) continue;
            const under = ly > h - 2.2;
            const sweep = fl > 0 && Math.abs(lx / w - (1 - fl)) < 0.12;
            if (!under && !sweep && bayer(i, j) > 0.34 + fl * 0.4) continue;
            F.put(
              i,
              j,
              under || sweep
                ? mix(P.accent, P.shine, 0.3 + fl * 0.4)
                : mix(P.accent, P.surface, this.dark ? 0.55 : 0.68),
              0.9,
              under ? 0.25 + fl * 0.5 : fl * 0.5,
            );
          }
        }
      }
    }
    const menu = this.$(".menu");
    if (!menu.hidden) {
      const mr = local(menu.getBoundingClientRect());
      const ops = this.$$(".op");
      const op: HTMLElement | undefined = ops[this.hi];
      if (op) {
        const orr = local(op.getBoundingClientRect());
        const ty = orr.y - mr.y;
        if (reducedMotion || t - this.openT < 0.02) {
          this.hy = ty;
          this.vy = 0;
        } else {
          const k = 420;
          const damping = 2 * Math.sqrt(k) * 0.8;
          this.vy += (k * (ty - this.hy) - damping * this.vy) * dt;
          this.hy += this.vy * dt;
        }
        if (Math.abs(ty - this.hy) > 0.3) busy = true;
        // highlight slab
        const x0 = orr.x;
        const y0 = mr.y + this.hy;
        const w = orr.w;
        const h = orr.h;
        for (let j = Math.floor(y0 / pitch); j < (y0 + h) / pitch; j++) {
          for (let i = Math.floor(x0 / pitch); i < (x0 + w) / pitch; i++) {
            const [x, y] = F.xy(i, j);
            const lx = x - x0;
            const ly = y - y0;
            if (inRR(lx, ly, w, h, 8) > 0) continue;
            const bar = lx < 3;
            if (!bar && bayer(i, j) > 0.3) continue;
            F.put(
              i,
              j,
              bar ? mix(P.accent, P.shine, 0.3) : mix(P.accent, P.surface, 0.55),
              bar ? 1 : 0.7,
              bar ? 0.6 : 0,
            );
          }
        }
      }
      // kind icons: file / person / agent
      ops.forEach((o) => {
        const ir = local(o.querySelector("i")!.getBoundingClientRect());
        const cx = ir.x + 11;
        const cy = ir.y + 11;
        const kind = o.dataset.kind;
        for (let j = Math.floor((cy - 11) / pitch); j <= (cy + 11) / pitch; j++) {
          for (let i = Math.floor((cx - 11) / pitch); i <= (cx + 11) / pitch; i++) {
            const [x, y] = F.xy(i, j);
            const dx = x - cx;
            const dy = y - cy;
            let on = false;
            let c = P.muted;
            if (kind === "p") {
              // a disc in a colour from the name, with a head and shoulders cut out
              on = Math.hypot(dx, dy) < 10;
              c = hsl(strHash(o.textContent ?? "") % 360, 0.5, this.dark ? 0.6 : 0.55);
              const figure = Math.hypot(dx, dy + 3) < 3.5 || (dy > 3 && Math.abs(dx) < 6 - (dy - 3) * 0.2 && dy < 8);
              if (on && figure) c = WHITE;
            } else if (kind === "f") {
              // a page with a folded corner and text lines
              on = Math.abs(dx) < 7 && Math.abs(dy) < 9 && !(dx > 3 && dy < -5 && dx - 3 > dy + 9 - 4);
              if (on && Math.abs(dy) % 4 < 1.5 && Math.abs(dx) < 4 && dy > -5) c = P.surface;
            } else {
              on = sparkSdf2(dx, dy, 9) < 1;
              c = P.accent;
            }
            if (on) F.put(i, j, c, 1, kind === "a" ? 0.5 : 0);
          }
        }
      });
    }
    this.flush(0.75, 4);
    return busy;
  }
}

define("hf-mention", HMention);

declare global {
  interface HTMLElementTagNameMap {
    "hf-mention": HMention;
  }
}

export { HMention };
