"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-context.element";
import type * as ElementModule from "@/components/lumesec/hf-context.element";

/** The `<hf-context>` element, with its properties and methods. */
export type HfContextElement = ElementModule.HContext;

export interface HfContextProps extends Omit<LumesecElementProps<HfContextElement>, "onChange" | "onCompact"> {
  /** Fires after `addTo()` or a built-in add button grows the context. `used` is in thousands of tokens. */
  onChange?: (event: ElementModule.HContextEventMap["change"]) => void;
  /** Fires after compaction with the new total, in thousands of tokens. */
  onCompact?: (event: ElementModule.HContextEventMap["compact"]) => void;
}

/**
 * Context window · `<hf-context>` · LumeSec Elements, Pixel HD.
 * Context-window meter with four dithered segments, warnings at 80% and 95% and a compaction sweep; runs on built-in demo data.
 *
 * Demo data: The 200k window and its four segment sizes are invented; only `addTo()` and `compact()` change them. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/context
 */
export function HfContext({ onChange, onCompact, ...props }: HfContextProps) {
  return useLumesecElement("hf-context", props, {}, { change: onChange, compact: onCompact });
}
