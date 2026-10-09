"use client";

import * as React from "react";

import { prefersReducedMotion, springEuler } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { SMALL_CHECK } from "@/lib/lumesec/pixel-font";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One choice of the menu. */
export interface PxSelectOption {
  /** Submitted value. Defaults to `label`. */
  value?: string;
  /** Text shown in the trigger and the menu. */
  label: string;
  /** Second line in the menu. */
  description?: string;
}

/** Props of `PxSelect`. Other `div` props go to the root. */
export interface PxSelectProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue" | "onChange"> {
  /** The choices, in order. */
  options: readonly PxSelectOption[];
  /** Controlled selected value. Use with `onValueChange`. */
  value?: string;
  /** Initially selected value when uncontrolled; also restored on form reset. Defaults to the first option. */
  defaultValue?: string;
  /** Called when the user picks a different option. */
  onValueChange?: (value: string) => void;
  /** Controlled open state of the menu. Use with `onOpenChange`. */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called when the menu opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Label above the trigger; also names the listbox. */
  label?: React.ReactNode;
  /** Help text under the trigger; also describes it. */
  hint?: React.ReactNode;
  /** Form field name. */
  name?: string;
  /** Dims the select, disables the trigger and keeps the menu closed. */
  disabled?: boolean;
}

/** Keyframes of the menu unfolding downward. */
const UNFOLD: Keyframe[] = [
  { clipPath: "inset(0 0 100% 0 round 12px)", opacity: 0.4 },
  { clipPath: "inset(0 0 0 0 round 12px)", opacity: 1 },
];

/**
 * Select with a menu that unfolds downward, a pixel highlight that springs between options, a pixel
 * check on the selected one and type-ahead by first letter. The selected label rolls when it changes.
 *
 * @example
 * <PxSelect
 *   name="model"
 *   label="Model"
 *   defaultValue="medium"
 *   options={[
 *     { value: "large", label: "Large", description: "Most capable" },
 *     { value: "medium", label: "Medium", description: "Balanced" },
 *   ]}
 * />
 */
