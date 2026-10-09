"use client";

import * as React from "react";

import { clamp, lerp, mixRgb, rand } from "@/lib/lumesec/math";
import { prefersReducedMotion, shake } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { SMALL_ALERT, SMALL_CHECK } from "@/lib/lumesec/pixel-font";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Result of the last blur validation: not validated (or empty and optional), valid, or invalid. */
export type PxInputValidation = "idle" | "ok" | "error";

/** Imperative handle of `PxInput`. */
export interface PxInputHandle {
  /** Move focus into the text field. */
  focus(): void;
}

/** Props of `PxInput`. Other `div` props go to the wrapper; the input's own attributes are the props below. */
export interface PxInputProps extends Omit<
  React.ComponentProps<"div">,
  "ref" | "children" | "defaultValue" | "onChange" | "inputMode" | "spellCheck"
> {
  /** Controlled text. Use with `onValueChange`. */
  value?: string;
  /** Initial text when uncontrolled; also restored on form reset. */
  defaultValue?: string;
  /** Called with the new text on every edit. */
  onValueChange?: (value: string) => void;
  /** Called when the input commits a change: on blur after editing, like the native `change` event. */
  onValueCommit?: (value: string) => void;
  /** Label text, linked to the input. No label is rendered when empty. */
  label?: React.ReactNode;
  /** Help text under the field, shown when there is no error. */
  hint?: string;
  /** Message shown, and used as the validation message, when the value is invalid. Defaults to the browser's message. */
  error?: string;
  /** Message shown when a valid value is confirmed on blur. Falls back to `hint`. */
  success?: string;
  /** Form field name. */
  name?: string;
  /** Input type, for example `email`, `url` or `tel`. */
  type?: React.HTMLInputTypeAttribute;
  /** Placeholder text. */
  placeholder?: string;
  /** An empty field is invalid. */
  required?: boolean;
  /** Pattern the value must match; checked during validation. */
  pattern?: string;
  /** Minimum length; checked during validation. */
  minLength?: number;
  /** Maximum length. */
  maxLength?: number;
  /** Autofill hint for the input. */
  autoComplete?: React.InputHTMLAttributes<HTMLInputElement>["autoComplete"];
  /** Virtual keyboard hint for the input. */
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>["inputMode"];
  /** Spell checking of the input. */
  spellCheck?: boolean;
  /** Dims the field and disables the input, so it cannot be edited, reached with Tab or submitted. */
  disabled?: boolean;
  /** Imperative handle with `focus()`. */
  ref?: React.Ref<PxInputHandle>;
}

/**
 * Labelled text field whose pixel underline lights from the caret outwards. Validation runs on blur: an
 * invalid value shakes the field and shows a `!`, a valid one draws a check. Once an error shows, the
 * field re-validates on every keystroke. The native input takes part in forms and constraint validation.
 *
 * @example
 * <PxInput
 *   name="email"
 *   label="Work email"
 *   type="email"
 *   required
 *   placeholder="you@example.com"
 *   hint="We’ll send the invite here"
 *   error="Enter a valid email address"
 * />
 */
