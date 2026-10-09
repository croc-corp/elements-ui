"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { ArrowRightIcon, ArrowUpRightIcon, ChevronDownIcon } from "@/components/icons";
import { ElementsLogo } from "@/components/site/logo";
import { LumeSecLockup } from "@/components/site/lumesec-logo";
import { ProductMark } from "@/components/site/product-mark";
import { lumesecPages, type ProductId, site } from "@/config/site";
import { cn } from "@/lib/utils";

type Tile = { id: ProductId; name: string; note: string; href: string; badge?: string };

const PRODUCTS: Tile[] = [
  { id: "elements", name: "Elements", note: "Interactive components for shadcn.", href: "/", badge: "This site" },
  { id: "aiop", name: "AI Operating Platform", note: "Predictable AI. Built for Enterprise.", href: "https://lumesec.ai/solutions/platform" },
  { id: "securegrid", name: "SecureGrid", note: "Ask anything. Leak nothing.", href: "https://securegrid.dev/en" },
];

const SOLUTIONS = lumesecPages.solutions.slice(0, 5);
const COMPANY = [lumesecPages.company[0], lumesecPages.company[2], lumesecPages.company[5], lumesecPages.resources[2], lumesecPages.resources[5], lumesecPages.resources[1]];

const isExternal = (href: string) => /^https?:/.test(href);

function MenuLink({ href, className, children, onNavigate }: { href: string; className?: string; children: React.ReactNode; onNavigate: () => void }) {
  if (isExternal(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={onNavigate}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onNavigate}>
      {children}
    </Link>
  );
}

/**
 * The logo opens the LumeSec menu: the products with their marks, the main pages of lumesec.ai and the
 * brand resources. Disclosure pattern: Escape or a click outside closes it and focus returns to the logo.
 */
