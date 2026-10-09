"use client";

import * as React from "react";

import { resolveColor } from "@/lib/lumesec/color";
import { rand } from "@/lib/lumesec/math";
import { prefersReducedMotion, shake, useLazyRef } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks } from "@/lib/lumesec/sparks";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Imperative handle of `PxOtp`. */
export interface PxOtpHandle {
  /** Clear the digits and the result, and show the hint again. */
  reset(): void;
  /** Move focus into the code input. */
  focus(): void;
}

/** Props of `PxOtp`. Other `div` props go to the root. */
export interface PxOtpProps extends Omit<React.ComponentProps<"div">, "ref" | "children" | "defaultValue" | "onChange"> {
  /** Controlled digits entered so far. Use with `onValueChange`. */
  value?: string;
  /** Initial digits when uncontrolled. */
  defaultValue?: string;
  /** Called with the digits entered so far on every change. */
  onValueChange?: (value: string) => void;
  /** Called when the sixth digit is entered, with the code and whether it matched `code`. */
  onComplete?: (code: string, valid: boolean) => void;
  /** Expected code. When set, a complete entry is compared with it; when missing, any six digits are valid. */
  code?: string;
  /** Message under the boxes until a code is checked, and again after `reset()`. */
  hint?: string;
  /** Form field name. */
  name?: string;
  /** Dims the boxes and disables the input. */
  disabled?: boolean;
  /** Imperative handle with `reset()` and `focus()`. */
  ref?: React.Ref<PxOtpHandle>;
}

type OtpStatus = "idle" | "ok" | "error";

/** A pixel of a removed digit, flying off and fading. */
interface LoosePixel {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Falls with gravity and shows in the error colour (a rejected code). */
  fall: boolean;
}

const LENGTH = 6;
const GAP = 9;
const DEFAULT_HINT = "Enter the 6-digit code";

/** A digit rises 16px into its box and sharpens, with a small overshoot. */
const RISE_KEYFRAMES: Keyframe[] = [
  { transform: "translateY(16px)", opacity: 0, filter: "blur(2px)" },
  { opacity: 1, filter: "blur(0)", offset: 0.45 },
  { transform: "translateY(0)", opacity: 1, filter: "blur(0)" },
];
const RISE_TIMING: KeyframeAnimationOptions = { duration: 420, easing: "cubic-bezier(.3,1.35,.5,1)" };

/** Spacing of the pixels a removed digit breaks into. */
const DUST_PITCH = 3;

/**
 * Six-digit one-time-code field backed by one real input, so typing, paste and code autofill work.
 * Digits rise into dotted boxes; a correct code sparks, a wrong one shakes and its digits break into
 * falling pixels. Compare codes on the server: `code` is a client-side check for demos and instant feedback.
 *
 * @example
 * <PxOtp name="code" onComplete={(code) => verify(code)} />
 */
