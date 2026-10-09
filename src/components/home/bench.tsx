import Link from "next/link";

import { Spotlight } from "@/components/home/motion";
import { ArrowUpRightIcon, CollectionGlyph } from "@/components/icons";
import { ComponentPreview } from "@/components/preview/component-preview";
import { elementHref, getElement } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/** The bench layout: which components, their column span on wide screens and their height. */
const CELLS: { tag: string; span: string; height: number }[] = [
  { tag: "effort-slider", span: "lg:col-span-4", height: 260 },
  { tag: "hf-gauge", span: "lg:col-span-4", height: 260 },
  { tag: "ui-dial", span: "lg:col-span-4", height: 260 },
  { tag: "hf-candles", span: "lg:col-span-8", height: 300 },
  { tag: "px-orb", span: "lg:col-span-4", height: 300 },
  { tag: "hf-composer", span: "lg:col-span-8", height: 280 },
  { tag: "ui-context-meter", span: "lg:col-span-4", height: 280 },
];

/** Fig. 1: live components on the bench, inside the Screen Line figure frame. */
export function Bench() {
  const cells = CELLS.flatMap((cell) => {
    const el = getElement(cell.tag);
    return el ? [{ ...cell, el }] : [];
  });
  const collectionsShown = new Set(cells.map((c) => c.el.collection)).size;
  return (
    <section className="sl-panel overflow-hidden" aria-label={`Figure 1: ${cells.length} live components`}>
      <div className="sl-dot-grid relative px-3 pt-12 pb-14 sm:px-10 sm:pt-16 sm:pb-16">
        <div className="relative mx-auto max-w-[1180px]">
          {/* construction lines that run past the figure */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <span className="sl-dash-x top-0" />
            <span className="sl-dash-x bottom-0" />
            <span className="sl-dash-y left-0" />
            <span className="sl-dash-y right-0" />
            <span className="sl-cross -top-1 -left-1" />
            <span className="sl-cross -top-1 -right-1" />
            <span className="sl-cross -bottom-1 -left-1" />
            <span className="sl-cross -right-1 -bottom-1" />
          </div>
          <div className="relative grid gap-px overflow-hidden rounded-[14px] border border-border bg-border shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_4%,transparent),0_40px_80px_-40px_rgb(0_0_0/0.5)] lg:grid-cols-12">
            {cells.map((c, i) => (
              <Spotlight key={c.tag} className={cn("reveal bg-background", c.span)}>
                <div style={{ "--i": i } as React.CSSProperties} className="relative z-10">
                  <div className="flex items-center justify-between px-4 pt-3.5">
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                      <CollectionGlyph slug={c.el.collection} size={11} />
                      &lt;{c.tag}&gt;
                    </span>
                    <Link
                      href={elementHref(c.el)}
                      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground opacity-0 transition-all duration-300 group-hover/spot:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                    >
                      {c.el.title}
                      <ArrowUpRightIcon size={11} />
                    </Link>
                  </div>
                  <ComponentPreview variant="card" tag={c.tag} html={c.el.stage} layout={c.el.layout === "wide" ? "fill" : c.el.layout} stageClass={c.el.stageClass} minHeight={c.height - 40} className="bg-transparent" />
                </div>
              </Spotlight>
            ))}
          </div>
        </div>
        <p className="relative mt-5 text-right font-mono text-[11px] text-caption">
          Fig. 1 · {cells.length} components from {collectionsShown} collections, running live · click, drag, type
        </p>
      </div>
    </section>
  );
}
