import type { ElementMeta } from "@/lib/catalog";

/** One file of a manual install. */
export type RegistryFile = {
  /** Path in the consumer's project, before alias rewriting. */
  target: string;
  /** Path in this repository. */
  source: string;
  title: string;
  note: string;
};

/** The files a component needs, in install order (computed by scripts/catalog.mjs). */
export function registryFiles(e: Pick<ElementMeta, "files">): RegistryFile[] {
  return e.files;
}
