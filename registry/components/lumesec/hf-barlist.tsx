"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-barlist.element";
import type * as ElementModule from "@/components/lumesec/hf-barlist.element";

/** The `<hf-barlist>` element, with its properties and methods. */
export type HfBarlistElement = ElementModule.HBarlist;

export interface HfBarlistProps extends Omit<LumesecElementProps<HfBarlistElement>, "data" | "label" | "unit"> {
  /** Comma-separated `label:value` rows, split at the last colon; an entry without a colon has the value 0. Rows are sorted by value, highest first. Observed: a new value rebuilds the rows. Default: `src/auth/session.ts:184,src/api/client.ts:121,src/ui/composer.tsx:96,tests/auth.spec.ts:58,README.md:21`. */
  data?: string;
  /** Header text on the left; also labels the list. Observed. Default: `Most edited files`. */
  label?: string;
  /** Header text on the right, above the values. Observed. Default: `Edits`. */
  unit?: string;
}

/**
 * Bar list · `<hf-barlist>` · LumeSec Elements, Pixel HD.
 * Ranked bar list with dithered bars behind the labels that grow in one after another; hover or focus runs a sheen along a bar.
 *
 * Data: Pass your `label:value` rows as `data`; the read-only `items` property returns them parsed. Without it the list shows demo file names with invented edit counts.
 * @see https://elements.lumesec.ai/components/pixel-hd/barlist
 */
export function HfBarlist({ data, label, unit, ...props }: HfBarlistProps) {
  return useLumesecElement("hf-barlist", props, { data: data, label: label, unit: unit }, {});
}
