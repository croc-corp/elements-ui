/**
 * <px-agents> · Agent workflow
 * LumeSec Elements · Pixel Lab · https://elements.lumesec.ai/components/pixel-lab/agents
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./px-agents.tsx.
 *
 * Demo data: The planner, the four agents and their run times are invented; nothing can be set. It cannot show
 * your own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import {
  PxBase,
  Sparks,
  TAU,
  bitmap,
  clamp,
  css,
  define,
  hash,
  mix,
  rand,
  reduced,
  rollText,
  type Point,
} from "@/lib/lumesec/pixel";

/** Events fired by `<px-agents>`. */
export interface AgentsEventMap {
  /** Fires when a run starts, from the button or from `run()`. */
  run: CustomEvent<Record<string, never>>;
  /** Fires when the verifier finishes. `seconds` is the elapsed run time, rounded to one decimal. */
  done: CustomEvent<{ seconds: number }>;
}

/** Step of the workflow. */
type WorkflowPhase = "idle" | "plan" | "work" | "verify" | "done";

/** Check mark drawn on the verifier once the run is done. */
const CHECK = bitmap(["......##", ".....##.", "#...##..", "##.##...", ".###....", "..#....."]);

/** Labels of the four agents. */
const AGENT_LABELS = ["explore", "edit", "test", "docs"] as const;
/** Index of the verifier in the node list; the planner is 0 and the agents 1–4. */
const VERIFIER = 5;

/** A pixel of a node disc. */
interface NodePixel {
  dx: number;
  dy: number;
  /** Distance from the centre, 1 at the rim; the disc blooms outward in this order. */
  d: number;
  /** Stable random value for the pulse phase. */
  s: number;
}

/** Animation state of a node; kept across resizes. */
interface NodeState {
  /** How far the disc has bloomed, from 0 to 1. */
  appear: number;
  active: boolean;
  /** Progress of the node's work from 0 to 1, shown as a ring. */
  prog: number;
  done: boolean;
  /** Highlight flash, decaying from 1. */
  flash: number;
  /** Work time in seconds. */
  dur: number;
  started: boolean;
  bloomed: boolean;
  /** Time the agent blooms in. */
  bloomAt: number;
}

/** A node of the workflow graph. */
interface AgentNode extends NodeState {
  x: number;
  y: number;
  r: number;
  label: string;
  pts: NodePixel[];
}

/** A packet travelling along an edge from node `a` to node `b`. */
interface Packet {
  a: number;
  b: number;
  t0: number;
  dur: number;
}

/** The workflow graph laid out for the current size. */
interface Graph {
  nodes: AgentNode[];
  planner: AgentNode;
  agents: AgentNode[];
  verifier: AgentNode;
}

/** A node disc of radius `r` at `(x, y)` on a 3px grid. */
function createNode(x: number, y: number, r: number, label: string): AgentNode {
  const pts: NodePixel[] = [];
  for (let gy = -r; gy <= r; gy += 3) {
    for (let gx = -r; gx <= r; gx += 3) {
      const d = Math.hypot(gx, gy) / r;
      if (d <= 1) pts.push({ dx: gx, dy: gy, d, s: hash(gx * 13.1 + gy * 7.7 + r) });
    }
  }
  return {
    x,
    y,
    r,
    label,
    pts,
    appear: 0,
    active: false,
    prog: 0,
    done: false,
    flash: 0,
    dur: 2,
    started: false,
    bloomed: false,
    bloomAt: Infinity,
  };
}

/** The animation state of `node`, without its layout. */
const stateOf = (node: AgentNode): NodeState => ({
  appear: node.appear,
  active: node.active,
  prog: node.prog,
  done: node.done,
  flash: node.flash,
  dur: node.dur,
  started: node.started,
  bloomed: node.bloomed,
  bloomAt: node.bloomAt,
});

