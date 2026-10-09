"use client";

import * as React from "react";

import { parseColor } from "@/lib/lumesec/color";
import { clamp, type RGB } from "@/lib/lumesec/math";
import { shake } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { SMALL_ALERT, SMALL_CHECK } from "@/lib/lumesec/pixel-font";
import { RollText } from "@/lib/lumesec/roll-text";
import { cn } from "@/lib/utils";

/** Colour style of the button. */
export type PxButtonVariant = "default" | "secondary" | "danger";

/** What the button is showing: its label, the spinner, the check or the error mark. */
export type PxButtonStatus = "idle" | "loading" | "success" | "error";

/** Imperative handle of `PxButton`, passed through `ref`. */
export interface PxButtonHandle {
  /**
   * Shows the loading state while `task` runs, then the success or error state for 1.8 s before the
   * label returns. Resolves with the task's result or rethrows its error. It does not check `disabled`.
   */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Moves focus to the button. */
  focus(options?: FocusOptions): void;
}

/** Props of `PxButton`. Other `button` props go to the native button. */
export interface PxButtonProps extends Omit<React.ComponentProps<"button">, "ref" | "children" | "onClick" | "onError"> {
  /** Handle with `run()` and `focus()`. */
  ref?: React.Ref<PxButtonHandle>;
  /** The label. */
  children?: string;
  /** `secondary` is a bordered surface button, `danger` uses the destructive colour. */
  variant?: PxButtonVariant;
  /**
   * Shows the loading state while true, for loading driven from outside. Turning it on calls `onStart`;
   * turning it off returns to the label.
   */
  loading?: boolean;
  /** Label while loading. */
  loadingText?: string;
  /** Label after the task resolves. */
  successText?: string;
  /** Label after the task rejects. */
  errorText?: string;
  /**
   * Click handler. When it returns a promise, the button runs it like `run()`: spinner, then check or
   * error. Clicks are ignored while loading.
   */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
  /** Called when the loading state begins. */
  onStart?: () => void;
  /** Called when the task resolves. */
  onSuccess?: () => void;
  /** Called with the rejection reason when the task fails. */
  onError?: (error: unknown) => void;
}

/** Ink for the pixel icons before the button is mounted. */
const FALLBACK_INK: RGB = [255, 255, 255];

/** Seconds the label colour takes to change (`color .25s`), during which the icons keep sampling it. */
const INK_TRANSITION = 0.3;

/** Ring of eight cells around a 3x3 grid that the spinner's head runs along. */
const SPINNER_RING: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
];

/**
 * Async button. A promise from `onClick` (or `run()` on the handle) shows a pixel spinner and
 * "Working…", then a drawn check with "Done" or a shake with "Try again", and returns to its label
 * after 1.8 s. Labels roll between states.
 *
 * @example
 * <PxButton onClick={() => saveSettings()}>Save changes</PxButton>
 */
