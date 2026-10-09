"use client";

import * as React from "react";

import { lerp, mixRgb } from "@/lib/lumesec/math";
import { prefersReducedMotion, springEuler } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One tab and its panel. */
export interface PxTabsItem {
  /** Identifies the tab in `value`. Defaults to `label`. */
  value?: string;
  /** Tab label. */
  label: string;
  /** Small count badge after the label. */
  count?: string | number;
  /** Panel content. */
  content: React.ReactNode;
}

/** Props of `PxTabs`. Other `div` props go to the root. */
export interface PxTabsProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue" | "onChange"> {
  /** The tabs, in order. */
  items: readonly PxTabsItem[];
  /** Controlled selected tab. Use with `onValueChange`. */
  value?: string;
  /** Initially selected tab when uncontrolled. Defaults to the first tab. */
  defaultValue?: string;
  /** Called when the user selects another tab. */
  onValueChange?: (value: string) => void;
}

/** Number of dots in the underline. */
const DOTS = 40;

interface UnderlineDot {
  position: number;
  velocity: number;
  /** Time in seconds when this dot starts moving, so the line streams across. */
  start: number;
}

/**
 * Tabs whose underline is forty pixels that stream from the old tab to the new one; the new panel slides
 * in from the side it was selected from.
 *
 * @example
 * <PxTabs
 *   items={[
 *     { label: "Overview", content: "Usage is steady this week." },
 *     { label: "Activity", count: 12, content: "12 events since Monday." },
 *   ]}
 * />
 */
export function PxTabs({ items, value: valueProp, defaultValue, onValueChange, className, ...props }: PxTabsProps) {
  const baseId = React.useId();
  const values = items.map((item) => item.value ?? item.label);
  const [value, setValue] = useControllableState({
    value: valueProp,
    defaultValue: defaultValue ?? values[0] ?? "",
    onChange: onValueChange,
  });
  const index = Math.max(0, values.indexOf(value));

  const tablistRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const panelRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const dots = React.useRef<UnderlineDot[]>([]);
  const laidOutWidth = React.useRef(0);
  const indexRef = React.useRef(index);
  const shownIndex = React.useRef(index);

  /** Left and right end of the underline under tab `i`, inset 8px, in canvas coordinates. */
  const span = React.useCallback((i: number): [number, number] => {
    const tablist = tablistRef.current;
    const tab = tabRefs.current[i];
    if (!tablist || !tab) return [0, 0];
    const left = tab.offsetLeft - tablist.offsetLeft - tablist.scrollLeft;
    return [left + 8, left + tab.offsetWidth - 8];
  }, []);

  const { ref: canvasRef, redraw } = usePixelCanvas((frame) => {
    const { palette, time, delta } = frame;
    frame.clear();
    // no tabs: no underline
    if (!tabRefs.current[indexRef.current]) return false;
    const [a, b] = span(indexRef.current);
    if (frame.width !== laidOutWidth.current) {
      // a new size snaps the line under the current tab
      laidOutWidth.current = frame.width;
      dots.current = Array.from({ length: DOTS }, (_, k) => ({ position: lerp(a, b, k / (DOTS - 1)), velocity: 0, start: 0 }));
    }
    const reduced = prefersReducedMotion();
    let moving = false;
    dots.current.forEach((dot, k) => {
      const target = lerp(a, b, k / (DOTS - 1));
      if (reduced) dot.position = target;
      else if (time >= dot.start) springEuler(dot, target, delta, 240, 0.7);
      const speed = Math.min(1, Math.abs(dot.velocity) / 500);
      if (Math.abs(target - dot.position) > 0.3) moving = true;
      const color = mixRgb(palette.accent, palette.shine, speed);
      frame.dot(dot.position - 1.2, 1, color, 1, 2.4);
      frame.dot(dot.position - 1.2, 4.2, color, 0.6 + speed * 0.4, 2.4);
    });
    return moving;
  });

  React.useLayoutEffect(() => {
    indexRef.current = index;
    const previous = shownIndex.current;
    shownIndex.current = index;
    if (previous === index) return;
    const panel = panelRefs.current[index];
    if (panel && !prefersReducedMotion() && typeof panel.animate === "function") {
      panel.animate([{ opacity: 0, transform: `translateX(${index > previous ? 10 : -10}px)` }, { opacity: 1, transform: "none" }], {
        duration: 260,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    }
    // the dots leave one after another, starting with the ones nearest the new tab
    const now = performance.now() / 1000;
    const forward = index > previous;
    dots.current.forEach((dot, k) => {
      dot.start = now + ((forward ? DOTS - 1 - k : k) / (DOTS - 1)) * 0.14;
    });
    redraw();
  }, [index, redraw]);

  React.useEffect(redraw, [items, redraw]);

  const select = (i: number) => {
    const next = values[i];
    if (next !== undefined) setValue(next);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const n = items.length;
    const keys: Record<string, number> = { ArrowRight: (index + 1) % n, ArrowLeft: (index - 1 + n) % n, Home: 0, End: n - 1 };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div data-slot="px-tabs" className={cn("block text-foreground", className)} {...props}>
      <div
        ref={tablistRef}
        role="tablist"
        // the underline follows the tabs when a narrow tab row scrolls sideways
        onScroll={redraw}
        className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <button
            key={values[i]}
            ref={(node) => {
              tabRefs.current[i] = node;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${i}`}
            aria-selected={i === index}
            aria-controls={`${baseId}-panel-${i}`}
            tabIndex={i === index ? 0 : -1}
            className="cursor-pointer select-none whitespace-nowrap rounded-t-lg border-0 bg-transparent px-3 py-2 text-[14px] leading-normal font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec aria-selected:text-foreground"
            onClick={() => select(i)}
            onKeyDown={onKeyDown}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="ml-1.5 rounded-[5px] bg-foreground/8 px-[5px] py-px font-mono text-[11px]">{item.count}</span>
            )}
          </button>
        ))}
      </div>
      <canvas ref={canvasRef} aria-hidden="true" className="block h-2 w-full [image-rendering:pixelated]" />
      <div className="-mt-[3px] h-px bg-border" />
      <div className="pt-3.5">
        {items.map((item, i) => (
          <div
            key={values[i]}
            ref={(node) => {
              panelRefs.current[i] = node;
            }}
            role="tabpanel"
            id={`${baseId}-panel-${i}`}
            aria-labelledby={`${baseId}-tab-${i}`}
            tabIndex={0}
            hidden={i !== index}
          >
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}
