"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const EVENT = "elements:tabs";

// choices made on this page, by group; they win over storage, which can be blocked
const chosen = new Map<string, string>();

function subscribeChoices(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** The shared choice of a group: made on this page, else remembered, else null. */
function readChoice(group: string) {
  const value = chosen.get(group);
  if (value !== undefined) return value;
  try {
    return localStorage.getItem(`tabs:${group}`);
  } catch {
    return null;
  }
}

/**
 * A choice shared by every tab group with the same `group` (e.g. the package manager): remembered in
 * localStorage and synced live between the groups on the page. Without a group it is plain state. The server
 * renders `initial`; the remembered choice applies once hydrated.
 */
export function useSyncedChoice(group: string | undefined, values: readonly string[], initial: string) {
  const [local, setLocal] = React.useState(initial);
  const shared = React.useSyncExternalStore(
    subscribeChoices,
    () => (group ? readChoice(group) : null),
    () => null,
  );
  const value = shared !== null && values.includes(shared) ? shared : local;

  const choose = React.useCallback(
    (next: string) => {
      setLocal(next);
      if (!group) return;
      chosen.set(group, next);
      try {
        localStorage.setItem(`tabs:${group}`, next);
      } catch {
        // storage can be blocked; the choice still applies to this page
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [group],
  );
  return [value, choose] as const;
}

const tabAt = (list: HTMLElement | null, index: number) => list?.querySelectorAll<HTMLElement>("[role=tab]")[index];

/** One tab: its label, its panel and optional controls shown in the tab bar while it is active. */
export type TabItem = { value: string; label: React.ReactNode; content: React.ReactNode; aside?: React.ReactNode };

/** Tabs with a sliding underline; panels are rendered on the server and only toggled here. */
export function CodeTabs({
  items,
  group,
  className,
  variant = "line",
  headerRight,
}: {
  items: TabItem[];
  /** Tab groups with the same name share and remember their choice. */
  group?: string;
  className?: string;
  variant?: "line" | "pill";
  headerRight?: React.ReactNode;
}) {
  const values = React.useMemo(() => items.map((i) => i.value), [items]);
  const [value, setValue] = useSyncedChoice(group, values, items[0]?.value ?? "");
  const listRef = React.useRef<HTMLDivElement>(null);
  const [bar, setBar] = React.useState({ x: 0, w: 0 });
  const id = React.useId();

  React.useLayoutEffect(() => {
    const tab = tabAt(listRef.current, values.indexOf(value));
    if (tab) setBar({ x: tab.offsetLeft, w: tab.offsetWidth });
  }, [value, values]);

  // arrow keys, Home and End move between tabs and activate them (roving tabindex)
  const onKeyDown = (event: React.KeyboardEvent) => {
    const current = values.indexOf(value);
    const count = values.length;
    const targets: Partial<Record<string, number>> = {
      ArrowRight: (current + 1) % count,
      ArrowLeft: (current - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setValue(values[next]);
    tabAt(listRef.current, next)?.focus();
  };

  const active = items.find((i) => i.value === value) ?? items[0];
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 border-b border-border">
        <div ref={listRef} role="tablist" className="relative flex items-center gap-1" onKeyDown={onKeyDown}>
          {items.map((it) => (
            <button
              key={it.value}
              type="button"
              role="tab"
              id={`${id}-${it.value}`}
              aria-selected={it.value === value}
              aria-controls={`${id}-panel`}
              tabIndex={it.value === value ? 0 : -1}
              onClick={() => setValue(it.value)}
              className={cn(
                "relative flex h-9 items-center gap-1.5 px-2 font-mono text-[12px] transition-colors",
                it.value === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                variant === "pill" && "h-8",
              )}
            >
              {it.label}
            </button>
          ))}
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-px left-0 h-px bg-foreground transition-[transform,width] duration-300 ease-[var(--ease-expo)]"
            style={{ transform: `translateX(${bar.x}px)`, width: bar.w }}
          />
        </div>
        <div className="flex items-center gap-1 pr-1">
          {active?.aside}
          {headerRight}
        </div>
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active?.value}`}>
        {active?.content}
      </div>
    </div>
  );
}
