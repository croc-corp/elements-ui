"use client";

import * as React from "react";

import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { BurstLayer, useBurst } from "@/lib/lumesec/sparks";
import { cn } from "@/lib/utils";

/** Feedback state: `done` after a successful copy, `fail` when the browser refused, for 1.8 s. */
export type CopyButtonState = "idle" | "done" | "fail";

export interface UiCopyButtonProps extends Omit<React.ComponentProps<"button">, "onCopy" | "children"> {
  /** Text written to the clipboard. Read on each click. */
  text?: string;
  /** Idle label. */
  label?: string;
  /** Label shown for 1.8 s after a successful copy. */
  doneLabel?: string;
  /** Called after each copy attempt; `ok` is false when the clipboard write was rejected. */
  onCopy?: (ok: boolean, text: string) => void;
}

const FAIL_LABEL = "Couldn’t copy";
const RESET_MS = 1800;

/**
 * Copy-to-clipboard button whose icon turns into a drawn check as the label rolls to "Copied"; it says
 * so when the browser refuses. The label is a polite live region.
 *
 * @example
 * <UiCopyButton text="npx shadcn@latest add @lumesec/ui-copy-button" />
 */
export function UiCopyButton({
  text = "",
  label = "Copy",
  doneLabel = "Copied",
  onCopy,
  className,
  onClick,
  ...props
}: UiCopyButtonProps) {
  const [state, setState] = React.useState<CopyButtonState>("idle");
  const iconRef = React.useRef<HTMLSpanElement>(null);
  const checkRef = React.useRef<SVGSVGElement>(null);
  const { ref: sparksRef, fire: fireSparks } = useBurst();
  const resetTimer = React.useRef(0);
  // the clipboard write is async: a button removed meanwhile only reports the result
  const mounted = React.useRef(false);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(resetTimer.current);
    };
  }, []);

  const copy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    onCopy?.(ok, text);
    if (!mounted.current) return;
    setState(ok ? "done" : "fail");
    if (ok && !prefersReducedMotion()) {
      checkRef.current?.animate(
        [{ transform: "scale(.6)" }, { transform: "scale(1.3)", offset: 0.5 }, { transform: "scale(1)" }],
        {
          duration: 440,
          easing: "cubic-bezier(.2,.8,.2,1)",
        },
      );
      if (iconRef.current) {
        fireSparks(iconRef.current, {
          count: 16,
          colors: ["--lumesec-success", "--lumesec", "--lumesec-glint"],
          speed: [40, 150],
          life: [0.3, 0.65],
        });
      }
    }
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setState("idle"), RESET_MS);
  };

  const shown = state === "done" ? doneLabel : state === "fail" ? FAIL_LABEL : label;

  return (
    <button
      type="button"
      data-slot="ui-copy-button"
      data-state={state}
      className={cn(
        "group relative inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-[9px] border border-border bg-card pr-3.5 pl-[11px] font-[inherit] text-[13.5px] leading-normal font-medium text-foreground outline-none select-none",
        "[transition:transform_.15s_cubic-bezier(.2,.8,.2,1),border-color_.3s,background-color_.2s,color_.3s] hover:bg-muted active:[transform:scale(.95)] disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid",
        "data-[state=done]:border-[color-mix(in_srgb,var(--lumesec-success)_50%,var(--border))]",
        "data-[state=fail]:border-[color-mix(in_srgb,var(--destructive)_50%,var(--border))] data-[state=fail]:text-destructive",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void copy();
      }}
      {...props}
    >
      <span ref={iconRef} className="relative grid size-4">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="col-start-1 row-start-1 size-4 fill-none stroke-current [stroke-width:1.6] [stroke-linecap:round] [stroke-linejoin:round] [transition:opacity_.18s_ease,transform_.35s_cubic-bezier(.2,.8,.2,1)] group-data-[state=done]:[transform:scale(.4)_rotate(-25deg)] group-data-[state=done]:opacity-0"
        >
          <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.8" />
          <path d="M10.8 5.2V4.1c0-1-.8-1.6-1.6-1.6H4.1c-.9 0-1.6.7-1.6 1.6v5.1c0 .9.7 1.6 1.6 1.6h1.1" />
        </svg>
        <svg
          ref={checkRef}
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="col-start-1 row-start-1 size-4 fill-none stroke-current [stroke-width:2] text-lumesec-success opacity-0 [stroke-linecap:round] [stroke-linejoin:round] [transition:opacity_.15s] group-data-[state=done]:opacity-100"
        >
          <path
            d="M3.3 8.6l3 3 6.4-7"
            className="[stroke-dasharray:14] [stroke-dashoffset:14] [transition:stroke-dashoffset_.35s_cubic-bezier(.3,.7,.3,1)_.1s] group-data-[state=done]:[stroke-dashoffset:0]"
          />
        </svg>
      </span>
      <RollText
        text={shown}
        direction={state === "idle" ? -1 : 1}
        reserve={[label, doneLabel, FAIL_LABEL]}
        aria-live="polite"
      />
      <BurstLayer ref={sparksRef} />
    </button>
  );
}