export function PxOtp({
  value: valueProp,
  defaultValue = "",
  onValueChange,
  onComplete,
  code,
  hint = DEFAULT_HINT,
  name,
  disabled = false,
  className,
  ref,
  ...props
}: PxOtpProps) {
  const messageId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const [status, setStatus] = React.useState<OtpStatus>("idle");
  /** A result message replacing the hint; null shows the hint. */
  const [notice, setNotice] = React.useState<string | null>(null);

  /**
   * The digit each box showed after the last change, to tell which boxes changed. It starts with the
   * initial digits, so server-rendered digits do not rise again after hydration.
   */
  const shown = React.useRef(Array.from({ length: LENGTH }, (_, i) => value[i] ?? ""));
  const digitRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const loose = React.useRef<LoosePixel[]>([]);
  const sparksRef = useLazyRef(() => new Sparks());
  const timers = React.useRef(new Set<number>());

  const { ref: canvasRef, redraw } = usePixelCanvas(({ clear, dot, palette, time, delta, context, width }) => {
    const focused = document.activeElement === inputRef.current;
    const settledColor = status === "ok" ? palette.success : status === "error" ? palette.destructive : null;
    let busy = false;
    clear();
    for (let i = 0; i < LENGTH; i++) {
      const box = boxAt(i, width);
      const active = focused && status === "idle" && i === Math.min(LENGTH - 1, value.length);
      const color = settledColor ?? (active ? palette.accent : palette.foreground);
      const alpha = status !== "idle" ? 0.9 : active ? 0.6 + 0.4 * Math.sin(time * 6) : value[i] ? 0.45 : 0.22;
      if (active) busy = true;
      for (let x = box.x + 4; x < box.x + box.width - 4; x += 3) {
        dot(x, box.y, color, alpha, 2);
        dot(x, box.y + box.height - 2, color, alpha, 2);
      }
      for (let y = box.y + 4; y < box.y + box.height - 4; y += 3) {
        dot(box.x, y, color, alpha, 2);
        dot(box.x + box.width - 2, y, color, alpha, 2);
      }
    }
    loose.current = loose.current.filter((pixel) => {
      pixel.age += delta;
      if (pixel.age > 0.4) return false;
      if (pixel.fall) pixel.vy += 600 * delta;
      pixel.x += pixel.vx * delta;
      pixel.y += pixel.vy * delta;
      dot(pixel.x, pixel.y, pixel.fall ? palette.destructive : palette.muted, (1 - pixel.age / 0.4) * 0.8, 2.4);
      return true;
    });
    const sparking = sparksRef.current.step(context, delta);
    return busy || loose.current.length > 0 || sparking;
  });

  /** Break the digit shown in box `index` into pixels: drifting when removed, falling when rejected. */
  const shatter = React.useCallback(
    (index: number, char: string, fall: boolean) => {
      const canvas = canvasRef.current;
      const digit = digitRefs.current[index];
      if (!canvas || !digit || !char) return;
      const box = boxAt(index, canvas.clientWidth);
      for (const [x, y] of glyphPixels(char, digit, box.width, box.height)) {
        loose.current.push({
          x: box.x + x,
          y: box.y + y,
          vx: fall ? rand(-40, 40) : rand(-20, 20),
          vy: fall ? rand(-80, 0) : rand(-30, 30),
          age: 0,
          fall,
        });
      }
    },
    [canvasRef],
  );

  // digits that changed rise into their boxes; the ones they replace break into pixels
  React.useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    for (let i = 0; i < LENGTH; i++) {
      const char = value[i] ?? "";
      const previous = shown.current[i];
      if (previous === char) continue;
      shatter(i, previous, false);
      shown.current[i] = char;
      const digit = digitRefs.current[i];
      if (char && !reduced && digit && typeof digit.animate === "function") digit.animate(RISE_KEYFRAMES, RISE_TIMING);
    }
    redraw();
  }, [value, shatter, redraw]);

  React.useEffect(redraw, [status, redraw]);

  const cancelTimers = React.useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current.clear();
  }, []);

  React.useEffect(() => cancelTimers, [cancelTimers]);

  const later = (callback: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      callback();
    }, ms);
    timers.current.add(id);
  };

  const reset = React.useCallback(() => {
    // a pending clear after a wrong code would otherwise wipe digits typed after the reset
    cancelTimers();
    // the digits vanish without breaking apart
    shown.current.fill("");
    setValue("");
    setStatus("idle");
    setNotice(null);
    redraw();
  }, [cancelTimers, setValue, redraw]);

  React.useImperativeHandle(ref, () => ({ reset, focus: () => inputRef.current?.focus() }), [reset]);

  useFormReset(inputRef, reset);

  const complete = (digits: string) => {
    const valid = !code || code === digits;
    setStatus(valid ? "ok" : "error");
    const canvas = canvasRef.current;
    if (valid) {
      if (canvas) {
        const colors = [resolveColor(canvas, "--lumesec-success"), resolveColor(canvas, "--lumesec-shine")];
        for (let i = 0; i < LENGTH; i++) {
          later(() => {
            const box = boxAt(i, canvas.clientWidth);
            sparksRef.current.add(box.x + box.width / 2, box.y + box.height / 2, 10, colors, { speed: [30, 120] });
            redraw();
          }, i * 60);
        }
      }
      setNotice("Code verified");
      inputRef.current?.blur();
    } else {
      shake(wrapRef.current);
      setNotice("That code didn’t match. Try again.");
      later(() => {
        shown.current.forEach((char, i) => shatter(i, char, true));
        shown.current.fill("");
        setValue("");
        setStatus("idle");
        // ready for the next attempt, unless the user has moved on to another control meanwhile
        const active = document.activeElement;
        if (!active || active === document.body) inputRef.current?.focus();
        redraw();
      }, 650);
    }
    onComplete?.(digits, valid);
  };

  return (
    <div
      data-slot="px-otp"
      data-state={status === "idle" ? undefined : status}
      data-disabled={disabled ? "" : undefined}
      className={cn("group/otp block leading-[1.5] text-foreground", disabled && "pointer-events-none opacity-55", className)}
      {...props}
    >
      <div ref={wrapRef} className="relative mx-auto w-[300px] max-w-full">
        <canvas ref={canvasRef} aria-hidden="true" className="block h-16 w-full [image-rendering:pixelated]" />
        {/* the digits are text over the drawn boxes; the input below holds the accessible value */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1 grid h-14 grid-cols-6 gap-[9px]">
          {Array.from({ length: LENGTH }, (_, i) => (
            <span key={i} className="grid place-items-center">
              <span
                ref={(node) => {
                  digitRefs.current[i] = node;
                }}
                className="font-mono text-[28px] leading-none font-semibold tracking-[-0.02em] text-foreground tabular-nums transition-colors duration-200 group-data-[state=error]/otp:text-destructive group-data-[state=ok]/otp:text-lumesec-success"
              >
                {value[i] ?? ""}
              </span>
            </span>
          ))}
        </div>
        <input
          ref={inputRef}
          name={name}
          inputMode="numeric"
          autoComplete="one-time-code"
          // no maxLength: a pasted "424 242" must reach onChange whole, which keeps the first six digits
          aria-label="6-digit code"
          aria-describedby={messageId}
          disabled={disabled}
          value={value}
          onChange={(event) => {
            // after a result, typing is ignored until the field resets
            if (status !== "idle") return;
            const digits = event.target.value.replace(/\D/g, "").slice(0, LENGTH);
            setValue(digits);
            if (digits.length === LENGTH) complete(digits);
            redraw();
          }}
          onKeyDown={(event) => {
            // the caret stays at the end of the code
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) event.preventDefault();
          }}
          onFocus={redraw}
          onBlur={redraw}
          className="absolute inset-0 size-full cursor-text border-0 bg-transparent p-0 font-[inherit] text-[16px] text-transparent opacity-0 outline-none [caret-color:transparent]"
        />
      </div>
      <span
        id={messageId}
        className={cn(
          "mt-2.5 block text-center text-[12.5px] text-muted-foreground",
          status === "ok" && "text-lumesec-success",
          status === "error" && "text-destructive",
        )}
      >
        <RollText text={notice ?? hint} direction={notice === null ? -1 : 1} className="justify-items-center" aria-live="polite" />
      </span>
    </div>
  );
}

