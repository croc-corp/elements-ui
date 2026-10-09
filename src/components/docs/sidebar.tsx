"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { ChevronRightIcon, CloseIcon, CollectionGlyph, SearchIcon } from "@/components/icons";
import type { Nav } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** Whether any field contains the query (an empty query matches everything). */
function matches(q: string, ...fields: (string | undefined)[]) {
  const s = q.trim().toLowerCase();
  return !s || fields.some((f) => f?.toLowerCase().includes(s));
}

/** The docs navigation: a filter, the guides and every collection with its components, expandable. */
export function SidebarNav({ nav, onNavigate }: { nav: Nav; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [q, setQ] = React.useState("");
  const current = nav.collections.find((c) => pathname.startsWith(c.href))?.slug;
  const [open, setOpen] = React.useState<Record<string, boolean>>(() => (current ? { [current]: true } : {}));
  const listRef = React.useRef<HTMLDivElement>(null);

  // entering a collection expands it, and it stays expanded (adjusted during render rather than in an effect)
  const [expandedFor, setExpandedFor] = React.useState(current);
  if (current !== expandedFor) {
    setExpandedFor(current);
    if (current) setOpen((o) => ({ ...o, [current]: true }));
  }

  // keep the active link in view when the page changes
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[aria-current=page]");
    el?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  const filtering = q.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-3">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface/60 px-2.5 text-muted-foreground transition-colors focus-within:border-ring focus-within:bg-surface">
          <SearchIcon size={13} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter"
            aria-label="Filter the navigation"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button type="button" aria-label="Clear filter" onClick={() => setQ("")} className="hover:text-foreground">
              <CloseIcon size={12} />
            </button>
          )}
        </label>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-10 [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-24px),transparent)]">
        {nav.guides.map((g) => {
          const items = g.items.filter((i) => matches(q, i.title));
          if (!items.length) return null;
          return (
            <div key={g.title} className="mb-4">
              <p className="px-2 pt-2 pb-1.5 font-mono text-[11px] text-muted-foreground">{g.title}</p>
              <ul>
                {items.map((i) => (
                  <li key={i.href}>
                    <NavLink href={i.href} active={pathname === i.href} onNavigate={onNavigate}>
                      {i.title}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <p className="px-2 pt-2 pb-1.5 font-mono text-[11px] text-muted-foreground">Collections</p>
        {nav.collections.map((c) => {
          const groups = c.groups.map((g) => ({ ...g, items: g.items.filter((i) => matches(q, i.title, i.tag, c.title)) })).filter((g) => g.items.length);
          if (filtering && !groups.length) return null;
          const expanded = filtering || open[c.slug];
          return (
            <div key={c.slug} className="mb-0.5">
              <div className="flex items-center">
                <Link
                  href={c.href}
                  onClick={onNavigate}
                  aria-current={pathname === c.href ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] transition-colors",
                    pathname === c.href ? "bg-muted font-medium text-foreground" : "text-foreground/85 hover:text-foreground",
                  )}
                >
                  <CollectionGlyph slug={c.slug} size={15} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{c.title}</span>
                  <span className="tabular ml-auto font-mono text-[10.5px] text-muted-foreground">{c.count}</span>
                </Link>
                <button
                  type="button"
                  aria-label={expanded ? `Collapse ${c.title}` : `Expand ${c.title}`}
                  aria-expanded={expanded}
                  onClick={() => setOpen((o) => ({ ...o, [c.slug]: !o[c.slug] }))}
                  className="ml-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <ChevronRightIcon size={13} className={cn("transition-transform duration-300 ease-[var(--ease-expo)]", expanded && "rotate-90")} />
                </button>
              </div>
              <div inert={!expanded} className={cn("grid transition-[grid-template-rows] duration-400 ease-[var(--ease-expo)]", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <div className="overflow-hidden">
                  <div className="relative ml-[15px] border-l border-border pb-2 pl-2">
                    {groups.map((g) => (
                      <div key={g.title} className="pt-2">
                        <p className="px-2 pb-1 text-[11.5px] font-medium text-muted-foreground">{g.title}</p>
                        <ul>
                          {g.items.map((i) => (
                            <li key={i.href}>
                              <NavLink href={i.href} active={pathname === i.href} onNavigate={onNavigate} isNew={i.isNew} tabIndex={expanded ? 0 : -1}>
                                {i.title}
                              </NavLink>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NavLink({
  href,
  active,
  children,
  onNavigate,
  isNew,
  tabIndex,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  onNavigate?: () => void;
  isNew?: boolean;
  tabIndex?: number;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      tabIndex={tabIndex}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] transition-colors",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="truncate">{children}</span>
      {isNew && <span className="ml-auto rounded-[4px] border border-border px-1 font-mono text-[9.5px] leading-[15px] text-muted-foreground">new</span>}
    </Link>
  );
}