export function PxInput({
  value: valueProp,
  defaultValue = "",
  onValueChange,
  onValueCommit,
  label,
  hint,
  error,
  success,
  name,
  type = "text",
  placeholder,
  required,
  pattern,
  minLength,
  maxLength,
  autoComplete,
  inputMode,
  spellCheck,
  disabled = false,
  className,
  ref,
  ...props
}: PxInputProps) {
  const inputId = React.useId();
  const messageId = `${inputId}-message`;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const [validation, setValidation] = React.useState<PxInputValidation>("idle");
  /** The browser's own message from the last validation, shown when there is no `error` text. */
  const [browserMessage, setBrowserMessage] = React.useState("");

  // animation state: how far the underline is lit, where the caret was, and the error jitter
  const spread = React.useRef(0);
  const caret = React.useRef(0.5);
  const jitter = React.useRef(0);

  const onCommitRef = React.useRef(onValueCommit);
  const errorRef = React.useRef(error);
  React.useEffect(() => {
    onCommitRef.current = onValueCommit;
    errorRef.current = error;
  });

  const { ref: canvasRef, redraw } = usePixelCanvas(({ clear, dot, palette, width, height, delta }) => {
    const reduced = prefersReducedMotion();
    const focused = document.activeElement === inputRef.current;
    const target = focused || validation !== "idle" ? 1 : 0;
    spread.current = reduced ? target : spread.current + clamp(target - spread.current, -delta * 3, delta * 4);
    jitter.current = Math.max(0, jitter.current - delta * 2.5);
    const color = validation === "error" ? palette.destructive : validation === "ok" ? palette.success : palette.accent;
    clear();
    const y = height - 4;
    const x0 = 10;
    const x1 = width - 10;
    const caretX = lerp(x0, x1, caret.current);
    for (let x = x0; x < x1; x += 3) {
      const distance = Math.abs(x - caretX) / (x1 - x0);
      const lit = distance < spread.current * 1.05;
      const edge = lit && distance > spread.current - 0.08;
      const offset = jitter.current && !reduced ? rand(-1.5, 1.5) * jitter.current : 0;
      const tone = lit ? mixRgb(color, palette.shine, edge && spread.current < 1 ? 0.6 : 0) : palette.foreground;
      dot(x, y + offset, tone, lit ? 0.95 : 0.1, 2);
    }
    if (validation === "ok") {
      for (const [px, py] of SMALL_CHECK)
        dot(width - 26 + px * 2, height / 2 - 5 + py * 2, palette.success, Math.min(1, spread.current), 2);
    }
    if (validation === "error") {
      for (const [px, py] of SMALL_ALERT)
        dot(width - 20 + px * 1.8, height / 2 - 6 + py * 1.8, palette.destructive, 1, 1.5);
    }
    return Math.abs(spread.current - target) > 0.001 || jitter.current > 0;
  });

  /** Mirror the input's constraints with the `error` text as the message the browser shows on submit. */
  const syncValidity = React.useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setCustomValidity("");
    if (!input.validity.valid && errorRef.current) input.setCustomValidity(errorRef.current);
  }, []);

  /** Show the result of validating the current text. Returns whether it is valid. */
  const validate = (announce: boolean) => {
    const input = inputRef.current;
    if (!input) return true;
    syncValidity();
    const next: PxInputValidation = !input.value && !input.required ? "idle" : input.validity.valid ? "ok" : "error";
    if (next === "error" && validation !== "error" && announce) {
      shake(fieldRef.current);
      jitter.current = 1;
    }
    setValidation(next);
    setBrowserMessage(input.validationMessage);
    redraw();
    return next !== "error";
  };

  // re-sync whenever the value or a constraint changes
  React.useEffect(syncValidity, [value, error, required, pattern, minLength, maxLength, type, syncValidity]);
  React.useEffect(redraw, [validation, redraw]);

  // the native change event (commit on blur) has no React equivalent
  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => onCommitRef.current?.(input.value);
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, []);

  useFormReset(inputRef, () => {
    setValue(defaultValue);
    setValidation("idle");
    redraw();
  });

  React.useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  /** Caret position as a share of the field width, so the underline lights from there. */
  const caretFraction = () => {
    const input = inputRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!input || !canvas || !context || !canvas.clientWidth) return 0.5;
    context.font = `14px ${getComputedStyle(input).fontFamily}`;
    const textWidth = context.measureText(input.value.slice(0, input.selectionStart ?? input.value.length)).width;
    return clamp((12 + textWidth) / canvas.clientWidth, 0, 1);
  };

  const message =
    validation === "error" ? error || browserMessage : validation === "ok" ? success || hint || "" : hint || "";

  return (
    <div
      data-slot="px-input"
      data-state={validation === "idle" ? undefined : validation}
      data-disabled={disabled ? "" : undefined}
      className={cn("block leading-[1.5] text-foreground", disabled && "pointer-events-none opacity-55", className)}
      {...props}
    >
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-[12.5px] font-medium">
          {label}
        </label>
      ) : null}
      <div
        ref={fieldRef}
        className={cn(
          "relative flex h-[42px] items-center gap-2 rounded-[10px] border bg-card px-3 transition-[border-color,box-shadow] duration-200 ease-[ease]",
          validation === "error"
            ? "border-[color-mix(in_srgb,var(--destructive)_65%,var(--border))] ring-[3px] ring-destructive/12"
            : "border-border focus-within:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] focus-within:ring-[3px] focus-within:ring-lumesec/14",
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type={type}
          placeholder={placeholder}
          required={required}
          pattern={pattern}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          inputMode={inputMode}
          spellCheck={spellCheck}
          disabled={disabled}
          value={value}
          aria-invalid={validation === "error" || undefined}
          aria-describedby={message ? messageId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            if (validation === "error") validate(false);
            else syncValidity();
            redraw();
          }}
          onFocus={() => {
            caret.current = caretFraction();
            redraw();
          }}
          onBlur={() => validate(true)}
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 pr-[18px] font-[inherit] text-[14px] text-inherit outline-none placeholder:text-muted-foreground placeholder:opacity-75"
        />
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 block size-full rounded-[10px] [image-rendering:pixelated]"
        />
      </div>
      <span
        id={messageId}
        className={cn(
          "mt-1.5 block min-h-[1.45em] text-[12px] text-muted-foreground",
          validation === "error" && "text-destructive",
          validation === "ok" && "text-lumesec-success",
        )}
      >
        {/* long messages (the browser's own validation text) wrap instead of running past the field */}
        <RollText
          text={message}
          direction={validation === "error" ? 1 : -1}
          aria-live="polite"
          className="max-w-full [&>span]:whitespace-normal"
        />
      </span>
    </div>
  );
}
