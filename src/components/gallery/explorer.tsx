"use client";

import Link from "next/link";
import * as React from "react";

import { ArrowRightIcon, CloseIcon, CollectionGlyph, SearchIcon } from "@/components/icons";
import { type CardData, ComponentCard } from "@/components/preview/component-card";
import { track } from "@/lib/track";
import { cn, pad2 } from "@/lib/utils";

/** A card plus what the filter and the sort orders need. */
export type ExplorerCard = CardData & { order: number; added: string; keywords: string; group: string | null };
type Col = { slug: string; title: string; count: number; summary: string };
type Sort = "catalog" | "newest" | "az";

const isSort = (value: string | null): value is Sort => value === "catalog" || value === "newest" || value === "az";

/** How well a card matches the lower-cased query: 4 exact, 3 prefix, 2 substring, 1 every word in its keywords, 0 none. */
function score(c: ExplorerCard, q: string) {
  if (!q) return 1;
  const t = c.title.toLowerCase();
  if (t === q || c.tag === q) return 4;
  if (t.startsWith(q) || c.tag.endsWith(q)) return 3;
  if (t.includes(q) || c.tag.includes(q)) return 2;
  return q.split(/\s+/).every((w) => c.keywords.includes(w)) ? 1 : 0;
}

type ExplorerState = { q: string; col: string; sort: Sort };

const URL_EVENT = "elements:explorer-url";

function subscribeToUrl(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(URL_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(URL_EVENT, onChange);
  };
}

/**
 * The filter, collection and sort live in the query string, so a view can be shared and survives a reload.
 * The page is static: it renders the defaults on the server and reads the URL once hydrated.
 */
function useExplorerState(collections: Col[]) {
  const search = React.useSyncExternalStore(subscribeToUrl, () => window.location.search, () => "");
  const params = new URLSearchParams(search);
  const collection = params.get("c");
  const order = params.get("sort");
  const state: ExplorerState = {
    q: params.get("q") ?? "",
    col: collection && collections.some((c) => c.slug === collection) ? collection : "all",
    sort: isSort(order) ? order : "catalog",
  };
  const update = (changes: Partial<ExplorerState>) => {
    const next = { ...state, ...changes };
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.col !== "all") p.set("c", next.col);
    if (next.sort !== "catalog") p.set("sort", next.sort);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    window.dispatchEvent(new Event(URL_EVENT));
  };
  return [state, update] as const;
}

