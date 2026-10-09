"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-radar.element";
import type * as ElementModule from "@/components/lumesec/px-radar.element";

/** The `<px-radar>` element, with its properties and methods. */
export type PxRadarElement = ElementModule.Radar;

export interface PxRadarProps extends Omit<LumesecElementProps<PxRadarElement>, "onPing"> {
  /** Fires when the Ping button is pressed. */
  onPing?: (event: ElementModule.RadarEventMap["ping"]) => void;
}

/**
 * Service radar · `<px-radar>` · LumeSec Elements, Pixel Lab.
 * Sweeping pixel radar where each service node lights up as the beam passes; Ping sends out a ring that flashes every node it touches.
 *
 * Demo data: The six service nodes and their latencies are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/radar
 */
export function PxRadar({ onPing, ...props }: PxRadarProps) {
  return useLumesecElement("px-radar", props, {}, { ping: onPing });
}
