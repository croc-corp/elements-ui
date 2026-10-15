/**
 * <hf-terminal> · Terminal
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/terminal
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-terminal.tsx.
 *
 * Demo data: Commands and their output are built-in demo content; `print()` adds your own lines. It cannot
 * show your own data yet; use it as a template and replace the invented data before it shows anything real.
 */
import { HF, bayer, clamp, clientScale, define, fbm, mix, now, reduced, type RGB } from "@/lib/lumesec/pixel";

/** Colour of an output line: `dim`, `ok` (green), `err` (red), `acc` (accent), or `""` for plain text. */
export type HTerminalLineStyle = "" | "dim" | "ok" | "err" | "acc";

/** Events fired by `<hf-terminal>`. */
export interface HTerminalEventMap {
  /** Fires when a non-empty command runs, before its output. `command` is trimmed. */
  command: CustomEvent<{ command: string }>;
}

/** Line classes, including the internal ones for echoed commands (`cmd`) and progress bars (`pb`). */
type LineClass = HTerminalLineStyle | "cmd" | "pb";

/** A dotted progress bar printed into the output. */
interface ProgressBar {
  /** The output line. */
  el: HTMLElement;
  /** The strip the bar is drawn over. */
  strip: HTMLElement;
  /** The percentage label. */
  pct: HTMLElement;
  /** Drawn fill, easing toward `target`. */
  p: number;
  target: number;
  done: boolean;
  /** Time the bar completed; 0 while running. */
  flashT: number;
}

/** A freshly printed line and when it appeared, for the phosphor flash. */
interface Flash {
  el: HTMLElement;
  t0: number;
}

/** A screen rectangle, as returned by `getBoundingClientRect`. */
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const TERM_HELP = [
  "help       list commands",
  "ls         list files",
  "test       run the test suite",
  "deploy     build and ship a preview",
  "ultracode  plan with parallel agents",
  "clear      clear the screen",
];

const WHITE: RGB = [255, 255, 255];
/** Fill of a finished bar; matches the `.ok` text colour. */
const DONE_GREEN: RGB = [126, 227, 169];
/** Unfilled bar dots; the terminal is dark in both themes. */
const BAR_TRACK: RGB = [70, 66, 88];
/** Output lines kept in the scrollback. */
const MAX_LINES = 120;

/**
 * Simulated shell with phosphor-flash output, dotted progress bars and a glowing block caret; runs a set of built-in
 * demo commands.
 */
class HTerminal extends HF {
  /** It also draws on the canvas outside the field, so every flush redraws the whole canvas. */
  protected override partialFlush = false;

  private bars: ProgressBar[] = [];
  private flash: Flash[] = [];
  /** Command history, oldest first. */
  private readonly hist: string[] = [];
  /** Position in the history while browsing it with the arrow keys. */
  private hi = 0;
  /** True while a command runs; the prompt is disabled. */
  private running = false;
  /** Time of the last keystroke; the caret stays solid while typing. */
  private typedT = 0;
  private focused = false;

