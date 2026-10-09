"use client";

import * as React from "react";

import { mixRgb, rand } from "@/lib/lumesec/math";
import { prefersReducedMotion, shake } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Props of `PxTags`. Other `div` props go to the root. */
export interface PxTagsProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue" | "onChange"> {
  /** Controlled tags. Use with `onValueChange`. */
  value?: readonly string[];
  /** Initial tags when uncontrolled. */
  defaultValue?: readonly string[];
  /** Called when tags are added (Enter, comma, a suggestion or a paste) or removed. A paste reports once. */
  onValueChange?: (value: string[]) => void;
  /** Label text, linked to the input. */
  label?: React.ReactNode;
  /** Placeholder of the input. */
  placeholder?: string;
  /** Shown as "+ name" buttons under the field; clicking one adds it. */
  suggestions?: readonly string[];
  /** Maximum number of tags. Adding beyond it shakes the field and shows a message. */
  max?: number;
  /** Form field name. The tags are submitted joined with commas. */
  name?: string;
  /** Dims the field and disables the input and every button. */
  disabled?: boolean;
}

/** A pixel of a new chip's spray or of a removed chip breaking apart. */
interface TagPixel {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** Accent mixed toward the foreground by this share, or the shine colour. */
  tone: number | "shine";
  /** Time in seconds when it starts moving; until then it holds still, so a chip breaks from left to right. */
  delay: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EMPTY: readonly string[] = [];

/** Chips scale in with a little overshoot. */
const CHIP_IN: Keyframe[] = [
  { transform: "scale(.6)", opacity: 0 },
  { transform: "none", opacity: 1 },
];

/** The pixels of a removed chip: it breaks apart from left to right, starting now. */
function shatter(rect: Rect): TagPixel[] {
  const now = performance.now() / 1000;
  const pixels: TagPixel[] = [];
  for (let y = rect.y + 2; y < rect.y + rect.height - 1; y += 3) {
    for (let x = rect.x + 2; x < rect.x + rect.width - 1; x += 3) {
      pixels.push({
        x,
        y,
        vx: rand(10, 90),
        vy: rand(-60, 10),
        age: 0,
        life: rand(0.35, 0.8),
        tone: Math.random() * 0.5,
        delay: now + ((x - rect.x) / rect.width) * 0.15,
      });
    }
  }
  return pixels;
}

/**
 * Tag input: Enter or a comma adds the typed text as a chip, Backspace twice on an empty field removes
 * the last chip, and pasting comma-separated text adds each part. New chips spray pixels, duplicates
 * shake, and removed chips break into pixels.
 *
 * @example
 * <PxTags name="topics" label="Topics" defaultValue={["design", "pixels"]} suggestions={["motion", "forms"]} max={6} />
 */
export function PxTags({
  value: valueProp,
  defaultValue = EMPTY,
  onValueChange,
  label = "Tags",
  placeholder = "Add a tag and press Enter",
  suggestions = EMPTY,
  max = 8,
  name,
  disabled = false,
  className,
  ...props
}: PxTagsProps) {
  const inputId = React.useId();
  const messageId = `${inputId}-message`;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const chipRefs = React.useRef(new Map<string, HTMLSpanElement>());
  const [tags, setTags] = useControllableState<readonly string[]>({
    value: valueProp,
    defaultValue,
    onChange: (next) => onValueChange?.([...next]),
  });
  const [draft, setDraft] = React.useState("");
  /** The chip the first Backspace marked; a second Backspace removes it. */
  const [marked, setMarked] = React.useState<string | null>(null);
  /** Chips just refused as duplicates, outlined for a moment. */
  const [refused, setRefused] = React.useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = React.useState({ limit: false, animate: false });

  const pixels = React.useRef<TagPixel[]>([]);
  const timers = React.useRef(new Set<number>());
  const frames = React.useRef(new Set<number>());
  /** Tags the user just added, whose chips scale in once rendered. */
  const entering = React.useRef(new Set<string>());

  const { ref: canvasRef, redraw } = usePixelCanvas(({ clear, dot, palette, time, delta }) => {
    clear();
    pixels.current = pixels.current.filter((pixel) => {
      const color = pixel.tone === "shine" ? palette.shine : mixRgb(palette.accent, palette.foreground, pixel.tone);
      if (time < pixel.delay) {
        dot(pixel.x, pixel.y, color, 0.8, 2);
        return true;
      }
      pixel.age += delta;
      if (pixel.age > pixel.life) return false;
      pixel.vx *= Math.exp(-delta * 2);
      pixel.vy += 120 * delta;
      pixel.x += pixel.vx * delta;
      pixel.y += pixel.vy * delta;
      dot(pixel.x, pixel.y, color, 1 - pixel.age / pixel.life, 2);
      return true;
    });
    return pixels.current.length > 0;
  });

  React.useEffect(() => {
    const pendingTimers = timers.current;
    const pendingFrames = frames.current;
    return () => {
      pendingTimers.forEach((id) => window.clearTimeout(id));
      pendingFrames.forEach((id) => window.cancelAnimationFrame(id));
    };
  }, []);

  React.useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    for (const tag of entering.current) {
      const chip = chipRefs.current.get(tag);
      if (chip && !reduced && typeof chip.animate === "function") {
        chip.animate(CHIP_IN, { duration: 300, easing: "cubic-bezier(.2,1.4,.4,1)" });
      }
    }
    entering.current.clear();
  }, [tags]);

  useFormReset(inputRef, () => {
    setTags(defaultValue);
    setDraft("");
    setMarked(null);
    setRefused(new Set());
    setMessage({ limit: false, animate: false });
  });

  /** A chip's box relative to the canvas, which extends 20px past the field on the left, top and bottom. */
  const rectOf = (chip: Element): Rect | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const chipBox = chip.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();
    return {
      x: chipBox.left - canvasBox.left,
      y: chipBox.top - canvasBox.top,
      width: chipBox.width,
      height: chipBox.height,
    };
  };

  const markRefused = (tag: string, on: boolean) =>
    setRefused((previous) => {
      const next = new Set(previous);
      if (on) next.add(tag);
      else next.delete(tag);
      return next;
    });

  /** Add tags (trimmed, inner whitespace collapsed). Duplicates and tags past `max` are refused. */
  const add = (raws: readonly string[]) => {
    const next = [...tags];
    const added: string[] = [];
    let clearDraft = false;
    let limitReached: boolean | null = null;
    for (const raw of raws) {
      const tag = raw.trim().replace(/\s+/g, " ");
      if (!tag) continue;
      const duplicate = next.find((existing) => existing.toLowerCase() === tag.toLowerCase());
      if (duplicate !== undefined) {
        shake(chipRefs.current.get(duplicate));
        markRefused(duplicate, true);
        const id = window.setTimeout(() => {
          timers.current.delete(id);
          markRefused(duplicate, false);
        }, 600);
        timers.current.add(id);
        clearDraft = true;
        continue;
      }
      if (next.length >= max) {
        shake(fieldRef.current);
        limitReached = true;
        continue;
      }
      next.push(tag);
      added.push(tag);
      clearDraft = true;
      limitReached = false;
    }
    if (clearDraft) setDraft("");
    if (limitReached !== null) setMessage({ limit: limitReached, animate: true });
    if (!added.length) return;
    setTags(next);
    for (const tag of added) entering.current.add(tag);
    if (prefersReducedMotion()) return;
    // spray from the new chips once they are on screen
    const frame = window.requestAnimationFrame(() => {
      frames.current.delete(frame);
      for (const tag of added) {
        const chip = chipRefs.current.get(tag);
        const rect = chip && rectOf(chip);
        if (!rect) continue;
        for (let k = 0; k < 14; k++) {
          pixels.current.push({
            x: rect.x + rand(0, rect.width),
            y: rect.y + rand(0, rect.height),
            vx: rand(-60, 60),
            vy: rand(-70, 20),
            age: 0,
            life: rand(0.3, 0.6),
            tone: k % 2 ? 0 : "shine",
            delay: 0,
          });
        }
      }
      redraw();
    });
    frames.current.add(frame);
  };

  const remove = (index: number) => {
    const tag = tags[index];
    if (tag === undefined) return;
    const chip = chipRefs.current.get(tag);
    const rect = chip && rectOf(chip);
    if (rect && !prefersReducedMotion()) {
      pixels.current.push(...shatter(rect));
    }
    setTags(tags.filter((_, i) => i !== index));
    setMarked(null);
    markRefused(tag, false);
    setMessage({ limit: false, animate: true });
    inputRef.current?.focus();
    redraw();
  };

  return (
    <div
      data-slot="px-tags"
      data-disabled={disabled ? "" : undefined}
      className={cn("block leading-[1.5] text-foreground", disabled && "pointer-events-none opacity-55", className)}
      {...props}
    >
      <label htmlFor={inputId} className="mb-1.5 block text-[12.5px] font-medium">
        {label}
      </label>
      <div
        ref={fieldRef}
        onClick={(event) => {
          if (event.target === event.currentTarget) inputRef.current?.focus();
        }}
        className="relative flex min-h-[42px] cursor-text flex-wrap items-center gap-1.5 rounded-[10px] border border-border bg-card px-2 py-1.5 transition-[border-color,box-shadow] duration-200 ease-[ease] focus-within:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] focus-within:ring-[3px] focus-within:ring-lumesec/14"
      >
        {tags.map((tag, index) => (
          <span
            key={tag}
            ref={(node) => {
              if (node) chipRefs.current.set(tag, node);
              else chipRefs.current.delete(tag);
            }}
            className={cn(
              "inline-flex h-7 max-w-full items-center gap-1 rounded-[7px] bg-lumesec/14 py-0 pr-1 pl-2.5 text-[13px] text-foreground",
              (marked === tag || refused.has(tag)) && "shadow-[0_0_0_1.5px_var(--destructive)]",
            )}
          >
            <span className="min-w-0 truncate">{tag}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${tag}`}
              onClick={() => remove(index)}
              className="grid size-5 flex-none cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-muted-foreground outline-none select-none hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
            >
              <svg
                viewBox="0 0 10 10"
                aria-hidden="true"
                className="size-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
              >
                <path d="M2 2l6 6M8 2L2 8" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          value={draft}
          aria-describedby={messageId}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add([draft]);
            } else if (event.key === "Backspace" && !draft && tags.length) {
              // the first Backspace marks the last chip, the second removes it
              const last = tags[tags.length - 1];
              if (marked === last) remove(tags.length - 1);
              else setMarked(last);
            } else if (marked !== null) {
              setMarked(null);
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!text.includes(",")) return;
            event.preventDefault();
            add(text.split(","));
          }}
          className="h-7 min-w-[6em] flex-1 border-0 bg-transparent px-1 py-0 font-[inherit] text-[14px] text-inherit outline-none placeholder:text-muted-foreground placeholder:opacity-75"
        />
        {/*
          The pixels fly 20px past the field on the left, top and bottom. The canvas stops at the right edge:
          a box reaching past it would widen the page and scroll it sideways on phones.
        */}
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute -top-5 -left-5 z-[2] block h-[calc(100%+40px)] w-[calc(100%+20px)] [image-rendering:pixelated]"
        />
      </div>
      <span id={messageId} className="mt-1.5 block min-h-[1.45em] text-[12px] text-muted-foreground">
        <RollText
          text={message.limit ? `You can add up to ${max} tags` : `${tags.length} of ${max} tags`}
          animate={message.animate}
          aria-live="polite"
        />
      </span>
      {/* the outline is the only visual cue of the mark, so screen readers hear what the next Backspace does */}
      <span role="status" className="sr-only">
        {marked === null ? "" : `${marked} selected. Press Backspace again to remove it.`}
      </span>
      <div className="mt-0.5 flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => add([suggestion])}
            className="inline-flex h-[26px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-[9px] font-[inherit] text-[12px] font-medium whitespace-nowrap text-foreground outline-none select-none [transition:transform_.15s_cubic-bezier(.2,.8,.2,1),background-color_.2s,border-color_.2s,color_.2s] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid active:[transform:scale(.95)]"
          >
            + {suggestion}
          </button>
        ))}
      </div>
      {name ? <input type="hidden" name={name} value={tags.join(",")} disabled={disabled} /> : null}
    </div>
  );
}
