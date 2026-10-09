/**
 * <hf-diff> · Diff review
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/diff
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-diff.tsx.
 */
import {
  HF,
  bayer,
  boxMapper,
  clamp,
  define,
  escapeHtml,
  h2,
  mix,
  now,
  reduced,
  rollText,
  type RGB,
} from "@/lib/lumesec/pixel";

/** Detail of the `resolve` event. */
export interface HDiffResolveDetail {
  /** Zero-based index of the hunk. */
  hunk: number;
  accepted: boolean;
}

/** Events fired by `<hf-diff>`. */
export interface HDiffEventMap {
  /** Fires when a hunk is accepted or rejected. Accept all fires once per open hunk. */
  resolve: CustomEvent<HDiffResolveDetail>;
}

const DIFF_SAMPLE = `--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -12,7 +12,9 @@ export async function refresh(session) {
   const token = session.token;
-  if (Date.now() > token.expires) {
-    return login();
+  if (isExpired(token, { skewMs: 30_000 })) {
+    const next = await rotate(token);
+    audit.log('token.rotated', { user: session.user });
+    return next;
   }
   return token;
 }
@@ -41,5 +43,6 @@ export function isExpired(token, opts = {}) {
   const skew = opts.skewMs ?? 0;
-  return Date.now() > token.expires;
+  const now = Date.now();
+  return now + skew > token.expires;
 }`;

type LineType = "add" | "del" | "ctx";

/** A diff line as parsed. Line numbers are empty on the side the line does not exist. */
interface ParsedLine {
  ty: LineType;
  txt: string;
  /** Old line number. */
  o: number | "";
  /** New line number. */
  n: number | "";
}

/** A hunk as parsed: its `@@` header and the context text after it. */
interface ParsedHunk {
  head: string;
  ctx: string;
  lines: ParsedLine[];
}

interface DiffLine extends ParsedLine {
  /** The rendered row. */
  el: HTMLElement;
  /** Time the line started to dissolve, after its hunk dropped it. */
  dying?: number;
  /** Time the line was kept; its tint fades out. */
  kept?: number;
}

interface Hunk {
  head: string;
  ctx: string;
  lines: DiffLine[];
  /** `ok` once accepted, `no` once rejected. */
  res: "ok" | "no" | null;
  /** The rendered header row. */
  el: HTMLElement;
}

const WHITE: RGB = [255, 255, 255];

