"use client";

import * as React from "react";

import { fuzzyMatch, FuzzyHighlight, type FuzzyMatch } from "@/lib/lumesec/fuzzy";
import { prefersReducedMotion, springEuler, type Spring } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One command in the palette. */
export interface PxCommandItem {
  /** What the command does; this text is searched. */
  label: string;
  /** Group heading the command is listed under while the query is empty. */
  group: string;
  /** Keyboard shortcut hint shown at the end of the row, such as `G P`. */
  shortcut?: string;
}

/** Props of `PxCommand`. Other `div` props go to the root. */
export interface PxCommandProps extends Omit<React.ComponentProps<"div">, "children" | "onChange"> {
  /** The commands, in display order. Consecutive commands with the same `group` share a heading. */
  items: readonly PxCommandItem[];
  /** Controlled open state. Use with `onOpenChange`. */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called when the palette opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Ctrl+K or ⌘K anywhere on the page opens and closes the palette. */
  hotkey?: boolean;
  /** Called when the user runs a command. The palette closes first. */
  onCommand?: (item: PxCommandItem) => void;
}

interface Result {
  item: PxCommandItem;
  match: FuzzyMatch;
}

/** Consecutive results under one heading; `group` is null while searching, when headings are hidden. */
interface Section {
  group: string | null;
  entries: { result: Result; index: number }[];
}

const KBD =
  "whitespace-nowrap rounded-[5px] border border-border px-1.5 py-px font-mono text-[11px] text-muted-foreground";

/**
 * ⌘K / Ctrl+K command palette with grouped commands, fuzzy search and a springing pixel highlight. A
 * trigger button opens it, a status line under the trigger reports the command that ran, and focus stays
 * in the search input while it is open and returns where it was when it closes.
 *
 * @example
 * <PxCommand
 *   hotkey
 *   items={[
 *     { group: "Actions", label: "New chat", shortcut: "N" },
 *     { group: "Go to", label: "Settings", shortcut: "G S" },
 *   ]}
 *   onCommand={(item) => console.log(item.label)}
 * />
 */
