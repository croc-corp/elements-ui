/**
 * <hf-graph> · Agent graph
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/graph
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-graph.tsx.
 *
 * Demo data: The agent graph, its labels and the run timings (partly random) are invented; only `label` and
 * `autoplay` can be set. It cannot show your own data yet; use it as a template and replace the invented data
 * before it shows anything real.
 */
import { HF, TAU, define, inRR, lerp, mix, now, reduced, rollText, type Point, type RGB } from "@/lib/lumesec/pixel";

/** Events fired by `<hf-graph>`. */
export interface HGraphEventMap {
  /** The reviewer finished a run. */
  done: CustomEvent<Record<string, never>>;
}

type NodeId = "orch" | "plan" | "code" | "test" | "docs" | "rev";

/** Run state of an agent node; also written to the node's `data-s` attribute. */
type NodeState = "idle" | "run" | "done";

/** An agent of the demo workflow, placed on a grid of columns and row offsets. */
interface NodeSpec {
  id: NodeId;
  label: string;
  /** Column (step) of the workflow, 0 to 3. */
  col: number;
  /** Offset from the middle row, -1 to 1. */
  row: number;
}

/** A node with its label element and layout position. */
interface GraphNode extends NodeSpec {
  el: HTMLSpanElement;
  s: NodeState;
  /** Time of the last state change. */
  t0: number;
  x: number;
  y: number;
}

/** One straight piece of an edge, with its distance from the edge start. */
interface EdgeSegment {
  from: Point;
  to: Point;
  start: number;
  length: number;
}

const NODES: readonly NodeSpec[] = [
  { id: "orch", label: "Lead agent", col: 0, row: 0 },
  { id: "plan", label: "Planner", col: 1, row: 0 },
  { id: "code", label: "Coder", col: 2, row: -1 },
  { id: "test", label: "Tester", col: 2, row: 0 },
  { id: "docs", label: "Docs", col: 2, row: 1 },
  { id: "rev", label: "Reviewer", col: 3, row: 0 },
];

const EDGES: readonly (readonly [from: NodeId, to: NodeId])[] = [
  ["orch", "plan"],
  ["plan", "code"],
  ["plan", "test"],
  ["plan", "docs"],
  ["code", "rev"],
  ["test", "rev"],
  ["docs", "rev"],
];

const PARALLEL: readonly NodeId[] = ["code", "test", "docs"];

const WHITE: RGB = [255, 255, 255];

/** Hidden text after a node's label, so its state does not rely on colour alone. */
const STATE_TEXT: Readonly<Record<NodeState, string>> = { idle: "", run: ", running", done: ", done" };

/** Agent workflow graph that plays a run from lead agent to reviewer, with light along live edges. */
class HGraph extends HF {
  static observedAttributes = ["label"];

  private readonly nodes = new Map<NodeId, GraphNode>();
  private running = false;
  /** Start of the current run. */
  private t0 = 0;
  /** Vertical layout, used below 520px; null before the first layout. */
  private vert: boolean | null = null;
  private readonly stage = this.$(".st");
  private readonly status = this.$(".me");
  private readonly runButton = this.$<HTMLButtonElement>(".go");

  constructor() {
    super(
      `
      :host { display: block; }
      .hd { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .hd b { font-weight: 600; font-size: 13.5px; }
      .me { margin-left: auto; justify-items: end; text-align: right; font-family: var(--_mono); font-size: 12px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      .me .roll { white-space: normal; }
      .st { position: relative; height: 196px; }
      canvas.px { position: absolute; inset: 0; height: 100%; }
      .nd { position: absolute; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 99px; border: 1px solid var(--_border); background: var(--_surface); font-size: 12.5px; font-weight: 500; white-space: nowrap; transition: border-color .3s, color .3s; }
      .nd i { width: 7px; height: 7px; border-radius: 50%; background: var(--_muted); transition: background .3s; }
      .nd[data-s="run"] { border-color: color-mix(in srgb, var(--_accent) 60%, var(--_border)); }
      .nd[data-s="run"] i { background: var(--_accent); }
      .nd[data-s="done"] i { background: var(--_ok); }
      .nd[data-s="idle"] { color: var(--_muted); }
      .go[aria-disabled="true"] { cursor: default; }
      @media (max-width: 460px) { .nd { padding: 0 8px; font-size: 11.5px; } }
      `,
      `<div class="hd"><b class="ti"></b><span class="me rollslot" aria-live="polite"></span><button class="pbtn go" type="button">Run</button></div><div class="st"><canvas class="px" aria-hidden="true"></canvas></div>`,
      2,
      0.72,
    );
    this.runButton.addEventListener("click", () => void this.run());
  }

