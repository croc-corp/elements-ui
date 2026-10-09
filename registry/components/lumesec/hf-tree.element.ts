/**
 * <hf-tree> · Changed files
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/tree
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-tree.tsx.
 */
import { HF, bayer, boxMapper, clamp, define, escapeHtml, inRR, mix, now, reduced } from "@/lib/lumesec/pixel";

/** Status of a changed file: `M` modified, `A` added, `D` deleted. */
export type TreeStatus = "M" | "A" | "D";

/** A changed path parsed from the `paths` attribute. */
export interface TreeEntry {
  /** File path; folders come from its `/` segments. */
  path: string;
  /** `M` (modified), `A` (added), `D` (deleted) or an empty string. */
  st: TreeStatus | "";
}

/** Events fired by `<hf-tree>`. */
export interface HTreeEventMap {
  /** The user selected a row by click or keyboard. `file` is `false` for folders. */
  select: CustomEvent<{ path: string; file: boolean }>;
}

const DEFAULT_PATHS =
  "src/auth/session.ts:M,src/auth/token.ts:A,src/auth/legacy.ts:D,src/api/client.ts:M,src/api/routes.ts,src/ui/composer.tsx:M,src/ui/theme.ts,tests/auth.spec.ts:A,docs/README.md:M,package.json:M,tsconfig.json";

const STATUS_TITLE: Readonly<Record<TreeStatus, string>> = { M: "Modified", A: "Added", D: "Deleted" };

const isStatus = (value: string): value is TreeStatus => value === "M" || value === "A" || value === "D";

/** `path`, optionally followed by `:` and a one-letter status. */
const ENTRY = /^(.*?)(?::([A-Za-z]?))?$/;

/**
 * One `path:M` entry. The status is upper-cased and validated, because it ends up in markup; a letter other than
 * M, A or D leaves the file without a status.
 */
function parseEntry(item: string): TreeEntry {
  const [, path = "", mark = ""] = ENTRY.exec(item.trim()) ?? [];
  const st = mark.toUpperCase();
  return { path: path.trim(), st: isStatus(st) ? st : "" };
}

/** A file or folder of the tree. */
interface TreeNode {
  name: string;
  path: string;
  kids: Map<string, TreeNode>;
  /** Status of a file; null for folders. */
  st: TreeStatus | "" | null;
  file: boolean;
  /** Changed files at or below this node. */
  changes: number;
}

/** A visible row: a node, its nesting depth and its position among its visible siblings. */
interface TreeRow {
  node: TreeNode;
  depth: number;
  /** 1-based position among the visible siblings, for `aria-posinset`. */
  pos: number;
  /** Number of visible siblings, for `aria-setsize`. */
  size: number;
}

const createNode = (name: string, path: string, file: boolean, st: TreeStatus | "" | null): TreeNode => ({
  name,
  path,
  kids: new Map(),
  st,
  file,
  changes: 0,
});

/** Count the changed files below `node` and store the count on every folder. */
function countChanges(node: TreeNode): number {
  let count = node.file ? (node.st ? 1 : 0) : 0;
  for (const kid of node.kids.values()) count += countChanges(kid);
  node.changes = count;
  return count;
}

/** Changed-files tree built from a path list; folders count their changes and arrow keys follow the tree pattern. */
class HTree extends HF {
  static readonly observedAttributes = ["paths"] as const;

