/**
 * <hf-dialog> · Dialog
 * LumeSec Elements · Pixel HD · https://elements.lumesec.ai/components/pixel-hd/dialog
 *
 * A framework-free custom element. Importing this module registers the tag.
 * The React wrapper is ./hf-dialog.tsx.
 */
import { HF, bayer, clamp, define, ease3, lerp, mix, now, reduced, type RGB } from "@/lib/lumesec/pixel";

/** The invite form's values, sent with `close` when the form is submitted. */
export interface InviteValues {
  emails: string;
  role: string;
}

/**
 * Detail of the `close` event. `returnValue` is `send` with the form's `emails` and `role`, `cancel` for Cancel,
 * Escape or a backdrop click, an empty string for the close button, or what was passed to `hide()`.
 */
export interface DialogCloseDetail extends Partial<InviteValues> {
  returnValue: string | undefined;
}

/** Events fired by `<hf-dialog>`. */
export interface HDialogEventMap {
  /** The dialog opened. */
  open: CustomEvent<Record<string, never>>;
  /** The dialog closed. */
  close: CustomEvent<DialogCloseDetail>;
}

type DialogPhase = "closed" | "opening" | "open" | "closing";

/** A pixel flying between the trigger and the panel: start, end, delay and a 0..1 colour and arc factor. */
interface FlyingPixel {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  d: number;
  c: number;
}

/** `n` pixels from random points of `from` to random points of `to`, each delayed up to `maxDelay` seconds. */
function flight(from: DOMRect, to: DOMRect, n: number, maxDelay: number): FlyingPixel[] {
  return Array.from({ length: n }, () => ({
    sx: from.left + Math.random() * from.width,
    sy: from.top + Math.random() * from.height,
    ex: to.left + Math.random() * to.width,
    ey: to.top + Math.random() * to.height,
    d: Math.random() * maxDelay,
    c: Math.random(),
  }));
}

const BACKDROP_DARK: RGB = [8, 8, 10];
const BACKDROP_LIGHT: RGB = [24, 22, 30];

/** Modal invite dialog on the native dialog element; pixels fly from the trigger to build the panel. */
class HDialog extends HF {
  static observedAttributes = ["label", "heading", "description"];

  private phase: DialogPhase = "closed";
  /** Start of the current phase. */
  private t0 = 0;
  private pixels: FlyingPixel[] = [];
  /** Pending steps of the open or close transition; cleared when the other one starts. */
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly dialog = this.$("dialog");
  private readonly trigger = this.$<HTMLButtonElement>(".open");
  private readonly panel = this.$<HTMLFormElement>(".pn");

