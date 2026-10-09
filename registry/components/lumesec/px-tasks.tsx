"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-tasks.element";
import type * as ElementModule from "@/components/lumesec/px-tasks.element";

/** The `<px-tasks>` element, with its properties and methods. */
export type PxTasksElement = ElementModule.Tasks;

export interface PxTasksProps extends Omit<LumesecElementProps<PxTasksElement>, "items" | "onChange"> {
  /** Task labels separated by `|`; empty entries are skipped. Changing it rebuilds the list with every task unchecked. Default: `Draft the launch post|Record the demo video|Review the pricing page|Ship v2.14 to production`. */
  items?: string;
  /** Fires each time a task is checked or unchecked. */
  onChange?: (event: ElementModule.TasksEventMap["change"]) => void;
}

/**
 * Pixel checklist · `<px-tasks>` · LumeSec Elements, Pixel Lab.
 * Pixel checklist where checking fills the box from the centre and draws a fizzing strike-through; finishing the list runs a green wave.
 *
 * Data: Pass your tasks in `items`. Without it the list shows demo tasks.
 * @see https://elements.lumesec.ai/components/pixel-lab/tasks
 */
export function PxTasks({ items, onChange, ...props }: PxTasksProps) {
  return useLumesecElement("px-tasks", props, { items: items }, { change: onChange });
}