  attributeChangedCallback(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Ultracode workflow";
  }

  protected override init(): void {
    this.$(".ti").textContent = this.getAttribute("label") || "Ultracode workflow";
    for (const spec of NODES) {
      const el = document.createElement("span");
      el.className = "nd";
      el.dataset.s = "idle";
      el.innerHTML = `<i></i>${spec.label}<span class="sr"></span>`;
      this.stage.append(el);
      this.nodes.set(spec.id, { ...spec, el, s: "idle", t0: -9, x: 0, y: 0 });
    }
    rollText(this.status, "Idle · 5 agents", 1, false);
    if (this.hasAttribute("autoplay")) setTimeout(() => void this.run(), 800);
  }

  protected override layout(): void {
    const W = this.w;
    const cols = 4;
    const vert = W < 520;
    if (vert !== this.vert) {
      this.vert = vert;
      this.stage.style.height = vert ? "262px" : "";
    }
    const H = this.h;
    if (vert) {
      const pad = 26;
      for (const n of this.nodes.values()) {
        n.y = pad + (n.col / (cols - 1)) * (H - 2 * pad);
        n.x = W / 2 + n.row * Math.min(110, W * 0.33);
        n.el.style.left = `${n.x}px`;
        n.el.style.top = `${n.y}px`;
      }
      return;
    }
    const pad = Math.min(80, W * 0.13);
    for (const n of this.nodes.values()) {
      n.x = pad + (n.col / (cols - 1)) * (W - 2 * pad);
      n.y = H / 2 + n.row * 62;
      n.el.style.left = `${n.x}px`;
      n.el.style.top = `${n.y}px`;
    }
  }