/** Animated multi-agent workflow: a planner fans work out to four agents and a verifier merges the results. */
class Agents extends PxBase {
  private phase: WorkflowPhase = "idle";
  /** Null until the first layout. */
  private graph: Graph | null = null;
  private packets: Packet[] = [];
  private readonly sparks = new Sparks();
  /** Start of the run and of the current phase. */
  private runStart = 0;
  private phaseStart = 0;
  /** Whether "4 agents working in parallel" was announced in this run. */
  private announced = false;
  /** Time of the last dispatched packet, and the agent it went to. */
  private lastPacketAt = 0;
  private packetTarget = 0;

  constructor() {
    super(
      `
      :host { display: block; }
      .pbtn[aria-disabled="true"] { opacity: .45; pointer-events: none; }
      canvas.px { height: 212px; }
      .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
      .phase { flex: 1; min-width: 0; font-size: 13px; color: var(--_muted); font-variant-numeric: tabular-nums; }
      .phase .roll { white-space: normal; }
      .run { flex: none; }
      `,
      `<canvas class="px" role="img" aria-label="Multi-agent workflow"></canvas>
        <div class="bar"><span class="rollslot phase" aria-live="polite"></span><button class="pbtn run" type="button">Run workflow</button></div>`,
    );
    this.$(".run").addEventListener("click", () => this.run());
  }

  protected override init(): void {
    rollText(this.$(".phase"), "Ready · 1 planner, 4 agents", 1, false);
  }

  protected override resized(): void {
    const { w, h } = this;
    const planner = createNode(w * 0.12, h * 0.46, 15, "plan");
    const agents = [0.12, 0.36, 0.6, 0.84].map((f, i) => createNode(w * 0.5, h * f - 4, 10, AGENT_LABELS[i]));
    const verifier = createNode(w * 0.88, h * 0.46, 15, "verify");
    planner.appear = 1;
    verifier.appear = 1;
    const nodes = [planner, ...agents, verifier];
    // a resize mid-run keeps every node's animation state
    this.graph?.nodes.forEach((old, i) => Object.assign(nodes[i], stateOf(old)));
    this.graph = { nodes, planner, agents, verifier };
  }

  /** Starts the workflow. Ignored while a run is in progress. */
  run(): void {
    const graph = this.graph;
    if ((this.phase !== "idle" && this.phase !== "done") || !graph) return;
    this.runStart = this.t;
    this.phase = "plan";
    this.phaseStart = this.t;
    this.packets = [];
    this.announced = false;
    for (const agent of graph.agents) {
      Object.assign(agent, {
        appear: 0,
        active: false,
        prog: 0,
        done: false,
        flash: 0,
        dur: rand(1.6, 3.1),
        started: false,
        bloomed: false,
        bloomAt: Infinity,
      });
    }
    Object.assign(graph.verifier, { active: false, prog: 0, done: false, flash: 0 });
    Object.assign(graph.planner, { active: true, done: false });
    // aria-disabled rather than disabled, so a keyboard user keeps focus on the button; run() ignores presses
    this.$(".run").setAttribute("aria-disabled", "true");
    rollText(this.$(".phase"), "Planning the work…", 1);
    this.emit("run");
    this.kick();
  }

  /** Point on the curved edge from node `a` to node `b` at `u` (0 to 1). */
  private curve(nodes: readonly AgentNode[], a: number, b: number, u: number): Point {
    const A = nodes[a];
    const B = nodes[b];
    const cx = (A.x + B.x) / 2;
    const cy = a === 0 ? B.y : A.y;
    const v = 1 - u;
    return [v * v * A.x + 2 * v * u * cx + u * u * B.x, v * v * A.y + 2 * v * u * cy + u * u * B.y];
  }

