"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-minimap.element";
import type * as ElementModule from "@/components/lumesec/px-minimap.element";

/** The `<px-minimap>` element, with its properties and methods. */
export type PxMinimapElement = ElementModule.Minimap;

export type PxMinimapProps = LumesecElementProps<PxMinimapElement>;

/**
 * Code minimap · `<px-minimap>` · LumeSec Elements, Pixel Lab.
 * Syntax-coloured pixel minimap beside a code view with the visible window outlined; search hits pulse in the margin and dragging scrolls.
 *
 * Demo data: The code is generated sample JavaScript; only the search query can be set with `find()`. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/minimap
 */
export function PxMinimap({ ...props }: PxMinimapProps) {
  return useLumesecElement("px-minimap", props, {}, {});
}