  constructor() {
    super(
      `
      :host { display: block; }
      .t { position: relative; border-radius: 12px; overflow: hidden; background: #0e0d13; color: #e8e6ef; font-family: var(--_mono); font-size: 12.5px; line-height: 1.6; box-shadow: 0 0 0 1px rgba(255,255,255,.06) inset, 0 10px 30px rgba(0,0,0,.18); }
      canvas.px { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
      .bar { position: relative; display: flex; align-items: center; gap: 6px; padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,.07); font-family: var(--_font); font-size: 12px; color: #8f8c9e; }
      .bar i { width: 10px; height: 10px; border-radius: 50%; background: #34323f; }
      .bar span { margin-left: 8px; }
      .out { position: relative; height: 196px; overflow: auto; padding: 10px 14px 0; scrollbar-width: thin; scrollbar-color: #34323f transparent; }
      .ln { white-space: pre-wrap; word-break: break-word; min-height: 1.6em; }
      .dim { color: #8f8c9e; } .ok { color: #7fe3a9; } .err { color: #ff8f8f; } .acc { color: #c7b8ff; } .cmd::before { content: '❯ '; color: #c7b8ff; }
      .pb { display: flex; align-items: center; gap: 10px; }
      .pb s { display: block; height: 10px; width: min(240px, 60%); text-decoration: none; flex: none; }
      .pb em { font-style: normal; color: #8f8c9e; font-variant-numeric: tabular-nums; }
      .in { position: relative; display: flex; gap: 8px; padding: 2px 14px 12px; align-items: center; cursor: text; }
      .pr { color: #c7b8ff; }
      input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; color: inherit; font: inherit; caret-color: transparent; padding: 0; }
      input:disabled { color: #8f8c9e; }
      .mir { position: absolute; visibility: hidden; white-space: pre; font: inherit; }
      `,
      `<div class="t"><canvas class="px" aria-hidden="true"></canvas><div class="bar"><i></i><i></i><i></i><span>~/project — zsh</span></div><div class="out" role="log" aria-live="polite"></div><label class="in"><span class="pr" aria-hidden="true">❯</span><input spellcheck="false" autocomplete="off" aria-label="Terminal command"><span class="mir" aria-hidden="true"></span></label></div>`,
      2,
      0.7,
    );
    const input = this.$("input");
    input.addEventListener("keydown", (e) => {
      this.typedT = now();
      this.kick();
      if (e.key === "Enter") {
        e.preventDefault();
        const value = input.value;
        input.value = "";
        void this.exec(value);
      } else if (e.key === "ArrowUp" && this.hist.length) {
        e.preventDefault();
        this.hi = Math.max(0, this.hi - 1);
        input.value = this.hist[this.hi] || "";
      } else if (e.key === "ArrowDown" && this.hist.length) {
        e.preventDefault();
        this.hi = Math.min(this.hist.length, this.hi + 1);
        input.value = this.hist[this.hi] || "";
      }
    });
    input.addEventListener("input", () => {
      this.typedT = now();
      this.kick();
    });
    input.addEventListener("focus", () => {
      this.focused = true;
      this.kick();
    });
    input.addEventListener("blur", () => {
      this.focused = false;
      this.kick();
    });
    this.$(".out").addEventListener("scroll", () => this.kick());
  }

  protected override init(): void {
    this.print("Pixel shell 1.0 — type help", "dim");
    const auto = this.getAttribute("autorun");
    if (auto) setTimeout(() => void this.type(auto), 900);
  }

  /** Types the command into the prompt character by character, then runs it. */
  async type(command: string): Promise<void> {
    const input = this.$("input");
    for (const ch of command) {
      input.value += ch;
      this.typedT = now();
      this.kick();
      await this.sleep(70 + Math.random() * 60);
    }
    await this.sleep(250);
    input.value = "";
    void this.exec(command);
  }

  /** Appends an output line and returns it. `cls` can be `dim`, `ok`, `err` or `acc` to colour it. */
  print(text: string, cls: HTerminalLineStyle = ""): HTMLElement {
    return this.printLine(text, cls);
  }

  /** Runs a command as if it were typed and Enter pressed. Ignored while another command is running. */
  async exec(command: string): Promise<void> {
    const cmd = command.trim();
    if (this.running) return;
    this.printLine(command, "cmd");
    if (!cmd) return;
    this.hist.push(cmd);
    this.hi = this.hist.length;
    this.emit<{ command: string }>("command", { command: cmd });
    const input = this.$("input");
    // disabling the input blurs it, so remember whether the prompt had focus
    const hadFocus = this.root.activeElement === input;
    this.running = true;
    input.disabled = true;
    try {
      await this.run(cmd);
    } finally {
      this.running = false;
      input.disabled = false;
      // give focus back unless the user moved it somewhere else in the meantime
      const active = document.activeElement;
      if (hadFocus && (!active || active === document.body || active === this)) input.focus();
      this.kick();
    }
  }