  /** Advance the agents through their work; once all are done and merged, start verifying. */
  private work(graph: Graph, t: number, dt: number, since: number, say: (text: string) => void): void {
    const P = this.P;
    const { agents, verifier } = graph;
    // the planner streams packets to the agents for the first 0.9 seconds
    if (since < 0.9 && t - this.lastPacketAt > 0.06) {
      this.lastPacketAt = t;
      this.packetTarget = (this.packetTarget + 1) % 4;
      this.packets.push({ a: 0, b: 1 + this.packetTarget, t0: t, dur: 0.5 });
    }
    agents.forEach((agent, i) => {
      if (t >= agent.bloomAt && agent.appear < 1) {
        agent.appear = Math.min(1, agent.appear + dt / 0.32);
        if (!agent.bloomed) {
          agent.bloomed = true;
          agent.flash = 0.8;
          this.sparks.add(agent.x, agent.y, 12, [P.accent, P.shine], { speed: [30, 120] });
        }
      }
      if (!agent.started && t > agent.bloomAt + 0.5) {
        agent.started = true;
        agent.active = true;
      }
      if (agent.started && !agent.done) {
        agent.prog += dt / agent.dur;
        if (agent.prog >= 1) {
          agent.prog = 1;
          agent.done = true;
          agent.active = false;
          agent.flash = 1;
          this.sparks.add(agent.x, agent.y, 14, [P.ok, P.shine], { speed: [30, 130] });
          for (let k = 0; k < 5; k++) this.packets.push({ a: 1 + i, b: VERIFIER, t0: t + k * 0.08, dur: 0.55 });
          const finished = agents.filter((x) => x.done).length;
          say(finished < 4 ? `${finished} of 4 agents done` : "Merging results");
        }
      }
    });
    if (!this.announced && since > 1 && !agents.some((agent) => agent.done)) {
      this.announced = true;
      say("4 agents working in parallel");
    }
    if (agents.every((agent) => agent.done) && !this.packets.some((p) => p.b === VERIFIER)) {
      this.phase = "verify";
      this.phaseStart = t;
      verifier.active = true;
      say("Verifying");
    }
  }

  /** Advance the workflow: plan → dispatch → work → verify → done. */
  private step(graph: Graph, t: number, dt: number): void {
    const P = this.P;
    const { nodes, planner, agents, verifier } = graph;
    const since = t - this.phaseStart;
    const say = (text: string): void => rollText(this.$(".phase"), text, 1);
    if (this.phase === "plan" && since > 0.9) {
      this.phase = "work";
      this.phaseStart = t;
      planner.flash = 1;
      this.sparks.add(planner.x, planner.y, 26, [P.accent, P.shine], { speed: [60, 200] });
      agents.forEach((agent, i) => {
        agent.bloomAt = t + 0.15 + i * 0.1;
      });
      say("Dispatching to 4 agents");
    }
    if (this.phase === "work") this.work(graph, t, dt, since, say);
    if (this.phase === "verify") {
      // measured from the start of this phase: work() may have switched to verify in this same frame
      const verifying = t - this.phaseStart;
      verifier.prog = Math.min(1, verifying / 1.1);
      if (verifying > 1.1) {
        this.phase = "done";
        verifier.active = false;
        verifier.done = true;
        verifier.flash = 1;
        planner.active = false;
        planner.done = true;
        this.sparks.add(verifier.x, verifier.y, 36, [P.ok, P.shine, P.accent], { speed: [60, 220] });
        say(`Done in ${(t - this.runStart).toFixed(1)}s · 4 agents`);
        const button = this.$<HTMLButtonElement>(".run");
        button.removeAttribute("aria-disabled");
        button.textContent = "Run again";
        this.emit<{ seconds: number }>("done", { seconds: +(t - this.runStart).toFixed(1) });
      }
    }
    // arriving packets make their target flash
    this.packets = this.packets.filter((p) => {
      if (t - p.t0 < p.dur) return true;
      if (p.b === VERIFIER) verifier.flash = Math.min(1, verifier.flash + 0.25);
      else nodes[p.b].flash = Math.min(1, nodes[p.b].flash + 0.15);
      return false;
    });
    for (const node of nodes) node.flash = Math.max(0, node.flash - dt * 2.2);
  }

