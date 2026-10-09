import { parse } from "node-html-parser";

import { Playground } from "@/components/preview/playground";
import { ReactPlayground } from "@/components/preview/react-playground";
import { getElement } from "@/lib/catalog";

/**
 * Docs playground for a tag. Native React components render with their base props; custom elements are
 * seeded with the first instance in their lab demo.
 */
export function PlaygroundBlock({ tag }: { tag: string }) {
  const e = getElement(tag);
  if (!e?.controls?.length) return null;
  const layout = e.layout === "wide" ? "fill" : e.layout;
  if (e.kind === "react") {
    return (
      <div className="my-6">
        <ReactPlayground
          tag={tag}
          component={e.component}
          controls={e.controls}
          baseProps={e.playgroundProps}
          layout={layout}
        />
      </div>
    );
  }
  const node = parse(e.stage).querySelector(tag);
  const initial = node ? { ...node.attributes } : {};
  delete initial.id;
  const inner = node?.innerHTML.trim() ?? "";
  return (
    <div className="my-6">
      <Playground
        tag={tag}
        component={e.component}
        controls={e.controls}
        observed={e.observed ?? []}
        initial={initial}
        inner={inner}
        layout={layout}
      />
    </div>
  );
}
