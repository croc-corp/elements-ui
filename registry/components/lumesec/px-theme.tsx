"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-theme.element";
import type * as ElementModule from "@/components/lumesec/px-theme.element";

/** The `<px-theme>` element, with its properties and methods. */
export type PxThemeElement = ElementModule.Theme;

export interface PxThemeProps extends Omit<LumesecElementProps<PxThemeElement>, "controlsPage" | "onChange"> {
  /** Presence attribute. When set, each toggle writes `data-theme="dark"` or `"light"` and toggles the `.dark` class on the `<html>` element, the switch follows theme changes made elsewhere on the page, and a hint under the switch says so. Default: `false`. */
  controlsPage?: boolean;
  /** Fires on every toggle with the new state; not when the switch follows a page theme change. */
  onChange?: (event: ElementModule.ThemeEventMap["change"]) => void;
}

/**
 * Day / night switch · `<px-theme>` · LumeSec Elements, Pixel Lab.
 * Day/night switch whose sun pixels rebuild as a crescent moon while night sweeps the sky; it can set the page theme.
 * @see https://elements.lumesec.ai/components/pixel-lab/theme
 */
export function PxTheme({ controlsPage, onChange, ...props }: PxThemeProps) {
  return useLumesecElement("px-theme", props, { "controls-page": controlsPage }, { change: onChange });
}
