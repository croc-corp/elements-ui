"use client";

import * as React from "react";

import { usePrefersReducedMotion } from "@/components/home/motion";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";

const ITEM = `${site.registry.namespace}/hf-gauge`;
const CMD = `npx shadcn@latest add ${ITEM}`;
/** What the CLI prints for this item: the element, its React wrapper and the two shared modules. */
const OUTPUT: { text: string; ok?: boolean }[] = [
  { text: "✔ Checking registry.", ok: true },
  { text: `✔ Resolving ${ITEM} and 2 dependencies.`, ok: true },
  { text: "✔ Created 4 files:", ok: true },
  { text: "  - lib/lumesec/pixel.ts" },
  { text: "  - lib/lumesec/react.ts" },
  { text: "  - components/lumesec/hf-gauge.element.ts" },
  { text: "  - components/lumesec/hf-gauge.tsx" },
  { text: `ℹ Gauge docs: ${new URL(site.url).host}/components/pixel-hd/gauge` },
];
/** The whole session as one sentence for screen readers, which skip the typing animation. */
const TRANSCRIPT = `Terminal: ${CMD}. ${OUTPUT.map((l) => l.text.replace(/^[✔ℹ]\s*/, "").trim()).join(" ")}`;

/** Types the install command once it is visible, then prints the CLI output line by line. */
export function TerminalDemo({ className }: { className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [typedChars, setTyped] = React.useState(0);
  const [printedLines, setLines] = React.useState(0);
  const [started, setStarted] = React.useState(false);
  // with reduced motion the whole session shows at once
  const typed = reduced ? CMD.length : typedChars;
  const lines = reduced ? OUTPUT.length : printedLines;

  React.useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        setStarted(true);
        io.disconnect();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  React.useEffect(() => {
    if (!started || reduced) return;
    if (typed < CMD.length) {
      const id = window.setTimeout(() => setTyped((t) => t + 1), typed === 0 ? 300 : 24 + Math.random() * 40);
      return () => clearTimeout(id);
    }
    if (lines < OUTPUT.length) {
      const id = window.setTimeout(() => setLines((l) => l + 1), lines === 0 ? 420 : lines < 3 ? 260 : 90);
      return () => clearTimeout(id);
    }
  }, [started, reduced, typed, lines]);

  const done = typed >= CMD.length;
  return (
    <div ref={ref} className={cn("overflow-hidden rounded-xl border border-border bg-[var(--code-bg)] font-mono text-[12.5px] leading-[1.75]", className)}>
      <div className="flex h-9 items-center gap-2 border-b border-border px-3.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </span>
        <span className="ml-2 text-[11px] text-muted-foreground">~/app</span>
      </div>
      <p className="sr-only">{TRANSCRIPT}</p>
      {/* typed out for sighted users; the paragraph above carries the same text at once */}
      <div className="min-h-[248px] overflow-x-auto px-4 py-3.5" aria-hidden>
        <p className="whitespace-pre-wrap break-all">
          <span className="text-muted-foreground">$ </span>
          {CMD.slice(0, typed)}
          {!done || lines === 0 ? <span className="ml-px inline-block h-[1.1em] w-[7px] translate-y-[3px] animate-[sl-caret_1s_steps(1)_infinite] bg-foreground" aria-hidden /> : null}
        </p>
        {OUTPUT.slice(0, lines).map((l, i) => (
          <p key={i} className={cn("animate-[sl-fade_.25s_ease] whitespace-pre", l.ok ? "text-foreground" : "text-muted-foreground")}>
            {l.ok ? (
              <>
                <span className="text-success">{l.text.slice(0, 1)}</span>
                {l.text.slice(1)}
              </>
            ) : (
              l.text
            )}
          </p>
        ))}
      </div>
    </div>
  );
}
