"use client";

import * as React from "react";

import { useReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Where the text stands against its budget: `warn` from 80% of the limit, `over` past it. */
export type PxTextareaZone = "ok" | "warn" | "over";

/** Props of `PxTextarea`. Other `div` props go to the wrapper; the textarea's own attributes are the props below. */
export interface PxTextareaProps extends Omit<React.ComponentProps<"div">, "defaultValue" | "children"> {
  /** Controlled text. Use with `onValueChange`. */
  value?: string;
  /** Initial text when uncontrolled; a form reset restores it. */
  defaultValue?: string;
  /** Called on every edit with the new text. */
  onValueChange?: (value: string) => void;
  /** Called when the textarea commits a change: on blur after editing (the native `change` event). */
  onValueCommit?: (value: string) => void;
  /** Character budget. Typing past it is allowed but marks the field invalid. */
  limit?: number;
  /** Label above the field, linked to the textarea. */
  label?: React.ReactNode;
  /** Placeholder of the textarea. */
  placeholder?: string;
  /** Form field name; the text submits under it. */
  name?: string;
  /** Disables the textarea and dims the field. */
  disabled?: boolean;
  /** Marks the textarea as required for form validation. */
  required?: boolean;
  /** Makes the textarea read-only. */
  readOnly?: boolean;
}

/**
 * Auto-growing text area with a pixel character budget. The bar fills with the text, turns amber from
 * 80% of `limit` and blinks red past it, where the counter shows the overrun and the textarea reports a
 * custom validity error, so the form will not submit.
 *
 * @example
 * <PxTextarea name="bio" label="Short bio" limit={120} placeholder="A sentence or two about you" />
 */
export function PxTextarea({
  value: valueProp,
  defaultValue = "",
  onValueChange,
  onValueCommit,
  limit = 280,
  label,
  placeholder,
  name,
  disabled,
  required,
  readOnly,
  className,
  ...props
}: PxTextareaProps) {
  const id = React.useId();
  const textareaId = `${id}-textarea`;
  const counterId = `${id}-counter`;
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const reduced = useReducedMotion();
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });

  const length = value.length;
  // share of the budget used; a zero budget is spent by the first character
  const used = limit > 0 ? length / limit : length > 0 ? Infinity : 0;
  const over = used > 1;
  const zone: PxTextareaZone = over ? "over" : used >= 0.8 ? "warn" : "ok";

  // the counter changes on every keystroke, so screen readers hear only when the zone changes
  const [announcement, setAnnouncement] = React.useState({ zone, text: "" });
  if (announcement.zone !== zone) setAnnouncement({ zone, text: zoneAnnouncement(zone, length, limit) });

  /** Animated fill of the budget bar, 0 to 1.25 (it runs past 1 when over). */
  const fill = React.useRef(0);
  const { ref: canvasRef, redraw } = usePixelCanvas(({ palette, time, delta, width, clear, dot }) => {
    const target = Math.min(1.25, used);
    fill.current = reduced ? target : fill.current + (target - fill.current) * Math.min(1, delta * 10);
    const share = fill.current;
    const columns = Math.floor(width / 4);
    const overflowing = share > 1;
    clear();
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < 2; row++) {
        // past the limit the bar rescales, so the limit mark moves left and the overrun shows in red
        const u = ((column + 0.5) / columns) * (overflowing ? share : 1);
        const on = u <= share;
        const zoneColor = u > 1 ? palette.destructive : u >= 0.8 ? palette.warning : palette.accent;
        const blink = u > 1 && !reduced ? 0.6 + 0.4 * Math.sin(time * 10) : 1;
        dot(column * 4, row * 4 + 1, on ? zoneColor : palette.foreground, on ? 0.95 * blink : 0.12, 2.6);
      }
    }
    if (overflowing) {
      const x = Math.floor(columns / share) * 4;
      for (let y = 0; y < 10; y += 3) dot(x - 1, y, palette.foreground, 0.8, 1.6);
    }
    // the overrun keeps blinking, except with reduced motion
    return Math.abs(share - target) > 0.001 || (overflowing && !reduced);
  });

  React.useEffect(redraw, [length, limit, reduced, redraw]);

  // grow with the content
  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) fitHeight(textarea);
  }, [value]);

  // a narrower field wraps into more lines: refit when the width changes, or the extra lines are clipped
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let width = textarea.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.offsetWidth === width) return;
      width = textarea.offsetWidth;
      fitHeight(textarea);
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    textareaRef.current?.setCustomValidity(over ? `Keep it to ${limit} characters or fewer` : "");
  }, [over, limit]);

  useFormReset(textareaRef, () => setValue(defaultValue));

  // React's onChange is the input event; the commit callback needs the native change event
  const onCommit = React.useRef(onValueCommit);
  React.useEffect(() => {
    onCommit.current = onValueCommit;
  });
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const handleChange = () => onCommit.current?.(textarea.value);
    textarea.addEventListener("change", handleChange);
    return () => textarea.removeEventListener("change", handleChange);
  }, []);

  return (
    <div
      data-slot="px-textarea"
      data-zone={zone}
      data-disabled={disabled ? "" : undefined}
      className={cn("block text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-55", className)}
      {...props}
    >
      {label != null && (
        <label htmlFor={textareaId} className="mb-1.5 block text-[12.5px] font-medium">
          {label}
        </label>
      )}
      <textarea
        ref={textareaRef}
        id={textareaId}
        name={name}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        readOnly={readOnly}
        aria-describedby={counterId}
        aria-invalid={over || undefined}
        onChange={(event) => setValue(event.target.value)}
        className={cn(
          "block min-h-[84px] w-full resize-none overflow-hidden rounded-[10px] border border-border bg-card px-3 py-2.5 font-[inherit] text-[14px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground",
          "[transition:border-color_.2s,box-shadow_.2s] focus-visible:ring-3 focus-visible:ring-lumesec/14",
          over
            ? "border-[color-mix(in_srgb,var(--destructive)_65%,var(--border))]"
            : "focus-visible:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))]",
        )}
      />
      <div className="mt-2 flex items-center gap-2.5">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="block h-[10px] w-full min-w-0 flex-1 [image-rendering:pixelated]"
        />
        <span
          id={counterId}
          className={cn(
            "min-w-[7ch] text-right font-mono text-[12px] text-muted-foreground tabular-nums",
            zone === "warn" && "text-lumesec-warning",
            zone === "over" && "font-semibold text-destructive",
          )}
        >
          <span aria-hidden="true">{over ? `−${length - limit}` : `${limit - length} left`}</span>
          <span className="sr-only">{budgetText(length, limit)}</span>
        </span>
        <span role="status" className="sr-only">
          {announcement.text}
        </span>
      </div>
    </div>
  );
}

/** The counter in words, as the textarea's description: "40 of 120 characters left". */
function budgetText(length: number, limit: number) {
  if (length <= limit) return `${limit - length} of ${limit} characters left`;
  const overrun = length - limit;
  return `${overrun} ${overrun === 1 ? "character" : "characters"} over the limit of ${limit}`;
}

/** What screen readers hear when the text enters a zone; nothing when it drops back below 80%. */
function zoneAnnouncement(zone: PxTextareaZone, length: number, limit: number) {
  return zone === "ok" ? "" : budgetText(length, limit);
}

/** Size the field to its content, at least 84px; the 2px cover the borders, which scrollHeight leaves out. */
function fitHeight(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(84, textarea.scrollHeight + 2)}px`;
}
