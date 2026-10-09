"use client";

import { usePathname } from "next/navigation";
import * as React from "react";

import { SidebarNav } from "@/components/docs/sidebar";
import { SubNav } from "@/components/docs/sub-nav";
import { CloseIcon } from "@/components/icons";
import { trapTab } from "@/lib/focus-trap";
import type { Nav } from "@/lib/nav";

/** Sub-navigation, the sidebar column and its mobile drawer around the docs pages. */
export function DocsFrame({ nav, children }: { nav: Nav; children: React.ReactNode }) {
  // the path the drawer was opened on: navigating anywhere else closes it
  const pathname = usePathname();
  const [drawerPath, setDrawerPath] = React.useState<string | null>(null);
  const drawer = drawerPath === pathname;
  const close = React.useCallback(() => setDrawerPath(null), []);

  const cols = nav.collections.map((c) => ({ slug: c.slug, title: c.title, count: c.count }));

  return (
    <>
      <SubNav collections={cols} onMenu={() => setDrawerPath(pathname)} />
      <div className="sl-page">
        <div className="relative grid border-x border-border lg:grid-cols-[264px_minmax(0,1fr)]">
          <aside
            aria-label="Documentation"
            className="sticky top-[calc(var(--header-height)+var(--subnav-height))] hidden h-[calc(100dvh-var(--header-height)-var(--subnav-height))] border-r border-border lg:block"
          >
            <SidebarNav nav={nav} />
          </aside>
          {/* full-bleed hairlines inside the content stop at the sidebar and the page rail */}
          <div className="min-w-0 overflow-x-clip">{children}</div>
        </div>
      </div>
      {drawer && <Drawer nav={nav} onClose={close} />}
    </>
  );
}

/**
 * The navigation as a modal drawer on small screens: focus moves into it and returns afterwards, the page
 * behind does not scroll, and Escape or the backdrop closes it.
 */
function Drawer({ nav, onClose }: { nav: Nav; onClose: () => void }) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const onEscape = React.useEffectEvent(() => onClose());

  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button, a[href], input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
      if (panelRef.current) trapTab(event, panelRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Documentation navigation">
      <button type="button" aria-label="Close navigation" tabIndex={-1} className="absolute inset-0 bg-background/70 backdrop-blur-sm animate-[sl-fade_.2s_ease]" onClick={onClose} />
      <div ref={panelRef} className="absolute inset-y-0 left-0 flex w-[min(320px,86vw)] flex-col border-r border-border bg-background shadow-[var(--shadow-pop)] animate-[sl-fade-up_.3s_var(--ease-expo)]">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <span className="font-mono text-[12px] text-muted-foreground">Navigation</span>
          <button type="button" aria-label="Close navigation" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60">
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <SidebarNav nav={nav} onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}