/** The box of digit `index` in a canvas `width` px wide. */
function boxAt(index: number, width: number) {
  const boxWidth = (width - (LENGTH - 1) * GAP) / LENGTH;
  return { x: index * (boxWidth + GAP), y: 4, width: boxWidth, height: 56 };
}

/**
 * Pixel positions covering `char` as `element`'s font draws it, centred in a `width` x `height` box, on a
 * `DUST_PITCH` grid. The text is drawn once on a scratch canvas and sampled, so the dust has the digit's shape.
 */
function glyphPixels(char: string, element: Element, width: number, height: number): Array<[number, number]> {
  const scratch = document.createElement("canvas");
  scratch.width = Math.max(1, Math.ceil(width));
  scratch.height = Math.max(1, Math.ceil(height));
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const style = getComputedStyle(element);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(char, scratch.width / 2, scratch.height / 2);
  const { data } = context.getImageData(0, 0, scratch.width, scratch.height);
  const points: Array<[number, number]> = [];
  for (let y = DUST_PITCH / 2; y < scratch.height; y += DUST_PITCH) {
    for (let x = DUST_PITCH / 2; x < scratch.width; x += DUST_PITCH) {
      if (data[(Math.floor(y) * scratch.width + Math.floor(x)) * 4 + 3] > 96) points.push([x - 1.2, y - 1.2]);
    }
  }
  return points;
}