  constructor() {
    super(
      `
      :host { display: inline-block; }
      .open { height: 40px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--_border); background: var(--_surface); color: var(--_fg); font-size: 13.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
      .open:hover { border-color: color-mix(in srgb, var(--_accent) 50%, var(--_border)); }
      dialog { padding: 0; border: 0; background: transparent; color: var(--_fg); max-width: none; max-height: none; width: 100%; height: 100%; overflow: hidden; }
      dialog::backdrop { background: transparent; }
      canvas.px { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }
      .pn { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(.98); width: min(420px, calc(100vw - 32px)); border-radius: 16px; border: 1px solid var(--_border); background: var(--_surface); padding: 20px; box-shadow: 0 30px 80px -20px rgba(0,0,0,.5); opacity: 0; transition: opacity .2s, transform .25s cubic-bezier(.2,.8,.2,1); }
      .pn.on { opacity: 1; transform: translate(-50%, -50%); }
      @media (prefers-reduced-motion: reduce) { .pn { transition: none; } }
      h2 { margin: 0 0 4px; font-size: 17px; font-weight: 650; }
      .pn p { margin: 0 0 16px; font-size: 13px; color: var(--_muted); }
      label { display: grid; gap: 6px; font-size: 12.5px; font-weight: 500; margin-bottom: 12px; }
      input, select { height: 40px; border-radius: 10px; border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); padding: 0 12px; font-size: 14px; outline: none; }
      input:focus, select:focus { border-color: color-mix(in srgb, var(--_accent) 60%, var(--_border)); }
      .ac { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
      .ac button { height: 38px; padding: 0 16px; border-radius: 10px; font-size: 13.5px; font-weight: 600; cursor: pointer; border: 1px solid var(--_border); background: var(--_raised); color: var(--_fg); }
      .ac .pri { background: var(--_accent); border-color: transparent; color: var(--_on-accent); }
      .x { position: absolute; top: 12px; right: 12px; width: 30px; height: 30px; border-radius: 8px; border: 0; background: none; color: var(--_muted); cursor: pointer; display: grid; place-items: center; }
      `,
      `<button class="open" type="button" aria-haspopup="dialog"></button><dialog aria-labelledby="dh" aria-describedby="dd"><canvas class="px" aria-hidden="true"></canvas><form class="pn" method="dialog"><button class="x" type="button" aria-label="Close"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button><h2 id="dh"></h2><p class="ds" id="dd"></p><label>Email addresses<input name="emails" placeholder="name@example.com, team@example.com" autocomplete="off"></label><label>Role<select name="role"><option>Member</option><option>Admin</option><option>Viewer</option></select></label><div class="ac"><button type="button" class="cn">Cancel</button><button type="submit" class="pri" value="send">Send invites</button></div></form></dialog>`,
      3,
      0.72,
    );
    const dialog = this.dialog;
    this.trigger.addEventListener("click", () => this.show());
    this.$(".x").addEventListener("click", () => this.hide(""));
    this.$(".cn").addEventListener("click", () => this.hide("cancel"));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.hide("cancel");
    });
    // the browser may close the dialog itself (a repeated Escape cannot always be cancelled); finish the close
    dialog.addEventListener("close", () => {
      if (this.phase === "open" || this.phase === "opening") this.closed("cancel");
    });
    this.panel.addEventListener("submit", (e) => {
      e.preventDefault();
      this.dismiss("send", { emails: this.$("input").value, role: this.$("select").value });
    });
    // a press outside the panel closes, like a backdrop click
    dialog.addEventListener("pointerdown", (e) => {
      if (e.target !== dialog && e.target !== this.cv) return;
      const r = this.panel.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.hide("cancel");
    });
  }

  attributeChangedCallback(): void {
    this.renderText();
  }

  protected override init(): void {
    this.renderText();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // a removed dialog leaves the top layer; start closed when it is inserted again
    this.clearTimers();
    this.pixels = [];
    this.panel.classList.remove("on");
    if (this.dialog.open) this.dialog.close();
    this.phase = "closed";
  }

  private renderText(): void {
    this.trigger.textContent = this.getAttribute("label") || "Invite teammates";
    this.$("#dh").textContent = this.getAttribute("heading") || "Invite teammates";
    this.$(".ds").textContent =
      this.getAttribute("description") || "They’ll get an email with a link to join the workspace.";
  }

  private clearTimers(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers = [];
  }

  /** Opens the dialog. Ignored unless it is closed. */
  show(): void {
    if (this.phase !== "closed") return;
    this.dialog.showModal();
    this.phase = "opening";
    this.t0 = now();
    const fast = reduced();
    const button = this.trigger.getBoundingClientRect();
    const panel = this.panel.getBoundingClientRect();
    this.pixels = flight(button, panel, fast ? 0 : 700, 0.15);
    this.clearTimers();
    this.timers.push(
      setTimeout(
        () => {
          this.panel.classList.add("on");
          this.$("input").focus();
        },
        fast ? 0 : 380,
      ),
      setTimeout(
        () => {
          if (this.phase === "opening") this.phase = "open";
          this.kick();
        },
        fast ? 0 : 560,
      ),
    );
    this.emit("open");
    this.kick();
  }

  /**
   * Closes the dialog, returns focus to the trigger and passes `returnValue` to `close`. Ignored unless the dialog
   * is open or opening.
   */
  hide(returnValue?: string): void {
    this.dismiss(returnValue);
  }

  private dismiss(returnValue: string | undefined, values?: InviteValues): void {
    if (this.phase !== "open" && this.phase !== "opening") return;
    this.phase = "closing";
    this.t0 = now();
    // an unfinished opening must not bring the panel back
    this.clearTimers();
    this.panel.classList.remove("on");
    const fast = reduced();
    this.pixels = fast
      ? []
      : flight(this.panel.getBoundingClientRect(), this.trigger.getBoundingClientRect(), 500, 0.12);
    this.timers.push(
      setTimeout(
        () => {
          this.timers = [];
          this.dialog.close(returnValue);
          this.closed(returnValue, values);
        },
        fast ? 0 : 520,
      ),
    );
    this.kick();
  }

  /** The dialog is closed: return focus to the trigger and fire `close`. */
  private closed(returnValue: string | undefined, values?: InviteValues): void {
    this.clearTimers();
    this.phase = "closed";
    this.pixels = [];
    this.panel.classList.remove("on");
    this.trigger.focus();
    this.emit<DialogCloseDetail>("close", { returnValue, ...values });
    this.kick();
  }

  protected override render(t: number): boolean {
    if (this.phase === "closed") return false;
    const P = this.P;
    const F = this.F;
    const R0 = reduced();
    const age = t - this.t0;
    const opening = this.phase !== "closing";
    let dim: number;
    if (R0) dim = opening ? 1 : 0;
    else dim = opening ? clamp(age / 0.4, 0, 1) : 1 - clamp(age / 0.45, 0, 1);
    F.clear();
    // dithered backdrop
    const density = dim * 0.55 * (this.dark ? 1 : 0.8);
    for (let j = 0; j < F.rows; j++) {
      for (let i = 0; i < F.cols; i++) {
        if (bayer(i, j) < density) F.put(i, j, this.dark ? BACKDROP_DARK : BACKDROP_LIGHT, this.dark ? 0.9 : 0.42);
      }
    }
    // flying pixels from the button to the panel (or back)
    const duration = opening ? 0.45 : 0.42;
    for (const q of this.pixels) {
      const u = clamp((age - q.d) / duration, 0, 1);
      if (u >= 1 && opening && age > 0.6) continue;
      const e = opening ? ease3(u) : u * u;
      const arc = Math.sin(u * Math.PI);
      const x = lerp(q.sx, q.ex, e) + arc * (q.c - 0.5) * 80;
      const y = lerp(q.sy, q.ey, e) - arc * 40 * q.c;
      F.plot(x, y, mix(P.accent, P.shine, q.c * 0.6), 1 - (opening ? Math.max(0, u - 0.85) * 6 : 0), 0.8);
    }
    this.flush(0.9, 6);
    return this.phase !== "open" || (!R0 && age < 0.7);
  }
}

define("hf-dialog", HDialog);

export { HDialog };

declare global {
  interface HTMLElementTagNameMap {
    "hf-dialog": HDialog;
  }
}
