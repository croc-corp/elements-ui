"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-button.element";
import type * as ElementModule from "@/components/lumesec/hf-button.element";

/** The `<hf-button>` element, with its properties and methods. */
export type HfButtonElement = ElementModule.HButton;

export interface HfButtonProps extends Omit<
  LumesecElementProps<HfButtonElement>,
  | "variant"
  | "loadingText"
  | "successText"
  | "errorText"
  | "type"
  | "demo"
  | "disabled"
  | "onStart"
  | "onSuccess"
  | "onError"
> {
  /** Set to `danger` for the red colour scheme. Without it the accent colour is used. Read directly by CSS and the canvas, so changes apply on the next frame. */
  variant?: string;
  /** Label shown while the promise passed to `run()` is pending. Default: `Working…`. */
  loadingText?: string;
  /** Label shown for 1.7 s after the promise resolves. Default: `Done`. */
  successText?: string;
  /** Label shown for 1.7 s after the promise rejects. Default: `Try again`. */
  errorText?: string;
  /** Set to `submit` to call `requestSubmit()` on the owning form when clicked. Ignored when `demo` is set. */
  type?: string;
  /** Makes a click run a simulated 1.5 s task. `error` makes it fail; any other non-empty value makes it succeed. */
  demo?: string;
  /** Presence attribute. Disables the inner button; a disabled ancestor `<fieldset>` does the same. Default: `false`. */
  disabled?: boolean;
  /** Fires when `run()` enters the loading state. */
  onStart?: (event: ElementModule.HButtonEventMap["start"]) => void;
  /** Fires when the promise passed to `run()` resolves. */
  onSuccess?: (event: ElementModule.HButtonEventMap["success"]) => void;
  /** Fires when the promise passed to `run()` rejects. */
  onError?: (event: ElementModule.HButtonEventMap["error"]) => void;
}

/**
 * Button · `<hf-button>` · LumeSec Elements, Pixel HD.
 * Dot-matrix button with a pointer light and press ripples; `run(fn)` shows loading, success and error states around a promise.
 * @see https://elements.lumesec.ai/components/pixel-hd/button
 */
export function HfButton({
  variant,
  loadingText,
  successText,
  errorText,
  type,
  demo,
  disabled,
  onStart,
  onSuccess,
  onError,
  ...props
}: HfButtonProps) {
  return useLumesecElement(
    "hf-button",
    props,
    {
      variant: variant,
      "loading-text": loadingText,
      "success-text": successText,
      "error-text": errorText,
      type: type,
      demo: demo,
      disabled: disabled,
    },
    { start: onStart, success: onSuccess, error: onError },
  );
}