  /** Paths of the expanded folders. */
  private readonly expanded = new Set<string>();
  private selected: string | null = null;
  /** Spring-animated top of the selection highlight, and its velocity. */
  private highlightY = 0;
  private highlightV = 0;
  private rows: TreeRow[] = [];
  private changedOnly = false;
  private selectedAt = -9;
  /** Time of the last rebuild; fresh rows get a scan line. */
  private builtAt = 0;
  private top: TreeNode = createNode("", "", false, null);
  private readonly tree = this.$('[role="tree"]');
  private readonly filterButton = this.$<HTMLButtonElement>(".fl");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; font-size: 12.5px; }
      .hd b { font-weight: 600; font-size: 13.5px; }
      .box { position: relative; border: 1px solid var(--_border); border-radius: 12px; background: var(--_surface); padding: 6px; }
      canvas.px { position: absolute; inset: 0; height: 100%; pointer-events: none; }
      [role="tree"] { position: relative; outline: none; }
      .r { position: relative; display: flex; align-items: center; gap: 7px; height: 28px; padding-right: 8px; border-radius: 7px; cursor: pointer; font-size: 13px; white-space: nowrap; animation: rin .28s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes rin { from { opacity: 0; transform: translateX(-6px); } }
      .r .ic { width: 16px; height: 16px; flex: none; }
      .r .nm { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
      .r.dir .nm { font-weight: 500; }
      .r .bd { margin-left: auto; font-family: var(--_mono); font-size: 11px; font-weight: 700; width: 14px; text-align: center; }
      .r .bd.M { color: var(--_warn); } .r .bd.A { color: var(--_ok); } .r .bd.D { color: var(--_danger); }
      .r.D .nm { text-decoration: line-through; color: var(--_muted); }
      .r .cnt { margin-left: auto; font-size: 11px; color: var(--_muted); }
      .r:focus-visible { outline: 2px solid var(--_accent); outline-offset: -2px; }
      @media (prefers-reduced-motion: reduce) { .r { animation: none; } }
      `,
      `<div class="hd"><b class="ti" id="ti"></b><button class="pbtn fl" type="button" aria-pressed="false">Changed only</button></div><div class="box"><canvas class="px" aria-hidden="true"></canvas><div role="tree" aria-labelledby="ti"></div></div>`,
      2,
      0.72,
    );
    this.filterButton.addEventListener("click", () => {
      this.changedOnly = !this.changedOnly;
      this.filterButton.setAttribute("aria-pressed", String(this.changedOnly));
      this.build();
    });
    this.tree.addEventListener("click", (e) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(".r") : null;
      const row = el ? this.rows[Number(el.dataset.k)] : undefined;
      if (!row) return;
      if (!row.node.file) this.toggleDir(row.node.path);
      this.select(row.node.path, true);
    });
    this.tree.addEventListener("keydown", (e) => this.key(e));
  }

  /** The parsed `paths`; `st` is `M`, `A`, `D` or an empty string. Entries without a path are skipped. */
  get entries(): TreeEntry[] {
    return (this.getAttribute("paths") || DEFAULT_PATHS)
      .split(",")
      .map(parseEntry)
      .filter((entry) => entry.path !== "");
  }

  protected override init(): void {
    this.load();
  }

  attributeChangedCallback(): void {
    if (this.initialized) this.load();
  }

  /** Build the tree from `paths`; the expanded folders and the selection are kept where they still exist. */
  private load(): void {
    const root = createNode("", "", false, null);
    for (const entry of this.entries) {
      let node = root;
      const parts = entry.path.split("/").filter(Boolean);
      parts.forEach((part, k) => {
        const path = parts.slice(0, k + 1).join("/");
        const last = k === parts.length - 1;
        let kid = node.kids.get(part);
        if (!kid) {
          kid = createNode(part, path, last, last ? entry.st : null);
          node.kids.set(part, kid);
        }
        node = kid;
      });
    }
    this.top = root;
    countChanges(root);
    // folders that contain changes start expanded
    const expandChanged = (node: TreeNode): void => {
      for (const kid of node.kids.values()) {
        if (!kid.file && kid.changes) {
          this.expanded.add(kid.path);
          expandChanged(kid);
        }
      }
    };
    expandChanged(root);
    const n = root.changes;
    this.$(".ti").textContent = `${n} ${n === 1 ? "file" : "files"} changed`;
    this.build();
    const keep = this.rows.some((row) => row.node.path === this.selected);
    this.select(keep ? this.selected : this.rows.find((row) => row.node.st)?.node.path, false);
  }

  /** Flatten the visible part of the tree into rows and render them. */
  private build(): void {
    const out: TreeRow[] = [];
    const walk = (node: TreeNode, depth: number): void => {
      const kids = [...node.kids.values()]
        .filter((kid) => !this.changedOnly || kid.changes > 0)
        .sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
      kids.forEach((kid, k) => {
        out.push({ node: kid, depth, pos: k + 1, size: kids.length });
        if (!kid.file && this.expanded.has(kid.path)) walk(kid, depth + 1);
      });
    };
    walk(this.top, 0);
    const previous = new Set(this.rows.map((row) => row.node.path));
    this.rows = out;
    const tree = this.tree;
    tree.innerHTML = out.map((row, k) => this.rowHtml(row, k, previous.has(row.node.path))).join("");
    const first = tree.firstElementChild;
    if (!tree.querySelector('[tabindex="0"]') && first instanceof HTMLElement) first.tabIndex = 0;
    this.builtAt = now();
    this.kick();
  }

  /** Markup of one row; rows that were already visible skip the slide-in. */
  private rowHtml(row: TreeRow, k: number, seen: boolean): string {
    const { node, depth } = row;
    const isSelected = node.path === this.selected;
    const expanded = node.file ? "" : ` aria-expanded="${this.expanded.has(node.path)}"`;
    let trailing = "";
    if (node.file) {
      if (node.st) trailing = `<span class="bd ${node.st}" title="${STATUS_TITLE[node.st]}">${node.st}</span>`;
    } else if (node.changes) {
      trailing = `<span class="cnt">${node.changes}</span>`;
    }
    return (
      `<div class="r ${node.file ? "file" : "dir"} ${node.st || ""}" role="treeitem" data-k="${k}" aria-level="${depth + 1}" aria-posinset="${row.pos}" aria-setsize="${row.size}"${expanded} aria-selected="${isSelected}" tabindex="${isSelected ? 0 : -1}" style="padding-left:${10 + depth * 16}px;${seen ? "animation:none" : ""}">` +
      `<span class="ic"></span><span class="nm">${escapeHtml(node.name)}</span>${trailing}</div>`
    );
  }

  private rowPath(el: HTMLElement): string {
    return this.rows[Number(el.dataset.k)].node.path;
  }

  private toggleDir(path: string, force?: boolean): void {
    const open = force ?? !this.expanded.has(path);
    if (open) this.expanded.add(path);
    else this.expanded.delete(path);
    this.build();
    this.$$(".r")
      .find((el) => this.rowPath(el) === path)
      ?.focus();
  }

  private select(path: string | null | undefined, user: boolean): void {
    if (!path) return;
    this.selected = path;
    this.selectedAt = now();
    this.$$(".r").forEach((el) => {
      const on = this.rowPath(el) === path;
      el.setAttribute("aria-selected", String(on));
      el.tabIndex = on ? 0 : -1;
    });
    if (user) {
      const file = this.rows.find((row) => row.node.path === path)?.node.file ?? false;
      this.emit<{ path: string; file: boolean }>("select", { path, file });
    }
    this.kick();
  }

  /** Keyboard handling of the WAI-ARIA tree view pattern; selection follows focus. */
  private key(e: KeyboardEvent): void {
    const els = this.$$(".r");
    const i = els.findIndex((el) => el === this.root.activeElement);
    if (i < 0) return;
    const row = this.rows[i];
    const isOpenDir = !row.node.file && this.expanded.has(row.node.path);
    let j = i;
    switch (e.key) {
      case "ArrowDown":
        j = Math.min(els.length - 1, i + 1);
        break;
      case "ArrowUp":
        j = Math.max(0, i - 1);
        break;
      case "Home":
        j = 0;
        break;
      case "End":
        j = els.length - 1;
        break;
      case "ArrowRight":
        e.preventDefault();
        if (!row.node.file && !isOpenDir) {
          this.toggleDir(row.node.path, true);
          return;
        }
        // an open folder moves to its first child; a file stays
        if (!isOpenDir || this.rows[i + 1]?.depth !== row.depth + 1) return;
        j = i + 1;
        break;
      case "ArrowLeft":
        if (isOpenDir) {
          e.preventDefault();
          this.toggleDir(row.node.path, false);
          return;
        }
        // move to the parent folder
        for (let q = i - 1; q >= 0; q--) {
          if (this.rows[q].depth < row.depth) {
            j = q;
            break;
          }
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (!row.node.file) this.toggleDir(row.node.path);
        this.select(row.node.path, true);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (j === i) return;
    this.select(this.rows[j].node.path, true);
    els[j].focus();
  }

  protected override render(t: number, dt: number): boolean {
    const canvas = this.cv;
    if (!canvas) return false;
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    const local = boxMapper(canvas);
    const els = this.$$(".r");
    let busy = false;
    F.clear();
    const si = this.rows.findIndex((row) => row.node.path === this.selected);
    if (si >= 0 && els[si]) {
      const r = local(els[si]);
      const ty = r.y;
      if (R0 || (t - this.selectedAt > 5 && Math.abs(ty - this.highlightY) > 40)) {
        this.highlightY = ty;
        this.highlightV = 0;
      } else {
        // damped spring towards the selected row
        const k = 380;
        const c = 2 * Math.sqrt(k) * 0.8;
        this.highlightV += (k * (ty - this.highlightY) - c * this.highlightV) * dt;
        this.highlightY += this.highlightV * dt;
      }
      if (Math.abs(ty - this.highlightY) > 0.3) busy = true;
      const x0 = r.x;
      const w = r.w;
      const h = r.h;
      const y0 = this.highlightY;
      const flash = clamp(1 - (t - this.selectedAt) / 0.5, 0, 1);
      if (flash > 0) busy = true;
      for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < (x0 + w) / pp; i++) {
          const [x, y] = F.xy(i, j);
          const lx = x - x0;
          const ly = y - y0;
          if (inRR(lx, ly, w, h, 7) > 0) continue;
          const bar = lx < 3;
          if (!bar && bayer(i, j) > 0.32 + flash * 0.3) continue;
          F.put(
            i,
            j,
            bar ? mix(P.accent, P.shine, 0.3) : mix(P.accent, P.surface, 0.55),
            bar ? 1 : 0.75,
            bar ? 0.6 : flash * 0.3,
          );
        }
      }
    }
    els.forEach((el, k) => {
      const row = this.rows[k];
      const r = local(el);
      const y0 = r.y;
      const h = r.h;
      const ic = local(el.querySelector(".ic")!);
      const ix = ic.x;
      const iy = ic.y;
      // guide lines
      for (let d = 0; d < row.depth; d++) {
        const gx = r.x + 10 + d * 16 + 7;
        for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
          if (j % 2 === 0) F.put(Math.round(gx / pp), j, P.muted, 0.32);
        }
      }
      // pixel icons: folder or file, tinted by status
      const st = row.node.st;
      const tint = st === "M" ? P.warn : st === "A" ? P.ok : st === "D" ? P.danger : P.muted;
      const open = this.expanded.has(row.node.path);
      for (let j = Math.floor(iy / pp); j < (iy + 16) / pp; j++) {
        for (let i = Math.floor(ix / pp); i < (ix + 16) / pp; i++) {
          const [x, y] = F.xy(i, j);
          const lx = x - ix;
          const ly = y - iy;
          let on = false;
          if (row.node.file) {
            // page with a folded corner and text lines
            on = lx > 3 && lx < 13 && ly > 1 && ly < 15 && !(lx > 9.5 && ly < 5.5 && lx - 9.5 > ly - 1);
            if (on && lx > 5 && lx < 11 && ly > 7 && Math.round(ly) % 3 === 0) on = false;
          } else {
            // folder body and tab; an open folder shows a gap
            on = (lx > 1 && lx < 15 && ly > 4 && ly < 14) || (lx > 1 && lx < 7 && ly > 2.5 && ly <= 4);
            if (open && on && ly > 7 && ly < 8.8) on = false;
          }
          if (on) {
            const color = row.node.file ? tint : mix(P.accent, P.muted, row.node.changes ? 0.2 : 0.75);
            F.put(i, j, color, 1, st ? 0.2 : 0);
          }
        }
      }
      // fresh rows get a quick scan
      if (!R0 && t - this.builtAt < 0.35 && el.style.animation === "") {
        busy = true;
        const u = (t - this.builtAt) / 0.35;
        for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
          const i = Math.round((r.x + u * r.w) / pp);
          F.put(i, j, P.accent, 1 - u, 0.8);
          F.put(i - 1, j, P.accent, (1 - u) * 0.5, 0.4);
        }
      }
    });
    this.flush(0.7, 4);
    return busy;
  }
}

define("hf-tree", HTree);

export { HTree };

declare global {
  interface HTMLElementTagNameMap {
    "hf-tree": HTree;
  }
}
