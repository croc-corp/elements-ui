"use client";

import { usePathname } from "next/navigation";
import * as React from "react";

import { track } from "@/lib/track";

/** One anonymous page_view per route change. */
export function PageViews() {
  const pathname = usePathname();
  const last = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;
    const id = window.setTimeout(() => track("page_view"), 300);
    return () => window.clearTimeout(id);
  }, [pathname]);
  return null;
}
