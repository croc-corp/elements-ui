"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { ArrowRightIcon, BookIcon, GitHubIcon, GridIcon, LayersIcon, MenuIcon, SearchIcon } from "@/components/icons";
import { BrandMenu } from "@/components/site/brand-menu";
import { MobileSheet } from "@/components/site/mobile-sheet";
import { useModifierKey, useSearch } from "@/components/site/search-context";
import { ThemeToggle } from "@/components/site/theme";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";

/** A collection as the header and the mobile menu list it. */
export type NavCollection = { slug: string; title: string; count: number };

type HeaderProps = {
  /** Number of components, shown on the Components link. */
  total: number;
  collections: NavCollection[];
};

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/** Pill navigation with a highlight that glides to the hovered item and rests on the active one. */
function PillNav({ items }: { items: { href: string; label: string; count?: number; Icon: typeof GridIcon }[] }) {
  const pathname = usePathname();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const [box, setBox] = React.useState({ x: 0, w: 0 });
  const activeIndex = items.findIndex((i) => isActive(pathname, i.href));
  const target = hover ?? (activeIndex >= 0 ? activeIndex : null);

  // measured before paint, so the highlight never shows at a stale position
  React.useLayoutEffect(() => {
    if (target === null) return;
    const link = listRef.current?.querySelectorAll<HTMLElement>("a")[target];
    if (link) setBox({ x: link.offsetLeft, w: link.offsetWidth });
  }, [target, pathname]);

  return (
    <nav aria-label="Primary" className="hidden lg:block">
      <div
        ref={listRef}
        onMouseLeave={() => setHover(null)}
        className="relative flex items-center gap-0.5 rounded-full border border-border bg-card/80 p-1 shadow-[var(--shadow-drop-sm)]"
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-muted transition-[transform,width,opacity] duration-300 ease-[var(--ease-expo)]",
            target !== null ? "opacity-100" : "opacity-0",
          )}
          style={{ transform: `translateX(${box.x}px)`, width: box.w }}
        />
        {items.map((item, i) => {
          const active = i === activeIndex;
          return (
            <Link
              key={item.href}
              href={item.href}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative z-10 flex h-8 items-center gap-2 rounded-full px-3 text-[13.5px] font-medium tracking-[0.01em] transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.Icon size={15} />
              {item.label}
              {item.count !== undefined && (
                <span className="tabular rounded-[5px] bg-foreground px-1.5 py-px font-mono text-[10px] leading-4 text-background">
                  {item.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function SearchButton() {
  const { open } = useSearch();
  const modifier = useModifierKey();
  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-keyshortcuts="Meta+K Control+K"
        className="group hidden h-8 w-[200px] items-center gap-2 rounded-lg border border-border bg-surface/60 pr-1.5 pl-2.5 text-[13px] text-muted-foreground transition-[border-color,background-color] hover:border-input hover:bg-surface md:flex xl:w-[220px]"
      >
        <SearchIcon size={14} />
        <span className="flex-1 truncate text-left whitespace-nowrap">Search…</span>
        <span className="sl-kbd" aria-hidden>
          {modifier}
        </span>
        <span className="sl-kbd -ml-1" aria-hidden>
          K
        </span>
      </button>
      <button
        type="button"
        onClick={open}
        aria-label="Search"
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground md:hidden"
      >
        <SearchIcon />
      </button>
    </>
  );
}

/** Opens the bottom sheet that holds the whole menu on small screens. */
function MenuButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Open menu"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
      className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground lg:hidden"
    >
      <MenuIcon />
    </button>
  );
}

/** The announcement bar above the header. */
export function Banner() {
  return (
    <div className="relative z-50 bg-foreground text-background">
      <Link
        href="/docs/data"
        className="group mx-auto flex h-[var(--banner-height)] max-w-[var(--container)] items-center justify-center gap-2 px-4 text-[13px] font-medium"
      >
        <span className="font-mono text-[11px] opacity-60">New</span>
        <span className="h-3 w-px bg-background/25" aria-hidden />
        <span className="truncate">Your data: charts, lists and meters that take your records</span>
        <ArrowRightIcon
          size={14}
          className="shrink-0 transition-transform duration-300 ease-[var(--ease-expo)] group-hover:translate-x-1"
        />
      </Link>
    </div>
  );
}

/** The sticky site header: logo menu, primary navigation, search, GitHub, theme and the mobile menu. */
export function Header({ total, collections }: HeaderProps) {
  const items = [
    { href: "/components", label: "Components", count: total, Icon: GridIcon },
    { href: "/collections", label: "Collections", count: collections.length, Icon: LayersIcon },
    { href: "/docs", label: "Docs", Icon: BookIcon },
  ];
  // the path the sheet was opened on: navigating anywhere else closes it
  const pathname = usePathname();
  const [sheetPath, setSheetPath] = React.useState<string | null>(null);
  const sheet = sheetPath === pathname;
  const openSheet = () => setSheetPath(pathname);
  return (
    <>
      <header className="sticky top-0 z-40 bg-background/80 px-2 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="relative mx-auto grid h-[var(--header-height)] max-w-[calc(var(--container)-16px)] grid-cols-[1fr_auto] items-center gap-4 border-x border-border pr-2 pl-4 before:pointer-events-none before:absolute before:top-0 before:-left-[100vw] before:h-px before:w-[200vw] before:bg-border after:pointer-events-none after:absolute after:bottom-0 after:-left-[100vw] after:h-px after:w-[200vw] after:bg-border in-data-[layout=full]:max-w-none lg:grid-cols-[1fr_auto_1fr]">
          <BrandMenu onCompactOpen={openSheet} />
          <PillNav items={items} />
          <div className="flex items-center justify-end gap-1">
            <SearchButton />
            <a
              href={site.repo.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
              className="hidden size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground sm:inline-flex"
            >
              <GitHubIcon />
            </a>
            <ThemeToggle className="hidden sm:inline-flex" />
            <MenuButton open={sheet} onOpen={openSheet} />
          </div>
        </div>
      </header>
      <MobileSheet open={sheet} onClose={() => setSheetPath(null)} collections={collections} total={total} />
    </>
  );
}
