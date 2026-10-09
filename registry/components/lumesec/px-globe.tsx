"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-globe.element";
import type * as ElementModule from "@/components/lumesec/px-globe.element";

/** The `<px-globe>` element, with its properties and methods. */
export type PxGlobeElement = ElementModule.Globe;

export type PxGlobeProps = LumesecElementProps<PxGlobeElement>;

/**
 * Request globe · `<px-globe>` · LumeSec Elements, Pixel Lab.
 * Dotted pixel globe with nine regions; requests arc between them as glowing packets, each arrival flashes its node. Drag to spin it.
 *
 * Demo data: The regions, the traffic between them, the latencies and the request counter are simulated; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/globe
 */
export function PxGlobe({ ...props }: PxGlobeProps) {
  return useLumesecElement(
    "px-globe",
    props,
    {},
    {},
  );
}
