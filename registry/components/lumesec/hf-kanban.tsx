"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-kanban.element";
import type * as ElementModule from "@/components/lumesec/hf-kanban.element";

/** The `<hf-kanban>` element, with its properties and methods. */
export type HfKanbanElement = ElementModule.HKanban;

export interface HfKanbanProps extends Omit<LumesecElementProps<HfKanbanElement>, "onMove"> {
  /** Fires after a card is dropped or moved by keyboard, including reorders within one column. `card` is the card title; `from` and `to` are column names. */
  onMove?: (event: ElementModule.HKanbanEventMap["move"]) => void;
}

/**
 * Kanban board · `<hf-kanban>` · LumeSec Elements, Pixel HD.
 * Three-column kanban board: a dragged card leaves a dot trail, the target column lights up and a bar marks where it will land.
 *
 * Demo data: The three columns and six cards are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/kanban
 */
export function HfKanban({ onMove, ...props }: HfKanbanProps) {
  return useLumesecElement("hf-kanban", props, {}, { move: onMove });
}
