"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-storage.element";
import type * as ElementModule from "@/components/lumesec/px-storage.element";

/** The `<px-storage>` element, with its properties and methods. */
export type PxStorageElement = ElementModule.Storage;

export interface PxStorageProps extends Omit<LumesecElementProps<PxStorageElement>, "onSelect"> {
  /** Fires when a segment is pinned or unpinned. `segment` is the category name, or `null` when the pin is cleared. */
  onSelect?: (event: ElementModule.StorageEventMap["select"]) => void;
}

/**
 * Storage ring · `<px-storage>` · LumeSec Elements, Pixel Lab.
 * Pixel donut chart of storage use that sweeps in clockwise; pointing at a segment pushes its pixels outward and click pins it.
 *
 * Demo data: The storage categories and their sizes are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/storage
 */
export function PxStorage({ onSelect, ...props }: PxStorageProps) {
  return useLumesecElement(
    "px-storage",
    props,
    {},
    { "select": onSelect },
  );
}