  private setNode(id: NodeId, state: NodeState): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.s = state;
    n.t0 = now();
    n.el.dataset.s = state;
    const stateText = n.el.querySelector(".sr");
    if (stateText) stateText.textContent = STATE_TEXT[state];
    this.kick();
  }

  /**
   * Plays one simulated run of about five seconds and resolves when it ends. Calls during a run return at once and
   * do nothing.
   */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.t0 = now();
    const go = this.runButton;
    // aria-disabled instead of disabled: a disabled button would drop keyboard focus to the page
    go.setAttribute("aria-disabled", "true");
    for (const id of this.nodes.keys()) this.setNode(id, "idle");
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, reduced() ? 60 : ms));
    const status = (text: string): void => rollText(this.status, text, 1, true);
    this.setNode("orch", "run");
    status("Orchestrating");
    await sleep(700);
    this.setNode("orch", "done");
    this.setNode("plan", "run");
    status("Planning · 1 agent");
    await sleep(1100);
    this.setNode("plan", "done");
    PARALLEL.forEach((id) => this.setNode(id, "run"));
    status("3 agents in parallel");
    await Promise.all(
      PARALLEL.map((id, i) => sleep(1300 + i * 380 + Math.random() * 500).then(() => this.setNode(id, "done"))),
    );
    this.setNode("rev", "run");
    status("Reviewing");
    await sleep(1000);
    this.setNode("rev", "done");
    status(`Done in ${(now() - this.t0).toFixed(1)}s`);
    this.emit("done");
    this.running = false;
    go.removeAttribute("aria-disabled");
    go.textContent = "Run again";
  }

  /** Elbow route from node `a` to node `b`: out of a's side (or bottom), across, into b. */
  private path(a: GraphNode, b: GraphNode): [Point, Point, Point, Point] {
    if (this.vert) {
      const my = (a.y + b.y) / 2;
      return [
        [a.x, a.y + 15],
        [a.x, my],
        [b.x, my],
        [b.x, b.y - 15],
      ];
    }
    const mx = (a.x + b.x) / 2;
    const aw = a.el.offsetWidth / 2;
    const bw = b.el.offsetWidth / 2;
    return [
      [a.x + aw, a.y],
      [mx, a.y],
      [mx, b.y],
      [b.x - bw, b.y],
    ];
  }

  protected override render(t: number): boolean {
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const pp = F.pitch;
    let busy = this.running;
    F.clear();
    for (const [ai, bi] of EDGES) {
      const a = this.nodes.get(ai);
      const b = this.nodes.get(bi);
      if (!a || !b) continue;
      const pts = this.path(a, b);
      const live = a.s === "done" && b.s === "run";
      const done = a.s === "done" && b.s === "done";
      const segs: EdgeSegment[] = [];
      let L = 0;
      for (let k = 0; k < 3; k++) {
        const length = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
        segs.push({ from: pts[k], to: pts[k + 1], start: L, length });
        L += length;
      }
      for (const { from: p, to: q, start: l0, length: l } of segs) {
        const n = Math.max(1, Math.ceil(l / pp));
        for (let s = 0; s <= n; s++) {
          const u = s / n;
          const x = lerp(p[0], q[0], u);
          const y = lerp(p[1], q[1], u);
          const d = l0 + u * l;
          if (live) {
            const w = 0.5 + 0.5 * Math.sin((d - t * 90) * 0.18);
            F.plot(x, y, mix(P.accent, P.shine, w * 0.5), 0.4 + 0.6 * w, w * 0.6);
          } else if (done) {
            F.plot(x, y, mix(P.ok, P.muted, 0.35), 0.75, 0.05);
          } else if (s % 3 === 0) {
            F.plot(x, y, P.muted, 0.45);
          }
        }
      }
      // two packets travel along a live edge
      if (live && !R0) {
        for (let q = 0; q < 2; q++) {
          const d = (t * 120 + (q * L) / 2) % L;
          for (const { from: p, to: pq, start: l0, length: l } of segs) {
            if (d < l0 || d > l0 + l) continue;
            const u = (d - l0) / l;
            const x = lerp(p[0], pq[0], u);
            const y = lerp(p[1], pq[1], u);
            for (let dx = -3; dx <= 3; dx += pp) {
              for (let dy = -3; dy <= 3; dy += pp) {
                if (Math.hypot(dx, dy) < 3.2) F.plot(x + dx, y + dy, WHITE, 1, 1);
              }
            }
          }
        }
      }
    }
    // node halos
    for (const n of this.nodes.values()) {
      if (n.s === "idle") continue;
      // layout sizes, not on-screen rects, so the halo fits inside a zoomed ancestor too
      const w = n.el.offsetWidth + 10;
      const h = n.el.offsetHeight + 10;
      const x0 = n.x - w / 2;
      const y0 = n.y - h / 2;
      const age = t - n.t0;
      const pulse = n.s === "run" ? 0.5 + 0.5 * Math.sin(t * 5) : Math.exp(-age * 4);
      if (n.s === "done" && pulse < 0.01) continue;
      busy = true;
      for (let j = Math.floor(y0 / pp); j < (y0 + h) / pp; j++) {
        for (let i = Math.floor(x0 / pp); i < (x0 + w) / pp; i++) {
          const [x, y] = F.xy(i, j);
          const sd = inRR(x - x0, y - y0, w, h, h / 2);
          if (sd > 0 || sd < -3) continue;
          // a bright head circles the ring of a running node
          const a = (Math.atan2(y - n.y, (x - n.x) * (h / w)) / TAU + 1) % 1;
          const head = (t * 0.6) % 1;
          let dd = Math.abs(a - head);
          dd = Math.min(dd, 1 - dd);
          const glow = Math.exp((-dd * dd) / 0.004);
          if (n.s === "run") F.put(i, j, mix(P.accent, P.shine, glow), 0.35 + 0.65 * glow, glow * 0.9 + pulse * 0.1);
          else F.put(i, j, P.ok, pulse, pulse);
        }
      }
    }
    this.flush(0.85, 5);
    return busy;
  }
}

define("hf-graph", HGraph);

export { HGraph };

declare global {
  interface HTMLElementTagNameMap {
    "hf-graph": HGraph;
  }
}
