"use client";

import * as React from "react";

import { clamp, mixRgb, rgba } from "@/lib/lumesec/math";
import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One section of the accordion. */
export interface PxAccordionItem {
  /** Identifies the item in `value`. Defaults to `title`. */
  value?: string;
  /** Header text. */
  title: string;
  /** Muted text at the end of the header. */
  summary?: string;
  /** Panel content. */
  content: React.ReactNode;
}

/** Props of `PxAccordion`. Other `div` props go to the root element. */
export interface PxAccordionProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue" | "onChange"> {
  /** The sections, top to bottom. */
  items: readonly PxAccordionItem[];
  /** Lets several items stay open; otherwise opening one closes the others. */
  multiple?: boolean;
  /** Controlled list of open items (their `value`, or `title`). Use with `onValueChange`. */
  value?: string[];
  /** Items open initially when uncontrolled. */
  defaultValue?: string[];
  /** Called with the open items whenever the user opens or closes one. */
  onValueChange?: (value: string[]) => void;
}

const NO_ITEMS: string[] = [];

/**
 * Accordion whose pixel plus signs fold into minus signs while the panels open smoothly.
 *
 * @example
 * <PxAccordion
 *   defaultValue={["What is Ultracode?"]}
 *   items={[
 *     { title: "What is Ultracode?", content: "A mode that sends xhigh effort." },
 *     { title: "How is usage counted?", content: "Usage resets weekly." },
 *   ]}
 * />
 */
export function PxAccordion({
  items,
  multiple = false,
  value: valueProp,
  defaultValue = NO_ITEMS,
  onValueChange,
  className,
  ...props
}: PxAccordionProps) {
  const baseId = React.useId();
  const [open, setOpen] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const headerRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const toggle = (itemValue: string) => {
    setOpen((current) => {
      if (current.includes(itemValue)) return current.filter((entry) => entry !== itemValue);
      return multiple ? [...current, itemValue] : [itemValue];
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = headerTarget(event.key, index, items.length);
    if (target === null) return;
    event.preventDefault();
    headerRefs.current[target]?.focus();
  };

  return (
    <div data-slot="px-accordion" className={cn("block text-foreground", className)} {...props}>
      {items.map((item, index) => {
        const itemValue = item.value ?? item.title;
        const isOpen = open.includes(itemValue);
        const headerId = `${baseId}-header-${index}`;
        const panelId = `${baseId}-panel-${index}`;
        return (
          <div key={itemValue} data-state={isOpen ? "open" : "closed"} className="group border-b border-border first:border-t">
            <h3 className="m-0">
              <button
                ref={(node) => {
                  headerRefs.current[index] = node;
                }}
                id={headerId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                className="flex w-full cursor-pointer select-none items-center gap-3 border-0 bg-transparent px-1 py-3.5 text-left text-[14px] leading-normal font-semibold outline-none hover:text-lumesec focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec"
                onClick={() => toggle(itemValue)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <PlusMinus open={isOpen} />
                <span>{item.title}</span>
                {item.summary && <span className="ml-auto text-[12px] font-normal text-muted-foreground">{item.summary}</span>}
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={headerId}
              inert={!isOpen}
              className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-[350ms] ease-[cubic-bezier(.2,.8,.2,1)] group-data-[state=open]:grid-rows-[1fr] motion-reduce:transition-none"
            >
              <div className="overflow-hidden">
                <div className="relative mb-4 ml-1.5 -translate-y-1 pl-5 text-[13.5px] leading-[1.6] text-[color-mix(in_srgb,var(--foreground)_82%,var(--muted-foreground))] opacity-0 transition-[opacity,translate] duration-300 ease-[ease] group-data-[state=open]:translate-y-0 group-data-[state=open]:opacity-100 group-data-[state=open]:delay-[80ms] motion-reduce:transition-none before:absolute before:top-1 before:bottom-1 before:left-0 before:w-0.5 before:bg-[image:radial-gradient(var(--lumesec)_1px,transparent_1.4px)] before:bg-[length:3px_4px] before:bg-repeat-y before:content-['']">
                  {item.content}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The header a key moves focus to: arrows step and wrap, Home and End jump to the ends. `null` for other keys. */
function headerTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The 14px plus sign whose vertical bar folds away as the item opens, shifting from foreground to accent. */
function PlusMinus({ open }: { open: boolean }) {
  // an item that starts open shows the minus sign at once; only later changes animate
  const progress = React.useRef(open ? 1 : 0);
  const { ref, redraw } = usePixelCanvas(({ context, palette, delta, clear }) => {
    const target = open ? 1 : 0;
    progress.current = prefersReducedMotion() ? target : progress.current + clamp(target - progress.current, -delta * 5, delta * 5);
    const v = progress.current;
    clear();
    context.fillStyle = rgba(mixRgb(palette.foreground, palette.accent, v));
    for (let k = -2; k <= 2; k++) context.fillRect(5.5 + k * 2.6, 5.5, 2.4, 2.4);
    const s = 1 - v;
    for (let k = -2; k <= 2; k++) if (k) context.fillRect(5.5, 5.5 + k * 2.6 * s, 2.4, 2.4);
    return Math.abs(target - progress.current) > 0.001;
  });
  React.useEffect(redraw, [open, redraw]);
  return <canvas ref={ref} aria-hidden="true" className="size-3.5 flex-none" />;
}