/** The components page: filter, collection chips and sort, kept in the URL so a view can be shared. */
export function ComponentsExplorer({ cards, collections }: { cards: ExplorerCard[]; collections: Col[] }) {
  const [{ q, col, sort }, update] = useExplorerState(collections);
  const setQ = (value: string) => update({ q: value });
  const setCol = (value: string) => update({ col: value });

  React.useEffect(() => {
    if (q.length < 2) return;
    const id = window.setTimeout(() => track("search", q.slice(0, 60), { source: "gallery" }), 900);
    return () => window.clearTimeout(id);
  }, [q]);

  const query = q.trim().toLowerCase();
  const list = React.useMemo(() => {
    let out = cards.filter((c) => (col === "all" || c.collection === col) && score(c, query) > 0);
    if (query) out = out.sort((a, b) => score(b, query) - score(a, query) || a.order - b.order);
    else if (sort === "newest") out = [...out].sort((a, b) => b.added.localeCompare(a.added) || b.order - a.order);
    else if (sort === "az") out = [...out].sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }, [cards, col, query, sort]);

  const grouped = !query && sort === "catalog" && col === "all";
  const total = cards.length;

  return (
    <div>
      {/* filter bar */}
      <div className="sticky top-[calc(var(--header-height)+var(--subnav-height))] z-20 border-b border-border bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 text-muted-foreground transition-colors focus-within:border-ring focus-within:bg-surface lg:w-[280px]">
            <SearchIcon size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name, tag or attribute"
              aria-label="Filter components"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {q && (
              <button type="button" aria-label="Clear the filter" onClick={() => setQ("")} className="hover:text-foreground">
                <CloseIcon size={13} />
              </button>
            )}
          </label>
          <div role="group" aria-label="Collection" className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
            <Chip active={col === "all"} onClick={() => setCol("all")} count={total}>
              All
            </Chip>
            {collections.map((c) => (
              <Chip key={c.slug} active={col === c.slug} onClick={() => setCol(c.slug)} count={c.count} glyph={c.slug}>
                {c.title}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-3 lg:ml-auto">
            <span className="tabular font-mono text-[11.5px] whitespace-nowrap text-muted-foreground" aria-live="polite">
              {list.length} of {total}
            </span>
            <select
              value={sort}
              onChange={(e) => {
                if (isSort(e.target.value)) update({ sort: e.target.value });
              }}
              aria-label="Sort"
              className="h-9 rounded-lg border border-border bg-surface/60 px-2.5 text-[13px] outline-none hover:border-input focus:border-ring"
            >
              <option value="catalog">Catalog order</option>
              <option value="newest">Newest first</option>
              <option value="az">A to Z</option>
            </select>
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="grid place-items-center px-6 py-28 text-center">
          <p className="font-mono text-[12px] text-muted-foreground">No match</p>
          <p className="mt-3 max-w-sm text-[15px] text-muted-foreground">Nothing matches “{q}”. Try a shorter word, a tag such as <code className="font-mono text-foreground">gauge</code>, or another collection.</p>
          <button
            type="button"
            onClick={() => update({ q: "", col: "all" })}
            className="mt-6 h-9 rounded-lg border border-border px-3 text-[13px] font-medium hover:border-input"
          >
            Reset filters
          </button>
        </div>
      ) : grouped ? (
        collections.map((c, i) => (
          <section key={c.slug} aria-labelledby={`col-${c.slug}`}>
            <header className="sl-rule flex flex-col gap-2 border-b border-border px-4 pt-12 pb-6 sm:flex-row sm:items-end sm:justify-between sm:px-6">
              <div>
                <p className="sl-eyebrow">
                  <span className="tabular text-foreground">{pad2(i + 1)}</span>
                  <span data-sep />
                  <span>{c.count} components</span>
                </p>
                <h2 id={`col-${c.slug}`} className="mt-3 flex items-center gap-3 text-[28px] font-medium tracking-[-0.03em]">
                  <CollectionGlyph slug={c.slug} size={20} className="text-muted-foreground" />
                  {c.title}
                </h2>
                <p className="mt-1.5 max-w-xl text-[14.5px] text-muted-foreground">{c.summary}</p>
              </div>
              <Link href={`/components/${c.slug}`} className="group/l flex items-center gap-1.5 text-[13.5px] font-medium whitespace-nowrap">
                Open collection
                <ArrowRightIcon size={14} className="transition-transform duration-300 group-hover/l:translate-x-0.5" />
              </Link>
            </header>
            <Grid items={list.filter((x) => x.collection === c.slug)} />
          </section>
        ))
      ) : (
        <Grid items={list} key={`${col}-${sort}-${query}`} />
      )}
    </div>
  );
}

function Grid({ items }: { items: ExplorerCard[] }) {
  return (
    <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 in-data-[layout=full]:2xl:grid-cols-5">
      {items.map((c, i) => (
        <ComponentCard key={c.tag} data={c} index={i} className="animate-[sl-fade_.5s_var(--ease-out)_both]" />
      ))}
      {/* fill the last row so the hairline grid stays closed */}
      {Array.from({ length: (4 - (items.length % 4)) % 4 }, (_, i) => (
        <div key={`f${i}`} className="hidden bg-background 2xl:block" aria-hidden />
      ))}
    </div>
  );
}

function Chip({ active, onClick, count, glyph, children }: { active: boolean; onClick: () => void; count: number; glyph?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-input hover:text-foreground",
      )}
    >
      {glyph && <CollectionGlyph slug={glyph} size={13} />}
      {children}
      <span className={cn("tabular font-mono text-[10.5px]", active ? "text-background/70" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}
