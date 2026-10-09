"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-error.element";
import type * as ElementModule from "@/components/lumesec/hf-error.element";

/** The `<hf-error>` element, with its properties and methods. */
export type HfErrorElement = ElementModule.HError;

export interface HfErrorProps extends Omit<LumesecElementProps<HfErrorElement>, "code" | "onRetry" | "onHome"> {
  /** Error code to show. `404`, `500` and `offline` (any case) have built-in titles and messages; any other value shows `Something went wrong`. Observed: a change updates the text and replays the assembly. Default: `404`. */
  code?: string;
  /** Fires when Try again is pressed. */
  onRetry?: (event: ElementModule.HErrorEventMap["retry"]) => void;
  /** Fires when Go home is pressed. */
  onHome?: (event: ElementModule.HErrorEventMap["home"]) => void;
}

/**
 * Error state · `<hf-error>` · LumeSec Elements, Pixel HD.
 * Error state with the code in large mono type over a dotted scanline halo that glitches now and then; Try again reassembles it.
 * @see https://elements.lumesec.ai/components/pixel-hd/error
 */
export function HfError({ code, onRetry, onHome, ...props }: HfErrorProps) {
  return useLumesecElement("hf-error", props, { code: code }, { retry: onRetry, home: onHome });
}
