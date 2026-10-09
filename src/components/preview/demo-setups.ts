/**
 * Demo wiring for the custom-element previews, ported from the lab gallery pages. Each setup is scoped to
 * one preview root, may return a cleanup, and only touches the demo markup. Native React components need
 * none: their demos in registry/examples wire themselves.
 */
type Cleanup = () => void;
type Setup = (root: HTMLElement) => Cleanup | void;

/** The members of the Pixel HD elements that the demos use. */
type DemoElement = HTMLElement & {
  value: string | number;
  show?: () => void;
  restart?: (seconds?: number) => void;
  run?: () => void;
};

const $ = (root: ParentNode, selector: string) => root.querySelector<DemoElement>(selector);
const $$ = (root: ParentNode, selector: string) => [...root.querySelectorAll<DemoElement>(selector)];

/** The detail of a custom event as a plain record (empty for other events). */
function detailOf(event: Event): Record<string, unknown> {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null;
  return typeof detail === "object" && detail !== null ? { ...detail } : {};
}

/** Fire once when the element is mostly visible. */
function onSeen(el: Element, fn: () => void, threshold = 0.5): Cleanup {
  let done = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (done || !entries.some((e) => e.isIntersecting)) return;
      done = true;
      observer.disconnect();
      fn();
    },
    { threshold },
  );
  observer.observe(el);
  return () => observer.disconnect();
}

/** Timeouts that are all cleared by one call. */
function timers() {
  const ids: number[] = [];
  return {
    timeout: (fn: () => void, ms: number) => ids.push(window.setTimeout(fn, ms)),
    clear: () => ids.forEach((id) => window.clearTimeout(id)),
  };
}

/** Adds a click listener to every button that matches and removes them all on cleanup. */
function onClicks(root: HTMLElement, selector: string, handler: (button: DemoElement) => void): Cleanup {
  const removers = $$(root, selector).map((button) => {
    const listener = () => handler(button);
    button.addEventListener("click", listener);
    return () => button.removeEventListener("click", listener);
  });
  return () => removers.forEach((remove) => remove());
}

/** Prints a message into the demo's output line whenever `target` fires one of `events`. */
function echo(
  root: HTMLElement,
  target: string,
  output: string,
  events: Record<string, (detail: Record<string, unknown>) => string>,
): Cleanup {
  const el = $(root, target);
  const out = $(root, output);
  const listeners = Object.entries(events).map(([type, format]) => {
    const listener = (event: Event) => {
      if (out) out.textContent = format(detailOf(event));
    };
    el?.addEventListener(type, listener);
    return () => el?.removeEventListener(type, listener);
  });
  return () => listeners.forEach((remove) => remove());
}

/** A whole-number attribute of an element, 0 when it is missing. */
const numberAttr = (el: Element, name: string) => Number(el.getAttribute(name) ?? 0) || 0;

/** Setups by tag; tags without an entry need no wiring. */
export const demoSetups: Record<string, Setup> = {
  "hf-composer": (root) =>
    echo(root, "#comp", "#compOut", { send: (d) => `send → “${String(d.text)}” at ${String(d.effort)}` }),
  "hf-progress": (root) => {
    let interval = 0;
    const run = () => {
      const bar = $(root, "#up");
      let value = 0;
      window.clearInterval(interval);
      bar?.setAttribute("value", "0");
      interval = window.setInterval(() => {
        value = Math.min(100, value + 2 + Math.random() * 5);
        bar?.setAttribute("value", String(Math.round(value)));
        if (value >= 100) window.clearInterval(interval);
      }, 120);
    };
    const off = onClicks(root, "#upGo", run);
    return () => {
      off();
      window.clearInterval(interval);
    };
  },
  "hf-gauge": (root) =>
    onClicks(root, "[data-g]", (button) => {
      const gauge = $(root, "#gg");
      if (!gauge) return;
      const step = button.dataset.g;
      gauge.value =
        step === "random"
          ? Math.round(Math.random() * 100)
          : Math.max(0, Math.min(100, numberAttr(gauge, "value") + Number(step ?? 0)));
    }),
  "hf-countdown": (root) => onClicks(root, "#cdGo", () => $(root, "#cd")?.restart?.(12)),
  "hf-banner": (root) => onClicks(root, "#bnBack", () => $(root, "#bn")?.show?.()),
  "hf-effort": (root) => {
    const effort = $(root, "#ef");
    if (!effort) return;
    const t = timers();
    const off = onSeen(
      effort,
      () => {
        t.timeout(() => (effort.value = "max"), 700);
        t.timeout(() => (effort.value = "ultracode"), 1500);
      },
      0.6,
    );
    return () => {
      off();
      t.clear();
    };
  },
  "hf-stat": (root) =>
    onClicks(root, "#stGo", () => {
      const stat = $(root, "#st");
      if (stat) stat.value = Math.round(numberAttr(stat, "value") * (0.95 + Math.random() * 0.12));
    }),
  "hf-split": (root) =>
    echo(root, "#spl", "#splOut", {
      select: (d) => `select → ${String(d.value)}`,
      action: (d) => `action → ${String(d.value)}`,
    }),
  "hf-dialog": (root) =>
    echo(root, "#dlg", "#dlgOut", {
      close: (d) =>
        d.returnValue === "send"
          ? `send → ${String(d.emails || "(no emails)")} as ${String(d.role)}`
          : `closed (${String(d.returnValue || "dismissed")})`,
    }),
  "hf-error": (root) =>
    onClicks(root, "[data-err]", (button) => $(root, "#err")?.setAttribute("code", button.dataset.err ?? "")),
  "hf-graph": (root) => {
    const graph = $(root, "#gph");
    if (!graph) return;
    const t = timers();
    const off = onSeen(graph, () => t.timeout(() => graph.run?.(), 500));
    return () => {
      off();
      t.clear();
    };
  },
};
