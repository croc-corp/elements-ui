"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { CollectionGlyph, GridIcon, MenuIcon, WidthIcon } from "@/components/icons";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";

type Col = { slug: string; title: string; count: number };

const LAYOUT_EVENT = "elements:layout";

const subscribeLayout = (onChange: () => void) => {
  window.addEventListener(LAYOUT_EVENT, onChange);
  return () => window.removeEventListener(LAYOUT_EVENT, onChange);
};

/**
 * The full-width layout, stored on <html data-layout> (set before paint by the theme script) and in
 * localStorage. Every instance follows the same attribute.
 */
function useFullWidth() {
  const full = React.useSyncExternalStore(
    subscribeLayout,
    () => document.documentElement.dataset.layout === "full",
    () => false,
  );
  const toggle = () => {
    const next = !full;
    if (next) document.documentElement.dataset.layout = "full";
    else delete document.documentElement.dataset.layout;
    try {
      localStorage.setItem("layout", next ? "full" : "contained");
    } catch {
      // storage can be blocked; the layout still applies until the page is left
    }
    window.dispatchEvent(new Event(LAYOUT_EVENT));
  };
  return [full, toggle] as const;
}

/** Second header row: sections left, collection switcher centred, layout controls right. */
export function SubNav({ collections, onMenu }: { collections: Col[]; onMenu?: () => void }) {
  const pathname = usePathname();
  const [full, toggleFull] = useFullWidth();
  const active = collections.find((c) => pathname.startsWith(`/components/${c.slug}`))?.slug ?? null;
  const section = pathname.startsWith("/docs") ? "guides" : "components";

  return (
    <div className="sticky top-[var(--header-height)] z-30 bg-background/80 px-2 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="relative mx-auto grid h-[var(--subnav-height)] max-w-[calc(var(--container)-16px)] grid-cols-[auto_1fr_auto] items-center gap-3 border-x border-border px-2 after:pointer-events-none after:absolute after:bottom-0 after:-left-[100vw] after:h-px after:w-[200vw] after:bg-border in-data-[layout=full]:max-w-none sm:px-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-1">
          {onMenu && (
            <button
              type="button"
              onClick={onMenu}
              aria-label="Open navigation"
              aria-haspopup="dialog"
              className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-muted/60 hover:text-foreground lg:hidden"
            >
              <MenuIcon size={15} />
              <span className="font-medium">Menu</span>
            </button>
          )}
          <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
            {[
              { id: "guides", href: "/docs", label: "Guides" },
              { id: "components", href: "/components", label: "Components" },
            ].map((t) => (
              <Link
                key={t.id}
                href={t.href}
                aria-current={section === t.id ? "page" : undefined}
                className={cn(
                  "relative flex h-[var(--subnav-height)] items-center px-2.5 text-[13.5px] font-medium transition-colors",
                  section === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "absolute inset-x-2.5 bottom-0 h-px origin-left bg-foreground transition-transform duration-300 ease-[var(--ease-expo)]",
                    section === t.id ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </Link>
            ))}
          </nav>
        </div>

        <nav
          aria-label="Collections"
          className="flex min-w-0 [scrollbar-width:none] items-center justify-center overflow-x-auto"
        >
          <div className="flex items-center gap-0.5">
            <SwitchItem
              href="/components"
              label="All components"
              active={pathname === "/components"}
              glyph={<GridIcon size={16} />}
            />
            <span className="mx-1.5 h-4 w-px shrink-0 bg-border" aria-hidden />
            {collections.map((c) => (
              <SwitchItem
                key={c.slug}
                href={`/components/${c.slug}`}
                label={c.title}
                count={c.count}
                active={active === c.slug}
                glyph={<CollectionGlyph slug={c.slug} size={16} />}
              />
            ))}
          </div>
        </nav>

        <div className="flex items-center justify-end gap-2">
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">v{site.version}</span>
          <button
            type="button"
            onClick={toggleFull}
            aria-pressed={full}
            aria-label={full ? "Use contained width" : "Use full width"}
            title={full ? "Contained width" : "Full width"}
            className={cn(
              "hidden size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground xl:inline-flex",
              full && "bg-muted text-foreground",
            )}
          >
            <WidthIcon size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Icon-only until active or hovered; the label opens out on a spring. */
function SwitchItem({
  href,
  label,
  count,
  active,
  glyph,
}: {
  href: string;
  label: string;
  count?: number;
  active: boolean;
  glyph: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/sw relative flex h-[var(--subnav-height)] shrink-0 items-center px-1.5 transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex items-center rounded-md px-1.5 py-1 transition-colors",
          active ? "bg-muted" : "group-hover/sw:bg-muted/60",
        )}
      >
        {glyph}
        <span
          className={cn(
            "grid overflow-hidden text-[13px] font-medium whitespace-nowrap transition-[grid-template-columns,margin,opacity] duration-500 ease-[var(--ease-expo)]",
            active
              ? "ml-2 grid-cols-[1fr] opacity-100"
              : "ml-0 grid-cols-[0fr] opacity-0 group-hover/sw:ml-2 group-hover/sw:grid-cols-[1fr] group-hover/sw:opacity-100 group-focus-visible/sw:ml-2 group-focus-visible/sw:grid-cols-[1fr] group-focus-visible/sw:opacity-100",
          )}
        >
          <span className="min-w-0">
            {label}
            {count !== undefined && (
              <span className="tabular ml-1.5 font-mono text-[10.5px] text-muted-foreground">{count}</span>
            )}
          </span>
        </span>
      </span>
      <span
        className={cn(
          "absolute inset-x-2 bottom-0 h-px bg-foreground transition-transform duration-300 ease-[var(--ease-expo)]",
          active ? "scale-x-100" : "scale-x-0",
        )}
      />
    </Link>
  );
}