export function PxSelect({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  label,
  hint,
  name,
  disabled = false,
  className,
  ...props
}: PxSelectProps) {
  const baseId = React.useId();
  const labelId = `${baseId}-label`;
  const valueId = `${baseId}-value`;
  const hintId = `${baseId}-hint`;
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const values = options.map((option) => option.value ?? option.label);
  const initialValue = defaultValue ?? values[0] ?? "";

  const anchorRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const itemRefs = React.useRef<(HTMLLIElement | null)[]>([]);
  const [value, setValue] = useControllableState({
    value: valueProp,
    defaultValue: initialValue,
    onChange: onValueChange,
  });
  const [openState, setOpen] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  // a disabled or empty select never shows its menu, even when `open` asks for it
  const open = openState && !disabled && options.length > 0;
  const selectedIndex = Math.max(0, values.indexOf(value));
  const [highlightedIndex, setActiveIndex] = React.useState(selectedIndex);
  // options can shrink while the menu is open
  const activeIndex = Math.min(highlightedIndex, options.length - 1);

  // opening highlights the selected option
  const [shownOpen, setShownOpen] = React.useState(open);
  if (shownOpen !== open) {
    setShownOpen(open);
    if (open) setActiveIndex(selectedIndex);
  }

  // the label rolls only when the user picks; resets and controlled changes swap it in place
  const [roll, setRoll] = React.useState({ index: selectedIndex, direction: 1, animate: false });

  const highlight = React.useRef({ position: 0, velocity: 0 });
  const snap = React.useRef(true);

  const { ref: canvasRef, redraw } = usePixelCanvas(({ clear, dot, palette, delta, width }) => {
    if (!open) return false;
    const list = listRef.current;
    const item = itemRefs.current[activeIndex];
    if (!list || !item) return false;
    const targetY = item.offsetTop - list.scrollTop;
    const height = item.offsetHeight;
    if (snap.current || prefersReducedMotion()) {
      highlight.current.position = targetY;
      highlight.current.velocity = 0;
      snap.current = false;
    } else {
      springEuler(highlight.current, targetY, delta, 360, 0.82);
    }
    const top = highlight.current.position;
    clear();
    for (let y = top + 3; y < top + height - 2; y += 4) {
      for (let x = 3; x < width - 3; x += 4) dot(x, y, palette.accent, 0.1, 2.2);
    }
    for (let y = top + 8; y < top + height - 8; y += 3) dot(0, y, palette.accent, 1, 2.2);
    const selected = itemRefs.current[selectedIndex];
    if (selected) {
      const centerY = selected.offsetTop - list.scrollTop + selected.offsetHeight / 2;
      for (const [x, y] of SMALL_CHECK) dot(width - 24 + x * 2, centerY - 5 + y * 2, palette.accent, 1, 2);
    }
    return Math.abs(targetY - highlight.current.position) > 0.3 || Math.abs(highlight.current.velocity) > 1;
  });

  const close = (focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  // on open: unfold, focus the list, and close on a press outside the trigger and the menu
  React.useLayoutEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    if (pop && !prefersReducedMotion() && typeof pop.animate === "function") {
      pop.animate(UNFOLD, { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    snap.current = true;
    listRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      const anchor = anchorRef.current;
      if (anchor && !event.composedPath().includes(anchor)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  React.useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    redraw();
  }, [open, activeIndex, selectedIndex, redraw]);

  useFormReset(triggerRef, () => setValue(initialValue));

  const choose = (index: number) => {
    setRoll({ index, direction: index >= selectedIndex ? 1 : -1, animate: true });
    setValue(values[index]);
    close(true);
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(last, activeIndex + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(0, activeIndex - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(last);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      // focus returns to the trigger first, so the browser moves on from there to the next or previous field
      close(true);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      setActiveIndex(typeAhead(options, activeIndex, event.key));
    }
  };

  return (
    <div
      data-slot="px-select"
      data-state={open ? "open" : "closed"}
      data-disabled={disabled ? "" : undefined}
      className={cn("block leading-[1.5] text-foreground", disabled && "pointer-events-none opacity-55", className)}
      {...props}
    >
      <span id={labelId} className="mb-1.5 block text-[12.5px] font-medium">
        {label}
      </span>
      <div ref={anchorRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={`${labelId} ${valueId}`}
          aria-describedby={hint ? hintId : undefined}
          disabled={disabled}
          onClick={() => (open ? close(false) : setOpen(true))}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            "flex h-[42px] w-full cursor-pointer items-center gap-2.5 rounded-[10px] border bg-card px-3 text-left font-[inherit] text-[14px] text-inherit outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid",
            open
              ? "border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] ring-[3px] ring-lumesec/14"
              : "border-border hover:border-[color-mix(in_srgb,var(--foreground)_25%,var(--border))]",
          )}
        >
          <span id={valueId} className="min-w-0 flex-1 overflow-x-clip">
            <RollText
              text={options[selectedIndex]?.label ?? ""}
              direction={roll.direction}
              animate={roll.animate && roll.index === selectedIndex}
            />
          </span>
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={cn(
              "size-3 flex-none text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
              open && "rotate-180",
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 4.5L6 8l3.5-3.5" />
          </svg>
        </button>
        <div
          ref={popRef}
          hidden={!open}
          className="absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-[12px] border border-border bg-card p-[5px] shadow-[0_16px_36px_-14px_rgb(0_0_0/0.45)]"
        >
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-[5px] block h-[calc(100%-10px)] w-[calc(100%-10px)] [image-rendering:pixelated]"
          />
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={labelId}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            onKeyDown={onListKeyDown}
            onBlur={(event) => {
              // focus that moves to another element closes the menu; a press outside is handled on pointerdown
              const next = event.relatedTarget;
              if (next instanceof Node && !anchorRef.current?.contains(next)) setOpen(false);
            }}
            onScroll={redraw}
            className="relative m-0 max-h-[240px] list-none overflow-auto p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
          >
            {options.map((option, index) => (
              <li
                key={values[index]}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                id={optionId(index)}
                role="option"
                aria-selected={index === selectedIndex}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
                className="grid cursor-pointer gap-px rounded-lg py-2 pr-8 pl-3 text-[13.5px]"
              >
                {option.label}
                {option.description ? (
                  <small className="text-[12px] text-muted-foreground">{option.description}</small>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <span id={hintId} className="mt-1.5 block min-h-[1.45em] text-[12px] text-muted-foreground">
        {hint}
      </span>
      {name ? <input type="hidden" name={name} value={values[selectedIndex] ?? ""} disabled={disabled} /> : null}
    </div>
  );
}

/** Type-ahead: the next option after `from` whose label starts with `key`, wrapping to the first; `from` when none does. */
function typeAhead(options: readonly PxSelectOption[], from: number, key: string) {
  const letter = key.toLowerCase();
  const startsWith = (option: PxSelectOption) => option.label.toLowerCase().startsWith(letter);
  const after = options.findIndex((option, index) => index > from && startsWith(option));
  const match = after >= 0 ? after : options.findIndex(startsWith);
  return match >= 0 ? match : from;
}