/** Parse a unified diff for one file: the last `+++` path and the hunks with numbered lines. */
function parseDiff(src: readonly string[]): { file: string; hunks: ParsedHunk[] } {
  let file = "file";
  let cur: ParsedHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  const hunks: ParsedHunk[] = [];
  for (const l of src) {
    if (l.startsWith("+++ ")) {
      file = l.slice(4).replace(/^b\//, "");
      continue;
    }
    // `\ No newline at end of file` annotates the line before it; it is not part of either file
    if (l.startsWith("--- ") || l.startsWith("\\")) continue;
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(l);
    if (m) {
      cur = { head: l, ctx: m[3], lines: [] };
      hunks.push(cur);
      oldNo = +m[1];
      newNo = +m[2];
      continue;
    }
    if (!cur) continue;
    const ty: LineType = l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx";
    cur.lines.push({ ty, txt: l.slice(1), o: ty !== "add" ? oldNo++ : "", n: ty !== "del" ? newNo++ : "" });
  }
  return { file, hunks };
}

/** Unified diff reviewer with dithered add and remove tints and a minimap; resolving a hunk dissolves dropped lines. */
class HDiff extends HF {
  private hunks: Hunk[] = [];
  /** Follows the text content, so a new diff (a React child, for example) replaces the review. */
  private readonly textObserver = new MutationObserver(() => this.build());

  constructor() {
    super(
      `
      :host { display: block; }
      .box { border: 1px solid var(--_border); border-radius: 12px; background: var(--_surface); overflow: hidden; }
      .hd { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--_border); font-size: 12.5px; }
      .fn { font-family: var(--_mono); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      .st { font-family: var(--_mono); font-size: 12px; display: inline-flex; gap: 6px; }
      .st .a { color: var(--_ok); } .st .d { color: var(--_danger); }
      .hd .pbtn { margin-left: auto; height: 28px; }
      .bw { position: relative; }
      /* the canvas covers the visible width, so tints and minimap stay put while long lines scroll */
      canvas.px { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
      .body { position: relative; overflow-x: auto; container-type: inline-size; }
      .code { position: relative; font-family: var(--_mono); font-size: 12px; line-height: 20px; min-width: max-content; padding-right: 18px; }
      .hk { position: sticky; left: 0; width: 100cqw; display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px 0 12px; color: var(--_muted); font-size: 11.5px; border-top: 1px solid var(--_border); }
      .hk:first-child { border-top: 0; }
      .hk span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hk .bt { margin-left: auto; display: flex; flex: none; gap: 6px; }
      .hk button { height: 24px; padding: 0 9px; border-radius: 6px; border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); font-size: 11.5px; font-weight: 600; cursor: pointer; }
      .hk button.ok { color: var(--_ok); } .hk button.no { color: var(--_danger); }
      .hk.res .bt { display: none; }
      .ln { display: flex; white-space: pre; overflow: hidden; max-height: 20px; transition: max-height .35s cubic-bezier(.2,.8,.2,1) .25s, opacity .3s .2s; }
      .ln.gone { max-height: 0; opacity: 0; }
      .ln i { width: 34px; flex: none; text-align: right; padding-right: 8px; color: var(--_muted); font-style: normal; opacity: .7; user-select: none; }
      .ln b { width: 16px; flex: none; text-align: center; font-weight: 400; color: var(--_muted); }
      .ln.add b { color: var(--_ok); } .ln.del b { color: var(--_danger); }
      .ln.del span { opacity: .8; }
      @media (prefers-reduced-motion: reduce) { .ln { transition: none; } }
      `,
      `<div class="box"><div class="hd"><span class="fn"></span><span class="st"><span class="a rollslot"></span><span class="d rollslot"></span></span><button class="pbtn all" type="button">Accept all</button></div><div class="bw"><canvas class="px" aria-hidden="true"></canvas><div class="body"><div class="code" role="table" tabindex="-1"></div></div></div></div>`,
      2,
      0.72,
    );
    const all = this.$<HTMLButtonElement>(".all");
    all.addEventListener("click", () => {
      // Accept all disables itself; keep keyboard focus in the review
      const hadFocus = this.root.activeElement === all;
      this.hunks.forEach((h, k) => {
        if (!h.res) this.resolve(k, true);
      });
      if (hadFocus) this.$(".code").focus();
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.textObserver.observe(this, { childList: true, characterData: true, subtree: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.textObserver.disconnect();
  }

  protected override init(): void {
    this.build();
  }

  /** Parse the text content (or the sample) and render the review; every hunk starts open. */
  private build(): void {
    const { file, hunks } = parseDiff((this.textContent.trim() || DIFF_SAMPLE).split(/\r?\n/));
    this.$(".fn").textContent = file;
    const code = this.$(".code");
    code.setAttribute("aria-label", `Changes to ${file}`);
    const sign = (ty: LineType): string => (ty === "add" ? "+" : ty === "del" ? "−" : " ");
    // every interpolated text is escaped: the diff is content from the page
    code.innerHTML = hunks
      .map(
        (h, k) =>
          `<div class="hk" data-k="${k}" role="row"><span role="cell" aria-colspan="3">${escapeHtml(h.head.replace(/ @@.*/, " @@"))} ${escapeHtml(h.ctx)}</span><span class="bt" role="cell"><button type="button" class="ok" aria-label="Accept hunk ${k + 1}">Accept</button><button type="button" class="no" aria-label="Reject hunk ${k + 1}">Reject</button></span></div>` +
          h.lines
            .map(
              (l) =>
                `<div class="ln ${l.ty}" role="row"><i role="cell">${l.o}</i><i role="cell">${l.n}</i><b role="cell">${sign(l.ty)}</b><span role="cell">${escapeHtml(l.txt) || " "}</span></div>`,
            )
            .join(""),
      )
      .join("");
    // each header row is followed by the rows of its lines
    const lineRows = this.$$(".ln");
    let row = 0;
    this.hunks = hunks.map((h, k) => ({
      head: h.head,
      ctx: h.ctx,
      res: null,
      el: this.$(`.hk[data-k="${k}"]`),
      lines: h.lines.map((l) => ({ ...l, el: lineRows[row++] })),
    }));
    this.hunks.forEach((_, k) => {
      this.$(`.hk[data-k="${k}"] .ok`).addEventListener("click", () => this.resolve(k, true));
      this.$(`.hk[data-k="${k}"] .no`).addEventListener("click", () => this.resolve(k, false));
    });
    this.stats(false);
    this.kick();
  }

  /** Roll the added and removed line counts of the open hunks, and update Accept all. */
  private stats(animate: boolean): void {
    let added = 0;
    let removed = 0;
    for (const h of this.hunks) {
      if (h.res) continue;
      for (const l of h.lines) {
        if (l.ty === "add") added++;
        if (l.ty === "del") removed++;
      }
    }
    rollText(this.$(".a"), `+${added}`, -1, animate);
    rollText(this.$(".d"), `−${removed}`, -1, animate);
    const left = this.hunks.filter((h) => !h.res).length;
    const all = this.$<HTMLButtonElement>(".all");
    all.disabled = !left;
    all.textContent = left ? "Accept all" : "All resolved";
  }

  /**
   * Accepts or rejects a hunk by index, as its buttons do. Ignored if the hunk is already resolved or does not
   * exist.
   */
  resolve(index: number, accept: boolean): void {
    const h = this.hunks.at(index);
    if (!h || index < 0 || h.res) return;
    // the hunk's buttons are about to be hidden
    const hadFocus = h.el.contains(this.root.activeElement);
    h.res = accept ? "ok" : "no";
    h.el.classList.add("res");
    const label = h.el.querySelector("span");
    if (label) label.textContent = accept ? `✓ Accepted · ${h.ctx}` : `✕ Rejected · ${h.ctx}`;
    h.el.style.color = `var(--_${accept ? "ok" : "danger"})`;
    for (const l of h.lines) {
      // accepting drops the removed lines, rejecting the added ones
      const drop = accept ? l.ty === "del" : l.ty === "add";
      if (drop) {
        l.dying = now();
        l.el.classList.add("gone");
      } else if (l.ty !== "ctx") {
        l.kept = now();
        setTimeout(() => {
          l.el.className = "ln ctx";
          const mark = l.el.querySelector("b");
          if (mark) mark.textContent = " ";
        }, 450);
      }
    }
    this.stats(true);
    if (hadFocus) this.focusAfter(index);
    this.emit<HDiffResolveDetail>("resolve", { hunk: index, accepted: accept });
    this.kick();
  }

  /** Move focus to the Accept button of the next open hunk after `index`, or to the code when none is left. */
  private focusAfter(index: number): void {
    const n = this.hunks.length;
    for (let step = 1; step <= n; step++) {
      const next = this.hunks[(index + step) % n];
      if (!next.res) {
        next.el.querySelector<HTMLButtonElement>(".ok")?.focus();
        return;
      }
    }
    this.$(".code").focus();
  }

  protected override render(t: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const pitch = F.pitch;
    const local = boxMapper(canvas);
    const W = this.w;
    let busy = false;
    F.clear();
    for (const h of this.hunks) {
      for (const l of h.lines) {
        if (l.ty === "ctx") continue;
        const r = l.el.getBoundingClientRect();
        if (r.height < 1) continue;
        const { y: y0, h: hh } = local(r);
        const c = l.ty === "add" ? P.ok : P.danger;
        const dy = l.dying ? t - l.dying : -1;
        // a kept line's tint flares and fades; open hunks keep the base tint
        const kp = l.kept ? clamp(1 - (t - l.kept) / 0.6, 0, 1) : h.res ? 0 : 1;
        if (dy >= 0 && dy < 0.8) busy = true;
        if (l.kept && kp > 0) busy = true;
        if (l.kept && kp <= 0) continue;
        for (let j = Math.floor(y0 / pitch); j < (y0 + hh) / pitch; j++) {
          for (let i = 0; i < F.cols; i++) {
            const [x] = F.xy(i, j);
            const bar = x < 3;
            if (dy >= 0) {
              // dissolve to the right
              if (reducedMotion || dy > 0.7) continue;
              const thr = dy / 0.5 - (1 - x / W) * 0.6 + h2(i, j) * 0.3;
              if (thr > 1) continue;
              const off = Math.max(0, thr) * 30;
              F.plot(x + off, (j + 0.5) * pitch, mix(c, WHITE, 0.3), clamp(1 - thr, 0, 1) * 0.8, 0.4);
              continue;
            }
            if (!bar && bayer(i, j) > (l.kept ? 0.22 + kp * 0.3 : 0.22)) continue;
            F.put(
              i,
              j,
              c,
              bar ? 1 : (this.dark ? 0.32 : 0.24) + (l.kept ? kp * 0.5 : 0),
              bar ? 0.35 : l.kept ? kp * 0.6 : 0,
            );
          }
        }
      }
    }
    // minimap on the right edge
    const lines = this.hunks.flatMap((h) => h.lines);
    const n = lines.length;
    const ch = this.h;
    lines.forEach((l, k) => {
      if (l.ty === "ctx" || l.dying || (l.kept && t - l.kept > 0.6)) return;
      const y0 = (k / n) * ch;
      const y1 = ((k + 1) / n) * ch;
      for (let j = Math.floor(y0 / pitch); j < Math.max(y0 / pitch + 1, y1 / pitch); j++) {
        for (let i = Math.floor((W - 8) / pitch); i < (W - 3) / pitch; i++) {
          F.put(i, j, l.ty === "add" ? P.ok : P.danger, 0.9, 0.2);
        }
      }
    });
    this.flush(0.7, 4);
    return busy;
  }
}

define("hf-diff", HDiff);

declare global {
  interface HTMLElementTagNameMap {
    "hf-diff": HDiff;
  }
}

export { HDiff };
