"use client";

import * as React from "react";

import { clamp } from "@/lib/lumesec/math";
import { prefersReducedMotion, springEuler, useAnimationLoop } from "@/lib/lumesec/motion";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

export interface UiSegmentedProps extends Omit<React.ComponentProps<"div">, "onChange" | "defaultValue"> {
  /** Option labels. Each label is also the option's value. */
  options?: readonly string[];
  /** Controlled selected label. Use with `onValueChange`. */
  value?: string;
  /** Initial selected label when uncontrolled. Defaults to the first option. */
  defaultValue?: string;
  /** Called when the user picks a different option by click or arrow key. */
  onValueChange?: (value: string) => void;
  /** Accessible name of the radio group. */
  label?: string;
}

const DEFAULT_OPTIONS = ["Chat", "Code", "Design"] as const;

const OPTION_CLASS =
  "rounded-lg border-0 bg-transparent px-[15px] py-1.5 font-[inherit] text-[13.5px] leading-normal font-medium whitespace-nowrap select-none";

/**
 * Segmented control whose selection pill is driven by two springs, so it stretches between options and
 * recolours labels exactly where it covers them. Options are radio buttons with a roving tab stop.
 *
 * @example
 * <UiSegmented options={["Day", "Week", "Month", "Year"]} defaultValue="Week" label="Range" />
 */
export function UiSegmented({
  options = DEFAULT_OPTIONS,
  value: valueProp,
  defaultValue,
  onValueChange,
  label = "Options",
  className,
  ...props
}: UiSegmentedProps) {
  const [value, setValue] = useControllableState({
    value: valueProp,
    defaultValue: defaultValue ?? options[0] ?? "",
    onChange: onValueChange,
  });
  const index = Math.max(0, options.indexOf(value));
  const optionsKey = options.join("\u0000");

  const baseRef = React.useRef<HTMLDivElement>(null);
  const pillRef = React.useRef<HTMLDivElement>(null);
  const topRef = React.useRef<HTMLDivElement>(null);
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const indexRef = React.useRef(index);

  // two edges, each its own spring: positions, velocities and targets in px
  const edges = React.useRef({
    left: { position: 0, velocity: 0 },
    right: { position: 0, velocity: 0 },
    leftTarget: 0,
    rightTarget: 0,
    direction: 1,
  });

  const loop = useAnimationLoop(baseRef, step);

  const paint = React.useCallback((scaleY: number) => {
    const pill = pillRef.current;
    const top = topRef.current;
    if (!pill || !top) return;
    const left = edges.current.left.position;
    const right = edges.current.right.position;
    pill.style.width = `${Math.max(0, right - left)}px`;
    pill.style.transform = `translateX(${3 + left}px) scaleY(${scaleY})`;
    // the foreground labels show only where the pill covers them; it flattens a little while stretched
    const inset = (1 - scaleY) * 14;
    top.style.clipPath = `inset(${inset}px ${Math.max(0, top.offsetWidth - right)}px ${inset}px ${left}px round 8px)`;
  }, []);

  /** Aim both edges at the selected option; `snap` jumps there without the spring. */
  const measure = React.useCallback(
    (snap: boolean) => {
      const button = buttons.current[indexRef.current];
      if (!button) return;
      const state = edges.current;
      state.leftTarget = button.offsetLeft;
      state.rightTarget = button.offsetLeft + button.offsetWidth;
      if (snap) {
        state.left = { position: state.leftTarget, velocity: 0 };
        state.right = { position: state.rightTarget, velocity: 0 };
        paint(1);
      }
      loop.kick();
    },
    [paint, loop],
  );

  function step(_time: number, delta: number) {
    const state = edges.current;
    const dt = Math.min(0.04, delta);
    // the leading edge springs fast, the trailing edge lags: the pill stretches like a droplet
    const leftStiffness = state.direction < 0 ? 900 : 260;
    const rightStiffness = state.direction > 0 ? 900 : 260;
    for (let i = 0; i < 3; i++) {
      springEuler(state.left, state.leftTarget, dt / 3, leftStiffness, 0.8);
      springEuler(state.right, state.rightTarget, dt / 3, rightStiffness, 0.8);
    }
    const width = Math.max(0, state.right.position - state.left.position);
    const stretch = width - (state.rightTarget - state.leftTarget);
    const scaleY = 1 - clamp(stretch / 260, 0, 0.14);
    paint(scaleY);
    const moving =
      Math.abs(state.left.position - state.leftTarget) > 0.05 ||
      Math.abs(state.right.position - state.rightTarget) > 0.05 ||
      Math.abs(state.left.velocity) + Math.abs(state.right.velocity) > 0.5;
    if (!moving && pillRef.current) {
      pillRef.current.style.transform = `translateX(${3 + state.leftTarget}px)`;
      pillRef.current.style.width = `${state.rightTarget - state.leftTarget}px`;
    }
    return moving;
  }

  // a new option list snaps the pill; a new selection springs it (or snaps with reduced motion)
  const measured = React.useRef<{ index: number; options: string } | null>(null);
  React.useLayoutEffect(() => {
    const previous = measured.current;
    measured.current = { index, options: optionsKey };
    indexRef.current = index;
    if (!previous || previous.options !== optionsKey) {
      measure(true);
      return;
    }
    if (previous.index === index) return;
    edges.current.direction = index > previous.index ? 1 : -1;
    measure(prefersReducedMotion());
  }, [index, optionsKey, measure]);

  React.useEffect(() => {
    const base = baseRef.current;
    if (!base) return;
    const observer = new ResizeObserver(() => measure(true));
    observer.observe(base);
    return () => observer.disconnect();
  }, [measure]);

  const select = (next: number) => {
    // compare labels, not indexes: a `value` missing from `options` shows the first option, which can still be picked
    if (next < 0 || options[next] === value) return;
    setValue(options[next]);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const offset =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!offset) return;
    event.preventDefault();
    const next = (indexRef.current + offset + options.length) % options.length;
    select(next);
    buttons.current[next]?.focus();
  };

  return (
    <div
      data-slot="ui-segmented"
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative inline-flex max-w-full rounded-[11px] bg-muted p-[3px] align-middle shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]",
        className,
      )}
      {...props}
    >
      <div
        ref={pillRef}
        aria-hidden="true"
        className="absolute top-[3px] left-0 h-[calc(100%-6px)] w-0 origin-center rounded-lg bg-card shadow-[0_1px_2px_rgba(0,0,0,.16),0_0_0_.5px_color-mix(in_srgb,var(--foreground)_12%,transparent)] will-change-[transform,width]"
      />
      <div ref={baseRef} className="relative flex">
        {options.map((option, i) => (
          <button
            key={option}
            ref={(node) => {
              buttons.current[i] = node;
            }}
            type="button"
            role="radio"
            aria-checked={i === index}
            tabIndex={i === index ? 0 : -1}
            data-state={i === index ? "checked" : "unchecked"}
            onClick={() => select(i)}
            onKeyDown={onKeyDown}
            className={cn(
              OPTION_CLASS,
              "cursor-pointer text-muted-foreground outline-none hover:text-[color-mix(in_srgb,var(--foreground)_75%,var(--muted-foreground))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid",
            )}
          >
            {option}
          </button>
        ))}
      </div>
      {/* the same labels in the foreground colour, clipped to the pill */}
      <div
        ref={topRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-[3px] flex [clip-path:inset(0_100%_0_0)]"
      >
        {options.map((option) => (
          <span key={option} className={cn(OPTION_CLASS, "text-foreground")}>
            {option}
          </span>
        ))}
      </div>
    </div>
  );
}
