"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-react.element";
import type * as ElementModule from "@/components/lumesec/px-react.element";

/** The `<px-react>` element, with its properties and methods. */
export type PxReactElement = ElementModule.Reactions;

export interface PxReactProps extends Omit<LumesecElementProps<PxReactElement>, "count" | "onReact"> {
  /** Reaction count, rounded to a whole number of at least 0. Changing it updates the count; liking adds one to it. Default: `128`. */
  count?: number;
  /** Fires on like, unlike and when a reaction is picked. `reaction` is `Love`, `Star`, `Zap`, `Fire` or `Spark`. */
  onReact?: (event: ElementModule.ReactionsEventMap["react"]) => void;
}

/**
 * Pixel reactions · `<px-react>` · LumeSec Elements, Pixel Lab.
 * Pixel like button whose heart explodes and snaps back filled; press and hold opens four more reactions that the same pixels fly into.
 *
 * Data: Pass the starting reaction count as `count`. Without it the count starts at 128.
 * @see https://elements.lumesec.ai/components/pixel-lab/react
 */
export function PxReact({ count, onReact, ...props }: PxReactProps) {
  return useLumesecElement("px-react", props, { count: count }, { react: onReact });
}
