"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";

import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BookIcon,
  CloseIcon,
  CollectionGlyph,
  GitHubIcon,
  GridIcon,
  LayersIcon,
  SearchIcon,
} from "@/components/icons";
import { LumeSecLockup } from "@/components/site/lumesec-logo";
import type { NavCollection } from "@/components/site/header";
import { ProductMark } from "@/components/site/product-mark";
import { useSearch } from "@/components/site/search-context";
import { ThemeSegmented } from "@/components/site/theme";
import { lumesecPages, type ProductId, site } from "@/config/site";
import { trapTab } from "@/lib/focus-trap";
import { cn } from "@/lib/utils";

const PRODUCTS: { id: ProductId; name: string; note: string; href: string }[] = [
  { id: "aiop", name: "AI Operating Platform", note: "Predictable AI.", href: "https://lumesec.ai/solutions/platform" },
  { id: "securegrid", name: "SecureGrid", note: "Leak nothing.", href: "https://securegrid.dev/en" },
];

/** Drag distance in px after which releasing the handle closes the sheet. */
const CLOSE_DISTANCE = 96;

/**
 * The whole site menu on small screens, as a sheet that slides up from the bottom. It is a modal dialog:
 * focus moves into it, the page behind cannot scroll, and Escape, the backdrop, the close button or
 * dragging the handle down closes it. Navigating closes it too (the header keys it to the path).
 */
export function MobileSheet({
  open,
  onClose,
  collections,
  total,
}: {
  open: boolean;
  onClose: () => void;
  collections: NavCollection[];
  total: number;
}) {
  const pathname = usePathname();
  const { open: openSearch } = useSearch();
  const sheetRef = React.useRef<HTMLDivElement>(null);
  // follows `open` two frames late when opening, so the slide-in starts from below, and 320 ms late when
  // closing, so the slide-out can play before the sheet unmounts
  const [visible, setVisible] = React.useState(false);
  const [drag, setDrag] = React.useState(0);
  const dragStart = React.useRef<number | null>(null);
  const onEscape = React.useEffectEvent(() => onClose());

  React.useEffect(() => {
    if (open) {
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    const id = window.setTimeout(() => setVisible(false), 320);
    return () => window.clearTimeout(id);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    requestAnimationFrame(() => sheetRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
      if (sheetRef.current) trapTab(event, sheetRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  // closed sheets render nothing, so the portal below only ever runs in the browser
  if (!open && !visible) return null;

  const close = () => onClose();
  const shown = open && visible;

  const handlers = {
    onPointerDown: (event: React.PointerEvent) => {
      dragStart.current = event.clientY;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (dragStart.current !== null) setDrag(Math.max(0, event.clientY - dragStart.current));
    },
    onPointerUp: () => {
      if (dragStart.current === null) return;
      dragStart.current = null;
      if (drag > CLOSE_DISTANCE) close();
      setDrag(0);
    },
    onPointerCancel: () => {
      dragStart.current = null;
      setDrag(0);
    },
  };

  const primary = [
    { href: "/components", label: "Components", meta: String(total), Icon: GridIcon },
    { href: "/collections", label: "Collections", meta: String(collections.length), Icon: LayersIcon },
    { href: "/docs", label: "Docs", meta: "", Icon: BookIcon },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={close}
        className={cn(
          "absolute inset-0 bg-black/45 backdrop-blur-[2px] transition-opacity duration-300",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        style={{ transform: shown ? `translateY(${drag}px)` : "translateY(100%)" }}
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-[22px] border-t border-border bg-popover text-popover-foreground shadow-[0_-20px_60px_-20px_rgb(0_0_0/0.5)] outline-none",
          drag
            ? "transition-none"
            : "transition-transform duration-300 ease-[var(--ease-expo)] motion-reduce:transition-none",
        )}
      >
        {/* drag handle and title */}
        <div {...handlers} className="shrink-0 cursor-grab touch-none px-4 pt-2.5 pb-3 active:cursor-grabbing">
          <span className="mx-auto block h-1 w-10 rounded-full bg-border" aria-hidden />
          <div className="mt-3 flex items-center justify-between">
            <span className="flex items-end gap-2">
              <LumeSecLockup className="w-[112px]" />
              <span className="pb-px text-[12px] font-medium text-muted-foreground">Elements</span>
            </span>
            <button
              type="button"
              onClick={close}
              aria-label="Close menu"
              className="inline-flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors active:bg-accent"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(20px,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => {
              close();
              openSearch();
            }}
            className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-[14px] text-muted-foreground"
          >
            <SearchIcon size={15} />
            Search components and docs
          </button>

          <nav aria-label="Site" className="mt-3 grid grid-cols-3 gap-2">
            {primary.map((l) => {
              const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={close}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border p-3 transition-colors active:bg-muted",
                    active ? "border-input bg-muted/60" : "border-border bg-background",
                  )}
                >
                  <span className="flex items-center justify-between text-muted-foreground">
                    <l.Icon size={16} />
                    {l.meta && <span className="tabular font-mono text-[11px]">{l.meta}</span>}
                  </span>
                  <span className="text-[14px] font-medium">{l.label}</span>
                </Link>
              );
            })}
          </nav>

          <p className="mt-6 mb-1.5 font-mono text-[11px] text-muted-foreground">Collections</p>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
            {collections.map((c) => {
              const active = pathname.startsWith(`/components/${c.slug}`);
              return (
                <li key={c.slug}>
                  <Link
                    href={`/components/${c.slug}`}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 px-3.5 py-3 text-[15px] transition-colors active:bg-muted",
                      active && "bg-muted/60",
                    )}
                  >
                    <CollectionGlyph slug={c.slug} className="text-muted-foreground" />
                    <span className="flex-1">{c.title}</span>
                    <span className="tabular font-mono text-[12px] text-muted-foreground">{c.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 grid grid-cols-2 gap-2 text-[14px]">
            {[
              { href: "/docs/installation", label: "Installation" },
              { href: "/docs/theming", label: "Theming" },
              { href: "/docs/react", label: "React" },
              { href: "/docs/changelog", label: "Changelog" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={close}
                className="rounded-xl px-3.5 py-2.5 text-muted-foreground transition-colors active:bg-muted"
              >
                {l.label}
              </Link>
            ))}
          </div>

          <p className="mt-5 mb-1.5 font-mono text-[11px] text-muted-foreground">From LumeSec</p>
          <div className="grid grid-cols-2 gap-2">
            {PRODUCTS.map((p) => (
              <a
                key={p.id}
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-xl border border-border bg-background p-2.5 transition-colors active:bg-muted"
              >
                <ProductMark id={p.id} className="size-8" />
                <span className="min-w-0">
                  <span className="block text-[13px] leading-tight font-medium">{p.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{p.note}</span>
                </span>
              </a>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <a
              href={lumesecPages.contact.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-[14px] font-medium text-primary-foreground"
            >
              {lumesecPages.contact.label}
              <ArrowRightIcon size={14} />
            </a>
            <a
              href={site.company.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-background font-mono text-[13px]"
            >
              lumesec.ai
              <ArrowUpRightIcon size={13} />
            </a>
          </div>

          <div className="mt-6 grid gap-2 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <ThemeSegmented />
              <a
                href={site.repo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] text-muted-foreground transition-colors active:bg-muted"
              >
                <GitHubIcon size={15} />
                GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
