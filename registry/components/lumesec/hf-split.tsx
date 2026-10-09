"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-split.element";
import type * as ElementModule from "@/components/lumesec/hf-split.element";

/** The `<hf-split>` element, with its properties and methods. */
export type HfSplitElement = ElementModule.HSplit;

export interface HfSplitProps extends Omit<LumesecElementProps<HfSplitElement>, "items" | "menuLabel" | "onAction" | "onSelect"> {
  /** Menu entries separated by `;`, each `Label|Description` with an optional description; entries without a label are skipped. The first entry starts selected. Observed: a change rebuilds the menu and keeps the selection when its label is still there. Default: `Deploy to production|Ships to everyone after checks;Deploy to staging|Internal testers only;Create preview|A unique URL for this branch;Schedule deploy…|Pick a time tonight`. */
  items?: string;
  /** Accessible name of the caret button that opens the menu. Observed. Default: `More options`. */
  menuLabel?: string;
  /** Fires when the main button is clicked. `value` is the selected item's label. */
  onAction?: (event: ElementModule.HSplitEventMap["action"]) => void;
  /** Fires when an item is chosen from the menu. `value` is its label. */
  onSelect?: (event: ElementModule.HSplitEventMap["select"]) => void;
}

/**
 * Split button · `<hf-split>` · LumeSec Elements, Pixel HD.
 * Split button with a primary action and a menu of alternatives; choosing an item rolls its label into the main button.
 * @see https://elements.lumesec.ai/components/pixel-hd/split
 */
export function HfSplit({ items, menuLabel, onAction, onSelect, ...props }: HfSplitProps) {
  return useLumesecElement(
    "hf-split",
    props,
    { "items": items, "menu-label": menuLabel },
    { "action": onAction, "select": onSelect },
  );
}
