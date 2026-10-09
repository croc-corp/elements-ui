"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-ticker.element";
import type * as ElementModule from "@/components/lumesec/px-ticker.element";

/** The `<px-ticker>` element, with its properties and methods. */
export type PxTickerElement = ElementModule.Ticker;

export type PxTickerProps = LumesecElementProps<PxTickerElement>;

/**
 * LED ticker · `<px-ticker>` · LumeSec Elements, Pixel Lab.
 * LED marquee with glowing text over a grid of unlit dots, coloured up and down arrows and soft edges; hovering eases it to a stop.
 *
 * Demo data: The ticker items (model, latency, errors, agents, uptime) are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/ticker
 */
export function PxTicker({ ...props }: PxTickerProps) {
  return useLumesecElement(
    "px-ticker",
    props,
    {},
    {},
  );
}
