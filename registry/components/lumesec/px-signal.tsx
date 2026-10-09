"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-signal.element";
import type * as ElementModule from "@/components/lumesec/px-signal.element";

/** The `<px-signal>` element, with its properties and methods. */
export type PxSignalElement = ElementModule.Signal;

export interface PxSignalProps extends Omit<LumesecElementProps<PxSignalElement>, "onOutage"> {
  /** Fires when the "Simulate outage" button is pressed. */
  onOutage?: (event: ElementModule.SignalEventMap["outage"]) => void;
}

/**
 * Latency scope · `<px-signal>` · LumeSec Elements, Pixel Lab.
 * Scrolling pixel oscilloscope for latency with dithered tails, amber and red spikes over a 400 ms line, and a rolling p50/p95 readout.
 *
 * Demo data: The latency samples, spikes and p50/p95 readout are simulated; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/signal
 */
export function PxSignal({ onOutage, ...props }: PxSignalProps) {
  return useLumesecElement("px-signal", props, {}, { outage: onOutage });
}
