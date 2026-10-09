"use client";

import { AnchorProvider, type TableOfContents, useActiveAnchors } from "fumadocs-core/toc";
import * as React from "react";

import { cn } from "@/lib/utils";

/** One heading of a page, as fumadocs extracts it. */
export type TocEntry = TableOfContents[number];

/** "On this page": the headings of a page, with the visible sections marked. */
export function Toc({ items }: { items: TocEntry[] }) {
  if (!items.length) return null;
  return (
    <AnchorProvider toc={items} single={false}>
      <TocList items={items} />
    </AnchorProvider>
  );
}

/** Headings with one marker that glides to the first visible section. */
function TocList({ items }: { items: TocEntry[] }) {
  const active = useActiveAnchors();
  const listRef = React.useRef<HTMLOListElement>(null);
  const [marker, setMarker] = React.useState<{ top: number; height: number } | null>(null);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const links = active.flatMap((id) => list.querySelector<HTMLElement>(`a[href="#${CSS.escape(id)}"]`) ?? []);
    const first = links[0];
    const last = links[links.length - 1];
    // measured before paint, so the marker never shows at a stale position
    setMarker(
      first && last ? { top: first.offsetTop, height: last.offsetTop + last.offsetHeight - first.offsetTop } : null,
    );
  }, [active]);

  return (
    <nav aria-label="On this page">
      <p className="mb-3 font-mono text-[11px] text-muted-foreground">On this page</p>
      <div className="relative">
        <span className="absolute top-0 bottom-0 left-0 w-px bg-border" aria-hidden />
        <span
          aria-hidden
          className={cn(
            "absolute left-0 w-px bg-electric transition-[transform,height,opacity] duration-300 ease-[var(--ease-expo)]",
            marker ? "opacity-100" : "opacity-0",
          )}
          style={{ transform: `translateY(${marker?.top ?? 0}px)`, height: marker?.height ?? 0 }}
        />
        <ol ref={listRef} className="relative space-y-0.5">
          {items.map((it) => {
            const id = it.url.slice(1);
            const on = active.includes(id);
            return (
              <li key={it.url}>
                <a
                  href={it.url}
                  className={cn(
                    "block py-1 text-[13px] leading-snug transition-colors",
                    it.depth <= 2 ? "pl-3.5" : it.depth === 3 ? "pl-6" : "pl-8",
                    on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {it.title}
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