export function PxCommand({
  items,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  hotkey = false,
  onCommand,
  className,
  ...props
}: PxCommandProps) {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const [lastRun, setLastRun] = React.useState<string | null>(null);
  const shortcut = React.useSyncExternalStore(subscribeNever, platformShortcut, () => "Ctrl K");
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!hotkey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event) || event.defaultPrevented) return;
      event.preventDefault();
      // holding the keys must not flicker the palette open and closed
      if (!event.repeat) setOpen((current) => !current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hotkey, setOpen]);

  const run = (item: PxCommandItem) => {
    setOpen(false);
    setLastRun(item.label);
    onCommand?.(item);
  };

  const status = lastRun !== null ? `Ran “${lastRun}”` : hotkey ? "Press the shortcut anywhere on the page" : "";

  return (
    <div
      data-slot="px-command"
      data-state={open ? "open" : "closed"}
      className={cn("block text-foreground", className)}
      {...props}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={hotkey ? "Control+K Meta+K" : undefined}
        className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-[10px] border border-border bg-card pr-2.5 pl-[22px] text-left text-[13.5px] leading-normal text-muted-foreground outline-none select-none hover:border-[color-mix(in_srgb,var(--foreground)_25%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
        onClick={() => setOpen(true)}
      >
        <span className="flex-1">Search or jump to…</span>
        {hotkey && <kbd className={KBD}>{shortcut}</kbd>}
      </button>
      <span className="mt-2 block text-[12px] leading-normal text-muted-foreground">
        <RollText text={status} aria-live="polite" />
      </span>
      {open && <CommandDialog items={items} fallbackFocusRef={triggerRef} onClose={() => setOpen(false)} onRun={run} />}
    </div>
  );
}

interface CommandDialogProps {
  items: readonly PxCommandItem[];
  /** Receives focus on close when the element focused before opening is gone (or was the page itself). */
  fallbackFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onRun: (item: PxCommandItem) => void;
}

/** The open palette. It mounts on open, so every opening starts with an empty query. */
function CommandDialog({ items, fallbackFocusRef, onClose, onRun }: CommandDialogProps) {
  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const [query, setQuery] = React.useState("");
  const [highlighted, setActive] = React.useState(0);
  const results = React.useMemo(() => search(items, query), [items, query]);
  // the items can change while the palette is open
  const active = Math.min(highlighted, results.length - 1);
  const sections = groupResults(results, query);

  const backdropRef = React.useRef<HTMLDivElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const optionRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const highlight = React.useRef<Spring | null>(null);
  /** Whether the current press started on the backdrop, so a drag out of the dialog does not close it. */
  const pressOnBackdrop = React.useRef(false);

  const { ref: canvasRef, redraw } = usePixelCanvas((frame) => {
    const { palette, delta, width } = frame;
    const option = optionRefs.current[active];
    frame.clear();
    if (!option) return false;
    const target = option.offsetTop - 6;
    const height = option.offsetHeight;
    let state = highlight.current;
    if (!state || prefersReducedMotion()) {
      state = { position: target, velocity: 0 };
      highlight.current = state;
    } else {
      springEuler(state, target, delta, 380, 0.8);
    }
    const top = state.position;
    for (let y = top + 3; y < top + height - 2; y += 4) {
      for (let x = 6; x < width - 3; x += 4) frame.dot(x, y, palette.accent, 0.1, 2.2);
    }
    for (let y = top + 9; y < top + height - 8; y += 3) frame.dot(2, y, palette.accent, 1, 2.2);
    return Math.abs(target - state.position) > 0.3 || Math.abs(state.velocity) > 1;
  });

  // opening focuses the input and pops the dialog in; closing returns focus to where it was
  React.useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const returnTo = document.activeElement;
    const fallback = fallbackFocusRef.current;
    inputRef.current?.focus();
    if (!prefersReducedMotion()) {
      backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease" });
      dialog?.animate(
        [
          { opacity: 0, transform: "translateY(-8px) scale(.97)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 220,
          easing: "cubic-bezier(.2,.9,.3,1.1)",
        },
      );
    }
    return () => {
      // a command that moved focus somewhere else keeps it there
      const focused = document.activeElement;
      if (focused && focused !== document.body && !dialog?.contains(focused)) return;
      const target =
        returnTo instanceof HTMLElement && returnTo !== document.body && returnTo.isConnected ? returnTo : fallback;
      target?.focus();
    };
  }, [fallbackFocusRef]);

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const list = listRef.current;
    // the canvas covers the whole list, so the highlight scrolls with the options
    if (canvas && list) canvas.style.height = `${list.offsetHeight}px`;
    optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
    redraw();
  }, [results, active, canvasRef, redraw]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // keys that confirm an IME composition belong to the composition
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (results.length) setActive((active + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[active];
      if (result) onRun(result.item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      // focus stays in the input while the palette is open
      event.preventDefault();
    }
  };

  const renderOption = ({ result: { item, match }, index }: Section["entries"][number]) => (
    <div
      key={`${item.group}/${item.label}`}
      ref={(node) => {
        optionRefs.current[index] = node;
      }}
      id={optionId(index)}
      role="option"
      aria-selected={index === active}
      className="relative flex h-[38px] cursor-pointer items-center rounded-lg pr-2.5 pl-3.5 text-[14px] leading-normal"
      onPointerMove={() => {
        if (active !== index) setActive(index);
      }}
      onClick={() => onRun(item)}
    >
      <span>
        <FuzzyHighlight
          text={item.label}
          indices={match.indices}
          markClassName="bg-transparent font-semibold text-lumesec"
        />
      </span>
      {item.shortcut && <kbd className={cn(KBD, "ml-auto")}>{item.shortcut}</kbd>}
    </div>
  );

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[1000] grid items-start justify-items-center bg-[rgb(0_0_0/0.35)] px-4 pt-[max(12vh,24px)] pb-4"
      onPointerDown={(event) => {
        pressOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // closing on click rather than on press keeps the click from landing on the page underneath
        if (pressOnBackdrop.current && event.target === event.currentTarget) onClose();
        pressOnBackdrop.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        tabIndex={-1}
        // a press on a non-focusable part of the dialog lands here; hand focus back to the input so keys keep working
        onFocus={(event) => {
          if (event.target === event.currentTarget) inputRef.current?.focus();
        }}
        className="relative w-[min(560px,100%)] overflow-hidden rounded-[14px] border border-border bg-card text-foreground shadow-[0_30px_60px_-20px_rgba(0,0,0,.55)] outline-none"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5">
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="size-4 flex-none fill-none stroke-muted-foreground stroke-[1.7] [stroke-linecap:round]"
          >
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.5 10.5l3.5 3.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            aria-label="Command"
            placeholder="Type a command or search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            className="h-[52px] min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px font-[inherit] text-[15px] text-inherit outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className={KBD}>Esc</kbd>
        </div>
        <div className="relative max-h-[min(360px,60vh)] overflow-auto p-1.5">
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="pointer-events-none absolute top-1.5 left-1.5 block w-[calc(100%-12px)] [image-rendering:pixelated]"
          />
          <div ref={listRef} id={listId} role="listbox" aria-label="Commands">
            {sections.map((section, sectionIndex) => {
              if (section.group === null)
                return <React.Fragment key="matches">{section.entries.map(renderOption)}</React.Fragment>;
              const headingId = `${baseId}-group-${sectionIndex}`;
              return (
                <div key={`${sectionIndex}:${section.group}`} role="group" aria-labelledby={headingId}>
                  <div
                    id={headingId}
                    role="presentation"
                    className="px-2.5 pt-2.5 pb-1 font-mono text-[11px] leading-normal tracking-[.06em] text-muted-foreground uppercase"
                  >
                    {section.group}
                  </div>
                  {section.entries.map(renderOption)}
                </div>
              );
            })}
          </div>
          {results.length === 0 && (
            <div className="px-3 py-[18px] text-[13.5px] leading-normal text-muted-foreground">
              No commands match. Try another word.
            </div>
          )}
        </div>
        <div className="flex gap-3.5 border-t border-border px-3.5 py-2 text-[11.5px] leading-normal text-muted-foreground">
          <span>↑ ↓ to move</span>
          <span>↵ to run</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}

/** Matching commands; best match first while there is a query, list order otherwise. */
function search(items: readonly PxCommandItem[], query: string): Result[] {
  const results: Result[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, item.label);
    if (match) results.push({ item, match });
  }
  if (query) results.sort((a, b) => b.match.score - a.match.score);
  return results;
}

/** Runs of consecutive results with the same group while the query is empty; one flat run while searching. */
function groupResults(results: readonly Result[], query: string): Section[] {
  if (query)
    return results.length ? [{ group: null, entries: results.map((result, index) => ({ result, index })) }] : [];
  const sections: Section[] = [];
  results.forEach((result, index) => {
    const last = sections[sections.length - 1];
    if (last && last.group === result.item.group) last.entries.push({ result, index });
    else sections.push({ group: result.item.group, entries: [{ result, index }] });
  });
  return sections;
}

/** Ctrl+K or ⌘K, without Shift or Alt (Ctrl+Shift+K is a browser shortcut). */
function isPaletteShortcut(event: KeyboardEvent) {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k";
}

/** The platform never changes while the page is open. */
const subscribeNever = () => () => {};

/** `⌘ K` on Apple platforms, `Ctrl K` elsewhere. */
const platformShortcut = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K");