  private drawNode(g: CanvasRenderingContext2D, graph: Graph, node: AgentNode, t: number, isVerifier: boolean): void {
    const P = this.P;
    const base = node.done ? mix(P.accent, P.ok, 0.85) : P.accent;
    // an agent that has not bloomed yet shows as a faint outline
    if (node.appear < 0.02) {
      for (let k = 0; k < 16; k++) {
        const a = (TAU * k) / 16;
        this.dot(node.x + Math.cos(a) * node.r - 1, node.y + Math.sin(a) * node.r - 1, P.fg, 0.14, 2);
      }
    }
    const dim = isVerifier && node.done ? 0.35 : 1;
    for (const p of node.pts) {
      if (p.d > node.appear + 0.001) continue;
      let alpha: number;
      if (node.active) alpha = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * (4 + p.s * 5) + p.s * 20), 2);
      else if (node.done) alpha = 0.8 - p.d * 0.3;
      else alpha = 0.24 + 0.1 * Math.sin(t * 1.3 + p.s * 9);
      // the planner ripples outward while planning
      if (this.phase === "plan" && node === graph.planner) alpha = Math.max(alpha, 0.5 + 0.5 * Math.sin(t * 9 - p.d * 7));
      alpha = (alpha + node.flash * 0.6) * dim;
      const color = mix(base, P.shine, node.flash * 0.7 + (node.active ? 0.2 * (1 - p.d) : 0));
      this.dot(node.x + p.dx - 1.1, node.y + p.dy - 1.1, color, alpha, 2.2);
    }
    if (isVerifier && node.done) {
      for (const [cx, cy] of CHECK) this.dot(node.x - 12 + cx * 3, node.y - 9 + cy * 3, P.ok, 1, 2.6);
    }
    if (node.active && (node.prog > 0 || isVerifier)) {
      const dots = 22;
      const R = node.r + 6;
      for (let k = 0; k < dots; k++) {
        const a = -Math.PI / 2 + (TAU * k) / dots;
        const lit = k / dots < node.prog;
        const color = lit ? mix(P.accent, P.shine, 0.3) : P.fg;
        this.dot(node.x + Math.cos(a) * R - 1, node.y + Math.sin(a) * R - 1, color, lit ? 0.95 : 0.12, 2);
      }
    }
    // labels of agents that have not bloomed yet stay readable, just quieter
    g.globalAlpha = node.appear > 0.02 ? 0.9 : 0.7;
    g.fillStyle = css(P.muted);
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillText(node.label, node.x, node.y + node.r + (node.r > 12 ? 17 : 15));
    g.globalAlpha = 1;
  }

  protected override render(t: number, dt: number): boolean {
    const graph = this.graph;
    const g = this.ctx;
    if (!graph || !g) return false;
    this.step(graph, t, dt);
    const P = this.P;
    const { nodes } = graph;
    this.clear();
    g.font = `10px ${this.monoFont}`;
    // edges
    for (let i = 1; i <= 4; i++) {
      const agent = nodes[i];
      const visibility = this.phase === "idle" ? 0.06 : 0.06 + 0.1 * agent.appear;
      for (const [a, b] of [
        [0, i],
        [i, VERIFIER],
      ]) {
        for (let k = 1; k < 26; k++) {
          const [x, y] = this.curve(nodes, a, b, k / 26);
          this.dot(x - 0.8, y - 0.8, P.fg, visibility, 1.6);
        }
      }
    }
    // packets with short trails
    for (const p of this.packets) {
      const u = (t - p.t0) / p.dur;
      if (u < 0) continue;
      for (let k = 0; k < 4; k++) {
        const uu = clamp(u - k * 0.04, 0, 1);
        const [x, y] = this.curve(nodes, p.a, p.b, uu * uu * (3 - 2 * uu));
        this.dot(x - 1.3, y - 1.3, k ? P.accent : P.shine, 1 - k * 0.24, k ? 2.2 : 2.8);
      }
    }
    nodes.forEach((node, i) => this.drawNode(g, graph, node, t, i === VERIFIER));
    const sparking = this.sparks.step(g, dt);
    // a finished run is a still picture once its sparks, packets and flashes have faded; the idle shimmer
    // is decoration, so it holds still under reduced motion
    const settling = sparking || this.packets.length > 0 || nodes.some((node) => node.flash > 0);
    if (this.phase === "done") return settling;
    if (this.phase === "idle") return settling || !reduced();
    return true;
  }
}

define("px-agents", Agents);

export { Agents };

declare global {
  interface HTMLElementTagNameMap {
    "px-agents": Agents;
  }
}
