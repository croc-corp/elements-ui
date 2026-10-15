"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-tree.element";
import type * as ElementModule from "@/components/lumesec/hf-tree.element";

/** The `<hf-tree>` element, with its properties and methods. */
export type HfTreeElement = ElementModule.HTree;

export interface HfTreeProps extends Omit<LumesecElementProps<HfTreeElement>, "paths" | "labels" | "onSelect"> {
  /** Comma-separated file paths, each optionally followed by `:M` (modified), `:A` (added) or `:D` (deleted); other status letters are ignored. Folders come from the `/` segments. Observed: a change rebuilds the tree and keeps expanded folders and the selection where they still exist. Default: `src/auth/session.ts:M,src/auth/token.ts:A,src/auth/legacy.ts:D,src/api/client.ts:M,src/api/routes.ts,src/ui/composer.tsx:M,src/ui/theme.ts,tests/auth.spec.ts:A,docs/README.md:M,package.json:M,tsconfig.json`. */
  paths?: string;
  /** The visible copy, for translation, with the keys `heading`, `headingOne`, `changedOnly`, `modified`, `added` and `deleted`. `heading` and `headingOne` may contain `{count}`, the number of changed files; `headingOne` is used when it is 1. Missing keys and invalid JSON use the English defaults. Observed: a change rebuilds the tree. */
  labels?: Partial<ElementModule.HTreeLabels>;
  /** Fires when the user selects a row by click or keyboard, including each arrow-key move. `file` is `false` for folders. */
  onSelect?: (event: ElementModule.HTreeEventMap["select"]) => void;
}

/**
 * Changed files · `<hf-tree>` · LumeSec Elements, Pixel HD.
 * Changed-files tree built from a path list with M, A and D markers; folders count their changes and arrow keys follow the tree pattern.
 *
 * Data: Pass your changed files as `paths` (`path:M`, `:A` or `:D`). Without it a demo path list is shown.
 * @see https://elements.lumesec.ai/components/pixel-hd/tree
 */
export function HfTree({ paths, labels, onSelect, ...props }: HfTreeProps) {
  return useLumesecElement("hf-tree", props, { paths: paths, labels: labels }, { select: onSelect });
}