  /** The built-in demo commands. */
  private async run(cmd: string): Promise<void> {
    const [name] = cmd.split(/\s+/);
    if (name === "help") {
      TERM_HELP.forEach((line) => this.print(line, "dim"));
    } else if (name === "ls") {
      this.print("src/   tests/   package.json   README.md   tsconfig.json");
    } else if (name === "clear") {
      this.$(".out").innerHTML = "";
      this.bars = [];
    } else if (name === "test" || (name === "npm" && /test/.test(cmd))) {
      this.print("Running 128 tests across 14 files", "dim");
      await this.fill(this.bar("tests"), 1700);
      this.print("✓ 128 passed  (1.71s)", "ok");
    } else if (name === "deploy") {
      this.print("Building production bundle…", "dim");
      await this.fill(this.bar("build"), 1200);
      this.print("Uploading 34 assets", "dim");
      await this.fill(this.bar("upload"), 900, 0.9);
      this.print("✓ Live at https://preview.example.com", "ok");
    } else if (name === "ultracode") {
      this.print("Planning with 3 parallel agents", "acc");
      const agents = ["planner ", "coder   ", "reviewer"];
      const bars = agents.map((agent) => {
        const bar = this.bar(agent.trim());
        const name = document.createElement("span");
        name.className = "dim";
        name.textContent = agent;
        bar.el.prepend(name);
        return bar;
      });
      await Promise.all(bars.map((bar, k) => this.fill(bar, 1300 + k * 450, 0.9)));
      this.print("✓ Plan ready · 41 steps · 6 files", "ok");
    } else {
      this.print(`zsh: command not found: ${name}`, "err");
    }
  }

  /** Waits `ms`, at most 60 ms under reduced motion. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, reduced() ? Math.min(ms, 60) : ms));
  }

  private printLine(text: string, cls: LineClass): HTMLElement {
    const out = this.$(".out");
    const el = document.createElement("div");
    el.className = `ln ${cls}`;
    el.textContent = text;
    out.append(el);
    while (out.children.length > MAX_LINES) out.firstChild?.remove();
    out.scrollTop = out.scrollHeight;
    this.flash.push({ el, t0: now() });
    this.kick();
    return el;
  }

  /** A progress row: a `progressbar` named `label`, with the dotted strip and the percentage as text. */
  private bar(label: string): ProgressBar {
    const el = this.printLine("", "pb");
    const strip = document.createElement("s");
    const pct = document.createElement("em");
    pct.textContent = "0%";
    el.append(strip, pct);
    el.setAttribute("role", "progressbar");
    el.setAttribute("aria-label", label || "progress");
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
    el.setAttribute("aria-valuenow", "0");
    const bar: ProgressBar = { el, strip, pct, p: 0, target: 0, done: false, flashT: 0 };
    this.bars.push(bar);
    return bar;
  }

  /** Advance a bar to 100% in 8–12 uneven steps over about `ms`. */
  private async fill(bar: ProgressBar, ms: number, jitter = 0.5): Promise<void> {
    const steps = 8 + Math.floor(Math.random() * 5);
    for (let k = 1; k <= steps; k++) {
      await this.sleep((ms / steps) * (1 - jitter / 2 + Math.random() * jitter));
      bar.target = k / steps;
      const percent = String(Math.round(bar.target * 100));
      bar.pct.textContent = `${percent}%`;
      bar.el.setAttribute("aria-valuenow", percent);
      this.kick();
    }
    bar.done = true;
    bar.flashT = now();
    this.kick();
  }

