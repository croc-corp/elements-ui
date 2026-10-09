"use client";

import * as React from "react";

import { fuzzyMatch, FuzzyHighlight } from "@/lib/lumesec/fuzzy";
import { mixRgb } from "@/lib/lumesec/math";
import { prefersReducedMotion, springEuler } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Props of `PxSearch`. Other `div` props go to the root. */
export interface PxSearchProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue" | "onChange" | "onSelect"> {
  /** Entries to search. Defaults to a demo list of 14 settings pages. */
  items?: readonly string[];
  /** Controlled query. Use with `onValueChange`. */
  value?: string;
  /** Initial query when uncontrolled. */
  defaultValue?: string;
  /** Called with the query on every edit. */
  onValueChange?: (query: string) => void;
  /** Called after each search, 280 ms after the last keystroke, with the query and the total number of matches. */
  onSearch?: (query: string, count: number) => void;
  /** Called when a result is chosen with Enter or a click. */
  onSelect?: (item: string) => void;
  /** Pressing "/" anywhere on the page focuses the field, unless focus is already in a form field or editable text. */
  hotkey?: boolean;
  /** Accessible name of the field. */
  label?: string;
  /** Placeholder of the field. */
  placeholder?: string;
  /** Dims the component and disables the field. */
  disabled?: boolean;
}

/** Demo data: settings pages. */
const SEARCH_ITEMS = [
  "Create new project",
  "Invite teammates",
  "Billing and invoices",
  "API keys",
  "Usage dashboard",
  "Model settings",
  "Connectors",
  "Export conversation",
  "Keyboard shortcuts",
  "Data retention",
  "Audit log",
  "Team members",
  "Rate limits",
  "Webhooks",
];

interface SearchResult {
  text: string;
  indices: number[];
}

interface SearchState {
  matches: SearchResult[];
  /** Number of all matches (or of all items for an empty query). */
  total: number;
  /** Increments with every search, so the result rows remount and slide in again. */
  run: number;
}

/**
 * Search field with fuzzy matching, highlighted letters and a pixel highlight that springs between
 * results. A scanning line runs under the field while typing; the search itself runs 280 ms after the
 * last keystroke. `hotkey` makes "/" focus the field.
 *
 * @example
 * <PxSearch hotkey items={["Billing", "API keys", "Webhooks"]} onSelect={(item) => open(item)} />
 */