export function PxButton({
  ref,
  children = "Save",
  variant = "default",
  type = "button",
  loading = false,
  loadingText = "Working…",
  successText = "Done",
  errorText = "Try again",
  disabled,
  className,
  onClick,
  onStart,
  onSuccess,
  onError,
  ...props
}: PxButtonProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [status, setStatus] = React.useState<PxButtonStatus>(loading ? "loading" : "idle");

  // a change of the `loading` prop sets the state, adjusted during render so the spinner shows in the same paint
  const [previousLoading, setPreviousLoading] = React.useState(loading);
  if (loading !== previousLoading) {
    setPreviousLoading(loading);
    setStatus(loading ? "loading" : "idle");
  }

  const callbacks = React.useRef({ onStart, onSuccess, onError });
  React.useEffect(() => {
    callbacks.current = { onStart, onSuccess, onError };
  });

  const lastLoading = React.useRef(loading);
  React.useEffect(() => {
    if (loading && !lastLoading.current) callbacks.current.onStart?.();
    lastLoading.current = loading;
  }, [loading]);

  const resetTimer = React.useRef(0);
  React.useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const run = React.useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    setStatus("loading");
    callbacks.current.onStart?.();
    try {
      const result = await task();
      setStatus("success");
      callbacks.current.onSuccess?.();
      return result;
    } catch (error) {
      setStatus("error");
      callbacks.current.onError?.(error);
      throw error;
    } finally {
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setStatus("idle"), 1800);
    }
  }, []);

  React.useImperativeHandle(ref, () => ({ run, focus: (options) => buttonRef.current?.focus(options) }), [run]);

  /** When the current status began, in seconds, for the check's draw-in. */
  const statusSince = React.useRef(0);
  const { ref: canvasRef, redraw } = usePixelCanvas(({ palette, time, clear, dot }) => {
    clear();
    if (status === "idle") return false;
    if (status === "loading") {
      const ink = variant === "secondary" ? palette.foreground : textColor(buttonRef.current);
      const head = Math.floor(time * 12) % 8;
      for (let k = 0; k < 8; k++) {
        const [x, y] = SPINNER_RING[(head - k + 8) % 8];
        dot(x * 5, y * 5, ink, k < 5 ? 1 - k * 0.18 : 0.12, 4);
      }
      return true;
    }
    // the check and the alert draw in the label's colour, so they keep redrawing while it transitions
    const elapsed = time - statusSince.current;
    const ink = textColor(buttonRef.current);
    if (status === "success") {
      const progress = clamp(elapsed * 5, 0, 1);
      SMALL_CHECK.forEach(([x, y], index) => {
        if (index / SMALL_CHECK.length <= progress) dot(x * 2, 2 + y * 2, ink, 1, 2);
      });
      return elapsed < INK_TRANSITION;
    }
    if (status === "error") {
      for (const [x, y] of SMALL_ALERT) dot(6 + x * 2, y * 2, ink, 1, 1.64);
      return elapsed < INK_TRANSITION;
    }
    return false;
  });

  // a layout effect, so the start time is set before the next animation frame draws the new status
  React.useLayoutEffect(() => {
    statusSince.current = performance.now() / 1000;
    if (status === "error") shake(buttonRef.current);
    redraw();
  }, [status, redraw]);

  const label =
    status === "loading" ? loadingText : status === "success" ? successText : status === "error" ? errorText : children;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // a click while loading neither re-runs the task nor submits the form
    if (status === "loading") {
      event.preventDefault();
      return;
    }
    const result = onClick?.(event);
    if (isPromiseLike(result)) run(() => Promise.resolve(result)).catch(() => {});
  };

  return (
    <button
      ref={buttonRef}
      type={type}
      disabled={disabled}
      data-slot="px-button"
      data-variant={variant}
      data-state={status === "idle" ? undefined : status}
      aria-busy={status === "loading" || undefined}
      onClick={handleClick}
      className={cn(
        "inline-flex h-10 cursor-pointer items-center justify-center gap-0 rounded-[10px] border border-transparent bg-lumesec px-[18px] align-middle font-[inherit] text-[14px] font-semibold text-lumesec-foreground select-none",
        "[transition:transform_.15s_cubic-bezier(.2,.8,.2,1),filter_.2s,gap_.25s,background-color_.25s,color_.25s,border-color_.25s]",
        "hover:brightness-[1.06] active:[transform:scale(.96)]",
        "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "secondary" && "border-border bg-card text-foreground",
        variant === "danger" && "bg-destructive text-lumesec-foreground",
        // light text on the success green stays below 4.5:1, so the label turns a near-black shade of it
        status === "success" && "border-transparent bg-lumesec-success text-[color-mix(in_srgb,var(--lumesec-success)_15%,black)]",
        status === "error" && "border-transparent bg-destructive text-lumesec-foreground",
        status !== "idle" && "gap-2",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-[14px] w-0 overflow-hidden [transition:width_.25s_cubic-bezier(.2,.8,.2,1)]",
          status !== "idle" && "w-[14px]",
        )}
      >
        <canvas ref={canvasRef} className="block size-[14px] [image-rendering:pixelated]" />
      </span>
      <RollText text={label} direction={status === "idle" ? -1 : 1} aria-live="polite" className="justify-items-center" />
    </button>
  );
}

/** The button's current text colour, which the spinner draws in (it follows the colour transition). */
function textColor(element: Element | null): RGB {
  return element ? parseColor(getComputedStyle(element).color) : FALLBACK_INK;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
