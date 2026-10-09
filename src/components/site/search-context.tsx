"use client";

import dynamic from "next/dynamic";
import * as React from "react";

// loaded on first use: cmdk and the index stay out of the initial bundle
const CommandMenu = dynamic(() => import("@/components/site/command-menu").then((m) => m.CommandMenu), { ssr: false });

const SearchContext = React.createContext<{ open: () => void } | null>(null);

/** Whether a key event comes from a text field, where "/" is typed rather than a shortcut. */
function isTyping(event: KeyboardEvent) {
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** Holds the command menu and opens it with ⌘K, Ctrl+K or "/" anywhere on the site. */
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut =
        (event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !isTyping(event));
      if (!shortcut) return;
      event.preventDefault();
      setLoaded(true);
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = React.useMemo(
    () => ({
      open: () => {
        setLoaded(true);
        setOpen(true);
      },
    }),
    [],
  );

  return (
    <SearchContext.Provider value={value}>
      {children}
      {loaded && <CommandMenu open={open} onOpenChange={setOpen} />}
    </SearchContext.Provider>
  );
}

/** `open()` shows the command menu. */
export function useSearch() {
  const ctx = React.useContext(SearchContext);
  if (!ctx) throw new Error("useSearch outside SearchProvider");
  return ctx;
}

// the platform never changes, so there is nothing to subscribe to
const subscribeNever = () => () => {};

/** The label of the shortcut modifier: ⌘ on Apple devices, Ctrl elsewhere (⌘ on the server). */
export function useModifierKey() {
  const mac = React.useSyncExternalStore(
    subscribeNever,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => true,
  );
  return mac ? "⌘" : "Ctrl";
}