export function BrandMenu({ onCompactOpen }: { onCompactOpen?: () => void }) {
  // the path the menu was opened on: navigating anywhere else closes it
  const pathname = usePathname();
  const [openPath, setOpenPath] = React.useState<string | null>(null);
  const open = openPath === pathname;
  // small screens pin the panel under the header, measured when it opens
  const [top, setTop] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();

  const close = React.useCallback((refocus = false) => {
    setOpenPath(null);
    if (refocus) buttonRef.current?.focus();
  }, []);

  /** Small screens use the bottom sheet for the whole menu. */
  const compact = () => Boolean(onCompactOpen) && window.matchMedia("(max-width: 1023px)").matches;
  const openPanel = () => {
    setTop((buttonRef.current?.getBoundingClientRect().bottom ?? 0) + 10);
    setOpenPath(pathname);
  };

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div
      ref={rootRef}
      className="relative w-fit"
      onBlur={(event) => {
        // tabbing out of the menu closes it
        if (open && event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) close();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${site.name} menu`}
        onClick={() => {
          if (compact()) onCompactOpen?.();
          else if (open) close();
          else openPanel();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" || open || compact()) return;
          event.preventDefault();
          openPanel();
          requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("a, button")?.focus());
        }}
        className="group/brand -ml-1.5 flex items-center gap-2 rounded-lg py-1 pr-1.5 pl-1.5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted/60"
      >
        <ElementsLogo />
        <ChevronDownIcon size={13} className={cn("text-muted-foreground transition-transform duration-300 ease-[var(--ease-expo)]", open && "rotate-180")} />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          style={{ "--menu-top": `${top}px` } as React.CSSProperties}
          className="fixed inset-x-2 top-[var(--menu-top)] z-50 max-h-[calc(100dvh-var(--menu-top)-12px)] overflow-y-auto rounded-2xl border border-border bg-popover text-popover-foreground shadow-[var(--shadow-pop)] animate-[sl-fade-up_.28s_var(--ease-expo)] motion-reduce:animate-none sm:absolute sm:inset-x-auto sm:top-[calc(100%+10px)] sm:left-0 sm:max-h-[calc(100dvh-var(--header-height)-24px)] sm:w-[min(820px,calc(100vw-48px))]"
        >
          <nav aria-label="LumeSec" className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {/* products */}
            <div className="relative overflow-hidden border-b border-border p-4 sm:p-5 md:border-r md:border-b-0">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-0 [background:radial-gradient(28rem_circle_at_0%_0%,color-mix(in_oklab,var(--lumesec)_9%,transparent),transparent_60%)]"
              />
              <span aria-hidden className="sl-dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
              <p className="relative font-mono text-[11px] text-muted-foreground">Products</p>
              <ul className="relative mt-3 grid gap-2 sm:grid-cols-2">
                {PRODUCTS.map((p) => (
                  <li key={p.id} className={p.id === "elements" ? "sm:col-span-2" : undefined}>
                    <MenuLink
                      href={p.href}
                      onNavigate={() => close()}
                      className="group/tile flex h-full items-start gap-3 rounded-xl border border-transparent bg-background/60 p-3 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px hover:border-border hover:bg-background focus-visible:border-input focus-visible:outline-none"
                    >
                      <ProductMark id={p.id} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[13.5px] font-medium tracking-tight">
                          {p.name}
                          {p.badge && <span className="rounded-[4px] border border-border px-1 font-mono text-[9.5px] leading-[15px] font-normal whitespace-nowrap text-muted-foreground">{p.badge}</span>}
                          {isExternal(p.href) && <ArrowUpRightIcon size={12} className="text-muted-foreground opacity-0 transition-opacity group-hover/tile:opacity-100" />}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{p.note}</span>
                      </span>
                    </MenuLink>
                  </li>
                ))}
              </ul>
              <a
                href={site.company.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => close()}
                className="group/home relative mt-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3.5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--lumesec)_45%,var(--border))] hover:shadow-[0_10px_40px_-15px_color-mix(in_oklab,var(--lumesec)_25%,transparent)]"
              >
                <span className="min-w-0">
                  <LumeSecLockup className="w-[118px]" />
                  <span className="mt-2 block text-[12.5px] text-muted-foreground">{site.company.tagline}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-mono text-[12px]">
                  lumesec.ai
                  <ArrowUpRightIcon size={13} className="transition-transform duration-300 ease-[var(--ease-expo)] group-hover/home:translate-x-0.5 group-hover/home:-translate-y-0.5" />
                </span>
              </a>
            </div>

            {/* lumesec.ai pages */}
            <div className="p-4 sm:p-5">
              <p className="font-mono text-[11px] text-muted-foreground">LumeSec Technologies</p>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-5">
                <div>
                  <p className="text-[12px] font-medium">Solutions</p>
                  <ul className="mt-2 grid gap-0.5">
                    {SOLUTIONS.map((l) => (
                      <li key={l.href}>
                        <MenuLink href={l.href} onNavigate={() => close()} className="-mx-2 block rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                          {l.label}
                        </MenuLink>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[12px] font-medium">Company</p>
                  <ul className="mt-2 grid gap-0.5">
                    {COMPANY.map((l) => (
                      <li key={l.href}>
                        <MenuLink href={l.href} onNavigate={() => close()} className="-mx-2 block rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                          {l.label}
                        </MenuLink>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <MenuLink
                  href={lumesecPages.contact.href}
                  onNavigate={() => close()}
                  className="group/cta inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  {lumesecPages.contact.label}
                  <ArrowRightIcon size={13} className="transition-transform duration-300 group-hover/cta:translate-x-0.5" />
                </MenuLink>
                <MenuLink href={lumesecPages.brand.href} onNavigate={() => close()} className="inline-flex h-8 items-center rounded-lg px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {lumesecPages.brand.label}
                </MenuLink>
              </div>
            </div>
          </nav>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface/60 px-4 py-2.5 sm:px-5">
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
              {[
                { href: "/", label: "Elements home" },
                { href: "/components", label: "Components" },
                { href: "/docs", label: "Docs" },
              ].map((l) => (
                <Link key={l.href} href={l.href} onClick={() => close()} className="text-muted-foreground transition-colors hover:text-foreground">
                  {l.label}
                </Link>
              ))}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">© {new Date().getFullYear()} {site.company.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}
