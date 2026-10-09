"use client";

import Link from "next/link";
import * as React from "react";

import { ArrowRightIcon, CollectionGlyph } from "@/components/icons";
import { tagsIn, useDemoSetups, useElementLoader, useNearViewport } from "@/components/preview/component-preview";
import { DemoBoundary, isReactTag, ReactDemo } from "@/components/preview/react-demo";
import { cn } from "@/lib/utils";

/** What a card needs to know about its component. */
export type CardData = {
  tag: string;
  title: string;
  collection: string;
  href: string;
  /** Demo markup for custom elements. */
  stage: string;
  stageClass?: string;
  layout: "center" | "fill" | "wide";
  isNew?: boolean;
  /** The component shows invented data only (no input for your own values). */
  demo?: boolean;
};

/** A live, lazily mounted component in a grid. The demo is interactive; the footer links to its page. */
export function ComponentCard({ data, height = 248, className, index = 0, zoom }: { data: CardData; height?: number; className?: string; index?: number; zoom?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref, false, "200px");
  const tags = React.useMemo(() => tagsIn(data.stage, data.tag), [data.stage, data.tag]);
  const isReact = isReactTag(data.tag);
  const elementsReady = useElementLoader(tags, near && !isReact);
  const [demoReady, setDemoReady] = React.useState(false);
  const markDemoReady = React.useCallback(() => setDemoReady(true), []);
  const ready = isReact ? demoReady : elementsReady;

  useDemoSetups(stageRef, tags, !isReact && ready);

  const scaled = data.layout !== "center";
  const extra = data.stageClass?.replace(/\bstage\b/, "").trim();
  useFitToCard(stageRef, ready && !scaled);

  const stageClass = cn("stage elements-stage !absolute !inset-0 !min-h-0", extra, scaled && "card-scaled");

  return (
    <div
      ref={ref}
      style={{ "--i": index % 6 } as React.CSSProperties}
      className={cn("group/card relative flex flex-col overflow-hidden bg-background transition-colors duration-300", className)}
    >
      <div className="sl-dot-grid relative overflow-hidden" style={{ height, ...(zoom ? { "--card-zoom": zoom } : {}) } as React.CSSProperties}>
        {near && isReact && (
          <div ref={stageRef} data-layout={data.layout} data-kind="react" data-ready={ready || undefined} className={stageClass}>
            <DemoBoundary tag={data.tag}>
              <ReactDemo tag={data.tag} onReady={markDemoReady} />
            </DemoBoundary>
          </div>
        )}
        {near && !isReact && (
          // demo markup from the lab gallery: static, authored in this repository
          <div ref={stageRef} data-layout={data.layout} data-ready={ready || undefined} className={stageClass} dangerouslySetInnerHTML={{ __html: data.stage }} />
        )}
        {!ready && <span className="absolute inset-0 grid place-items-center font-mono text-[11px] text-muted-foreground/70">&lt;{data.tag}&gt;</span>}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent" aria-hidden />
      </div>
      <Link href={data.href} className="relative flex items-center gap-3 border-t border-border px-4 py-3 transition-colors hover:bg-surface">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[14px] font-medium tracking-tight">
            <span className="truncate">{data.title}</span>
            {data.isNew && <span className="rounded-[4px] border border-border px-1 font-mono text-[9.5px] leading-[15px] text-muted-foreground">new</span>}
            {data.demo && (
              <span title="Shows invented demo data and cannot show your own yet. Use it as a template." className="shrink-0 rounded-[4px] border border-dashed border-border px-1 font-mono text-[9.5px] leading-[15px] text-muted-foreground">
                demo data
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
            <CollectionGlyph slug={data.collection} size={11} className="shrink-0" />
            {data.tag}
          </span>
        </span>
        <ArrowRightIcon size={14} className="shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-300 ease-[var(--ease-expo)] group-hover/card:translate-x-0 group-hover/card:opacity-100" />
        <span className="sr-only">Open {data.title}</span>
      </Link>
    </div>
  );
}

/**
 * A centred demo that is taller or wider than its card is scaled down (CSS zoom on the demo root) until it
 * fits inside the stage's padding, so nothing important is cut off. It re-fits when the demo resizes.
 */
function useFitToCard(stageRef: React.RefObject<HTMLDivElement | null>, active: boolean) {
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!active || !stage) return;
    return fitToCard(stage);
  }, [stageRef, active]);
}

/** Zooms the stage's first child to fit and keeps it fitted; returns the cleanup. */
function fitToCard(stage: HTMLElement) {
  const child = stage.firstElementChild;
  if (!(child instanceof HTMLElement)) return;
  const fit = () => {
    const style = getComputedStyle(stage);
    const availH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const availW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const current = Number(child.style.zoom || 1);
    const box = child.getBoundingClientRect();
    // the measured size includes the current zoom; divide it out to get the demo's natural size
    const h = box.height / current;
    const w = box.width / current;
    if (!h || !w) return;
    const next = Math.max(0.5, Math.floor(Math.min(1, availH / h, availW / w) * 100) / 100);
    if (Math.abs(next - current) > 0.01) child.style.zoom = String(next);
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(child);
  observer.observe(stage);
  return () => observer.disconnect();
}
