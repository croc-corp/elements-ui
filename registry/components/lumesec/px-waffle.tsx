"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-waffle.element";
import type * as ElementModule from "@/components/lumesec/px-waffle.element";

/** The `<px-waffle>` element, with its properties and methods. */
export type PxWaffleElement = ElementModule.Waffle;

export interface PxWaffleProps extends Omit<LumesecElementProps<PxWaffleElement>, "onChange" | "onCompact"> {
  /** Fires when cells are added. `used` is the number of filled cells, in thousands of tokens. */
  onChange?: (event: ElementModule.WaffleEventMap["change"]) => void;
  /** Fires after compacting, with the new number of filled cells. */
  onCompact?: (event: ElementModule.WaffleEventMap["compact"]) => void;
}

/**
 * Context waffle · `<px-waffle>` · LumeSec Elements, Pixel Lab.
 * Context window as a 200-cell waffle, one cell per thousand tokens; attached files fly in and compacting crumbles the conversation.
 *
 * Demo data: The starting context usage per source is invented; `add()` and `compact()` change it but it cannot be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/waffle
 */
export function PxWaffle({ onChange, onCompact, ...props }: PxWaffleProps) {
  return useLumesecElement("px-waffle", props, {}, { change: onChange, compact: onCompact });
}
