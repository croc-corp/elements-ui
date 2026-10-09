"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-gantt.element";
import type * as ElementModule from "@/components/lumesec/hf-gantt.element";

/** The `<hf-gantt>` element, with its properties and methods. */
export type HfGanttElement = ElementModule.HGantt;

export interface HfGanttProps extends Omit<LumesecElementProps<HfGanttElement>, "label" | "onChange"> {
  /** Heading text. Observed. Default: `Q4 roadmap`. */
  label?: string;
  /** Fires when a drag that moved or resized a bar ends, and on each arrow-key move or resize. `task` is the task name; `start` and `end` are day offsets from 5 October 2026, from 0 to 41. */
  onChange?: (event: ElementModule.HGanttEventMap["change"]) => void;
}

/**
 * Roadmap · `<hf-gantt>` · LumeSec Elements, Pixel HD.
 * Roadmap Gantt chart with dithered progress bars, a pulsing milestone and a today line; bars drag or resize, snapping by day.
 *
 * Demo data: The six tasks, their dates and progress and the today line are invented; only `label` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/gantt
 */
export function HfGantt({ label, onChange, ...props }: HfGanttProps) {
  return useLumesecElement("hf-gantt", props, { label: label }, { change: onChange });
}
