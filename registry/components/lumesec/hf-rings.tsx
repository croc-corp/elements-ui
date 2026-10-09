"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-rings.element";
import type * as ElementModule from "@/components/lumesec/hf-rings.element";

/** The `<hf-rings>` element, with its properties and methods. */
export type HfRingsElement = ElementModule.HRings;

export interface HfRingsProps extends Omit<LumesecElementProps<HfRingsElement>, "rings"> {
  /** Comma-separated `Name:current/goal` entries; only the first three are used. Empty entries are skipped, a missing or negative amount counts as 0 and a missing goal as 1. Observed: changes rebuild the legend and animate the rings. Default: `Messages:36/50,Tokens:410/900,Agents:13/10`. */
  rings?: string;
}

/**
 * Goal rings · `<hf-rings>` · LumeSec Elements, Pixel HD.
 * Up to three concentric goal rings with glowing heads; progress past the goal laps the ring in a brighter tint and throws sparks.
 *
 * Data: Pass up to three `Name:current/goal` rings as `rings`. Without it the rings show invented usage figures.
 * @see https://elements.lumesec.ai/components/pixel-hd/rings
 */
export function HfRings({ rings, ...props }: HfRingsProps) {
  return useLumesecElement(
    "hf-rings",
    props,
    { "rings": rings },
    {},
  );
}
