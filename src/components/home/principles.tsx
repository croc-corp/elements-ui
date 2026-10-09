"use client";

import Link from "next/link";
import * as React from "react";

import { type EffortLevel, EffortSlider } from "@/components/lumesec/effort-slider";
import { ArrowRightIcon } from "@/components/icons";
import { ComponentPreview } from "@/components/preview/component-preview";
import { cn, pad2 } from "@/lib/utils";

export type Principle = {
  title: string;
  body: string;
  tag: string;
  html: string;
  layout: "center" | "fill" | "wide";
  href: string;
  name: string;
};

/**
 * Sticky stage on the right, principles scrolling on the left. The principle in the middle
 * of the viewport drives which live component is shown.
 */
export function Principles({ items }: { items: Principle[] }) {
  const [active, setActive] = React.useState(0);
  // the previous principle stays rendered while it fades out, everything else is display:none
  // so its animation loop pauses (elements stop when they are not in the viewport)
  const [leaving, setLeaving] = React.useState<number | null>(null);
  const [previous, setPrevious] = React.useState(0);
  if (active !== previous) {
    setPrevious(active);
    setLeaving(previous);
  }
  React.useEffect(() => {
    if (leaving === null) return;
    const id = window.setTimeout(() => setLeaving(null), 750);
    return () => window.clearTimeout(id);
  }, [leaving]);
  const [seen, setSeen] = React.useState<Set<number>>(() => new Set([0]));
  const listRef = React.useRef<HTMLOListElement>(null);

  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (!e.isIntersecting) continue;
          if (!(e.target instanceof HTMLElement)) continue;
          const i = Number(e.target.dataset.i);
          setActive(i);
          setSeen((s) => (s.has(i) ? s : new Set(s).add(i)));
        }
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    list.querySelectorAll("[data-i]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <ol ref={listRef} className="relative lg:border-r lg:border-border">
        {items.map((p, i) => (
          <li
            key={p.title}
            data-i={i}
            className="flex min-h-0 flex-col justify-center border-b border-line px-4 py-12 last:border-b-0 sm:px-8 lg:min-h-[64vh] lg:py-16"
          >
            <div className={cn("transition-opacity duration-500", active === i ? "lg:opacity-100" : "lg:opacity-35")}>
              <p className="sl-eyebrow">
                <span className="tabular text-foreground">{pad2(i + 1)}</span>
                <span data-sep />
                <span>&lt;{p.tag}&gt;</span>
              </p>
              <h3 className="mt-4 text-[30px] leading-[1.08] font-medium tracking-[-0.03em] sm:text-[38px]">
                {p.title}
              </h3>
              <p className="mt-4 max-w-[46ch] text-[16px] leading-[1.7] text-muted-foreground">{p.body}</p>
              <Link href={p.href} className="group/p mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-medium">
                {p.name}
                <ArrowRightIcon size={14} className="transition-transform duration-300 group-hover/p:translate-x-0.5" />
              </Link>
            </div>
            {/* small screens: the component sits under its principle */}
            <div className="mt-8 overflow-hidden rounded-xl border border-border lg:hidden">
              <ComponentPreview variant="hero" tag={p.tag} html={p.html} layout={p.layout} minHeight={260} />
            </div>
          </li>
        ))}
      </ol>
      <div className="hidden lg:block">
        <div className="sticky top-[calc(var(--header-height)+48px)] flex h-[calc(100dvh-var(--header-height)-96px)] min-h-[520px] flex-col p-8">
          <div className="sl-dot-grid relative flex-1 overflow-hidden rounded-2xl border border-border bg-surface/40">
            <span className="sl-cross top-3 left-3" />
            <span className="sl-cross top-3 right-3" />
            <span className="sl-cross bottom-3 left-3" />
            <span className="sl-cross right-3 bottom-3" />
            {items.map((p, i) =>
              seen.has(i) ? (
                <div
                  key={p.tag}
                  data-p={i}
                  aria-hidden={active !== i}
                  className={cn(
                    "absolute inset-0 grid place-items-center transition-[opacity,transform,filter] duration-700 ease-[var(--ease-expo)]",
                    active === i ? "opacity-100" : "pointer-events-none scale-[.97] opacity-0 blur-[2px]",
                    active !== i && leaving !== i && "hidden",
                  )}
                >
                  <div className="principle-stage w-full">
                    <ComponentPreview
                      variant="card"
                      tag={p.tag}
                      html={p.html}
                      layout={p.layout}
                      eager
                      className="bg-transparent"
                    >
                      {/* the first principle plays its own moment: the slider climbs to Ultracode */}
                      {p.tag === "effort-slider" ? <ClimbingSlider play={active === 0} /> : undefined}
                    </ComponentPreview>
                  </div>
                </div>
              ) : null,
            )}
          </div>
          <div className="mt-5 flex items-center gap-4">
            <span className="tabular font-mono text-[11px] text-muted-foreground">
              {pad2(active + 1)} / {pad2(items.length)}
            </span>
            <div className="relative h-px flex-1 bg-border">
              <span
                className="absolute inset-y-0 left-0 bg-electric transition-[width] duration-700 ease-[var(--ease-expo)]"
                style={{ width: `${((active + 1) / items.length) * 100}%` }}
              />
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">{items[active]?.name}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Ultracode slider stepping high → max → ultracode each time its principle becomes active. */
function ClimbingSlider({ play }: { play: boolean }) {
  const [level, setLevel] = React.useState<EffortLevel>("ultracode");
  React.useEffect(() => {
    if (!play) return;
    const steps: [EffortLevel, number][] = [
      ["high", 0],
      ["max", 900],
      ["ultracode", 1700],
    ];
    const ids = steps.map(([step, delay]) => window.setTimeout(() => setLevel(step), delay));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [play]);
  return <EffortSlider value={level} onValueChange={setLevel} recommended="medium" className="w-full max-w-[380px]" />;
}