  protected override render(t: number, dt: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const P = this.P;
    const F = this.F;
    const reducedMotion = reduced();
    const terminal = this.$(".t");
    const frame = terminal.getBoundingClientRect();
    const outBox = this.$(".out").getBoundingClientRect();
    // the boxes below stay in client coordinates, so the cell pitch is taken to on-screen pixels
    const scale = clientScale(terminal, frame);
    const accent = mix(P.accent, WHITE, this.dark ? 0.15 : 0.45);
    const screenPitch = F.pitch * scale;
    let busy = false;
    F.clear();

    /** Visit the cells of a screen box, clipped to the output area; `u`, `v` run 0–1 across it. */
    const fillBox = (box: Box, fn: (i: number, j: number, u: number, v: number) => void): void => {
      const top = Math.max(box.top, outBox.top);
      const bottom = Math.min(box.bottom, outBox.bottom);
      if (bottom <= top) return;
      const i0 = Math.floor((box.left - frame.left) / screenPitch);
      const i1 = Math.ceil((box.right - frame.left) / screenPitch);
      const j0 = Math.floor((top - frame.top) / screenPitch);
      const j1 = Math.ceil((bottom - frame.top) / screenPitch);
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) fn(i, j, (i - i0) / Math.max(1, i1 - i0), (j - j0) / Math.max(1, j1 - j0));
      }
    };

    // phosphor flash behind freshly printed lines
    this.flash = this.flash.filter((f) => t - f.t0 < 0.5 && f.el.isConnected);
    for (const f of this.flash) {
      const age = (t - f.t0) / 0.5;
      const r = f.el.getBoundingClientRect();
      const box = {
        left: r.left - 4 * scale,
        right: Math.min(r.right, r.left + Math.max(60, f.el.scrollWidth) * scale) + 4 * scale,
        top: r.top,
        bottom: r.bottom,
      };
      fillBox(box, (i, j, u) => {
        if (u > 1 - age * 0.2 || bayer(i, j) > 0.55 * (1 - age)) return;
        F.put(i, j, accent, 0.22 * (1 - age), 0.25 * (1 - age));
      });
      busy = true;
    }

    // progress bars
    this.bars = this.bars.filter((bar) => bar.el.isConnected);
    for (const bar of this.bars) {
      bar.p += (bar.target - bar.p) * Math.min(1, reducedMotion ? 1 : dt * 9);
      if (Math.abs(bar.target - bar.p) > 0.002) busy = true;
      const doneFlash = bar.flashT ? clamp(1 - (t - bar.flashT) / 0.6, 0, 1) : 0;
      if (doneFlash > 0) busy = true;
      const front = bar.p;
      fillBox(bar.strip.getBoundingClientRect(), (i, j, u) => {
        if (u > front) {
          F.put(i, j, BAR_TRACK, (i + j) & 1 ? 0.9 : 0.4);
          return;
        }
        const tip = Math.exp(-(((front - u) * 60) ** 2) / 6);
        const sheen = fbm(u * 8 - t * 1.6, j * 0.3);
        const col = bar.done ? mix(DONE_GREEN, WHITE, doneFlash * 0.5) : mix(accent, WHITE, tip * 0.6);
        const lit = bayer(i, j) < 0.55 + 0.45 * u + tip ? 1 : 0.45;
        F.put(i, j, col, lit * (0.7 + 0.3 * sheen), 0.15 + tip * 0.8 + doneFlash * 0.6);
      });
    }

    // block caret, positioned by measuring the text before the selection in a hidden mirror
    const input = this.$("input");
    const inputBox = input.getBoundingClientRect();
    const mirror = this.$(".mir");
    mirror.textContent = input.value.slice(0, input.selectionStart ?? input.value.length);
    const cx =
      (inputBox.left - frame.left) / scale + Math.min(mirror.offsetWidth - input.scrollLeft, input.offsetWidth - 8);
    const cy = (inputBox.top - frame.top) / scale + (input.offsetHeight - 16) / 2;
    const cellPitch = F.pitch;
    const typing = t - this.typedT < 0.6;
    const blink = reducedMotion || typing || Math.sin(t * 6.3) > -0.2;
    if (!this.running) {
      const i0 = Math.round(cx / cellPitch);
      const i1 = Math.round((cx + 8) / cellPitch);
      const j0 = Math.round(cy / cellPitch);
      const j1 = Math.round((cy + 16) / cellPitch);
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          // an outline while unfocused, a blinking solid block while focused
          const edge = i === i0 || i === i1 - 1 || j === j0 || j === j1 - 1;
          if (!this.focused && !edge) continue;
          if (this.focused && !blink) continue;
          F.put(i, j, accent, this.focused ? 1 : 0.55, this.focused ? 0.9 : 0);
        }
      }
    }
    this.clear();
    // always drawn as on a dark theme: the terminal is dark in both
    F.draw(ctx, true, 0.95, 5);
    return busy || this.focused;
  }
}

define("hf-terminal", HTerminal);

declare global {
  interface HTMLElementTagNameMap {
    "hf-terminal": HTerminal;
  }
}

export { HTerminal };