export function PxSearch({
  items = SEARCH_ITEMS,
  value: valueProp,
  defaultValue = "",
  onValueChange,
  onSearch,
  onSelect,
  hotkey = false,
  label = "Search settings",
  placeholder = "Search settings",
  disabled = false,
  className,
  ...props
}: PxSearchProps) {
  const baseId = React.useId();
  const listId = `${baseId}-results`;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const [query, setQuery] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const [results, setResults] = React.useState<SearchState>(() => ({ ...search(query, items), run: 0 }));
  const [active, setActive] = React.useState(0);
  const [status, setStatus] = React.useState(() => countStatus(query, results.total));

  const searching = React.useRef(false);
  /** The debounced search that typing scheduled, so Enter can run it at once. */
  const pendingSearch = React.useRef(0);
  const scanStart = React.useRef(0);
  const highlight = React.useRef({ position: 0, velocity: 0 });
  const highlightTarget = React.useRef<{ y: number; height: number } | null>(null);
  const placed = React.useRef(false);
  const snapNext = React.useRef(true);
  const lastQuery = React.useRef(query);

  const itemsRef = React.useRef(items);
  const onSearchRef = React.useRef(onSearch);
  React.useEffect(() => {
    itemsRef.current = items;
    onSearchRef.current = onSearch;
  });

  const { ref: canvasRef, redraw } = usePixelCanvas(({ clear, dot, palette, time, delta, width }) => {
    const reduced = prefersReducedMotion();
    clear();
    const field = fieldRef.current;
    if (field && searching.current && !reduced) {
      // a short bright segment sweeps along the bottom of the field
      const fieldBottom = field.offsetTop + field.offsetHeight - 3;
      const u = ((time - scanStart.current) * 1.4) % 1;
      const segment = 0.22;
      for (let x = 12; x < width - 12; x += 3) {
        const distance = (x / width - u + 1) % 1;
        const k = distance < segment ? 1 - distance / segment : 0;
        if (k > 0) dot(x, fieldBottom, mixRgb(palette.accent, palette.shine, k * 0.6), k, 2);
      }
    }
    const target = highlightTarget.current;
    if (target) {
      if (reduced) highlight.current.position = target.y;
      else springEuler(highlight.current, target.y, delta, 320, 0.8);
      const top = highlight.current.position;
      const rowHeight = target.height || 36;
      for (let y = top + 6; y < top + rowHeight - 6; y += 3) dot(3, y, palette.accent, 1, 2.4);
      for (let y = top + 3; y < top + rowHeight - 2; y += 4) {
        for (let x = 10; x < width - 4; x += 4) dot(x, y, palette.accent, 0.08, 2);
      }
    }
    return (
      searching.current ||
      (target !== null && (Math.abs(target.y - highlight.current.position) > 0.3 || Math.abs(highlight.current.velocity) > 1))
    );
  });

  /** Search the items for `text`, show the results, report the count and return the matches. */
  const run = React.useCallback(
    (text: string) => {
      const next = search(text, itemsRef.current);
      setResults((previous) => ({ ...next, run: previous.run + 1 }));
      setActive(0);
      setStatus(countStatus(text, next.total));
      snapNext.current = true;
      onSearchRef.current?.(text, next.total);
      redraw();
      return next.matches;
    },
    [redraw],
  );

  // typing shows the scanning line and searches once the user pauses
  React.useEffect(() => {
    if (lastQuery.current === query) return;
    lastQuery.current = query;
    searching.current = true;
    scanStart.current = performance.now() / 1000;
    redraw();
    const id = window.setTimeout(
      () => {
        searching.current = false;
        run(query);
      },
      prefersReducedMotion() ? 0 : 280,
    );
    pendingSearch.current = id;
    return () => window.clearTimeout(id);
  }, [query, run, redraw]);

  // items that arrive or change later are searched with the current query (compared by content, not identity)
  const itemsKey = items.join("\u0000");
  const searchedItems = React.useRef(itemsKey);
  React.useEffect(() => {
    if (searchedItems.current === itemsKey) return;
    searchedItems.current = itemsKey;
    if (!searching.current) run(lastQuery.current);
  }, [itemsKey, run]);

  // move the highlight to the active row; new results place it without springing
  React.useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) {
      highlightTarget.current = null;
      return;
    }
    highlightTarget.current = { y: list.offsetTop + row.offsetTop, height: row.offsetHeight };
    if (snapNext.current || !placed.current) {
      highlight.current.position = highlightTarget.current.y;
      placed.current = true;
    }
    snapNext.current = false;
    redraw();
  }, [results, active, redraw]);

  // new results slide in one after another
  React.useLayoutEffect(() => {
    if (results.run === 0 || prefersReducedMotion()) return;
    listRef.current?.querySelectorAll("li").forEach((row, i) => {
      if (typeof row.animate !== "function") return;
      row.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], {
        duration: 280,
        easing: "cubic-bezier(.2,.8,.2,1)",
        delay: i * 30,
        fill: "backwards",
      });
    });
  }, [results.run]);

  React.useEffect(() => {
    if (!hotkey || disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.composedPath()[0])) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hotkey, disabled]);

  const pick = (index: number, matches = results.matches) => {
    const match = matches[index];
    if (!match) return;
    setStatus(`Opened · ${match.text}`);
    onSelect?.(match.text);
  };

  const optionId = (index: number) => `${baseId}-option-${index}`;

  return (
    <div
      data-slot="px-search"
      data-disabled={disabled ? "" : undefined}
      className={cn("relative block leading-[1.5] text-foreground", disabled && "pointer-events-none opacity-55", className)}
      {...props}
    >
      <div
        ref={fieldRef}
        className="relative flex h-[42px] items-center gap-2 rounded-[10px] border border-border bg-card px-3 transition-[border-color,box-shadow] duration-200 ease-[ease] focus-within:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] focus-within:ring-[3px] focus-within:ring-lumesec/14"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-4 flex-none text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
        >
          <circle cx="7" cy="7" r="4.6" />
          <path d="M10.5 10.5l3.5 3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.matches.length ? optionId(active) : undefined}
          aria-label={label}
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // keys that confirm an IME composition belong to the composition
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const count = results.matches.length;
              if (count) setActive((active + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (searching.current) {
                // a search is still pending: run it now, or Enter would pick from the previous query's results
                window.clearTimeout(pendingSearch.current);
                searching.current = false;
                pick(0, run(query));
              } else pick(active);
            } else if (event.key === "Escape" && query) {
              lastQuery.current = "";
              searching.current = false;
              setQuery("");
              run("");
            }
          }}
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-[inherit] text-[14px] text-inherit outline-none placeholder:text-muted-foreground placeholder:opacity-75"
        />
        {hotkey && (
          <kbd aria-hidden="true" className="rounded-[5px] border border-border px-1.5 py-px font-mono text-[11px] text-muted-foreground">
            /
          </kbd>
        )}
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="relative mt-2 mb-0 list-none p-0">
        {results.matches.length ? (
          results.matches.map((match, index) => (
            <li
              key={`${results.run}:${match.text}`}
              id={optionId(index)}
              data-index={index}
              role="option"
              aria-selected={index === active}
              onPointerEnter={() => setActive(index)}
              onClick={() => pick(index)}
              className="group relative flex h-9 cursor-pointer items-center rounded-lg px-3 text-[13.5px]"
            >
              <span className="min-w-0 truncate">
                <FuzzyHighlight text={match.text} indices={match.indices} markClassName="bg-transparent font-semibold text-lumesec" />
              </span>
              <span
                aria-hidden="true"
                className="ml-auto flex-none pl-2 font-mono text-[11px] text-muted-foreground opacity-0 group-aria-selected:opacity-100"
              >
                Enter ↵
              </span>
            </li>
          ))
        ) : (
          <li
            key={`${results.run}:none`}
            role="option"
            aria-selected="false"
            aria-disabled="true"
            className="relative flex h-9 cursor-default items-center rounded-lg px-3 py-2.5 text-[13px] text-muted-foreground"
          >
            No matches. Try fewer letters.
          </li>
        )}
      </ul>
      <span className="mt-1.5 block text-[12px] text-muted-foreground">
        <RollText text={status} aria-live="polite" />
      </span>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] block size-full [image-rendering:pixelated]"
      />
    </div>
  );
}

/** Rank the items for a query: up to six matches, or the first five items as suggestions when empty. */
function search(query: string, items: readonly string[]) {
  const ranked = items
    .map((text) => ({ text, match: fuzzyMatch(query, text) }))
    .flatMap(({ text, match }) => (match ? [{ text, score: match.score, indices: match.indices }] : []))
    .sort((a, b) => b.score - a.score);
  const shown = (query ? ranked : ranked.slice(0, 5)).slice(0, 6);
  return {
    matches: shown.map(({ text, indices }) => ({ text, indices })),
    total: query ? ranked.length : items.length,
  };
}

/** The status line: the number of matches, or of all entries while the query is empty. */
function countStatus(query: string, total: number) {
  return query ? `${total} result${total === 1 ? "" : "s"}` : `Suggested · ${total} ${total === 1 ? "entry" : "entries"}`;
}

/** Whether a key press comes from a form field or editable text, where "/" keeps its own meaning. */
function isEditable(target: EventTarget | undefined) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}
