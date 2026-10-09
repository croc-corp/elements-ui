import { ComponentCard } from "@/components/preview/component-card";
import { elementHref, getElement, related } from "@/lib/catalog";

/** Up to four live cards from the same group, then the same collection. */
export function RelatedComponents({ tag }: { tag: string }) {
  const e = getElement(tag);
  if (!e) return null;
  const list = related(e, 4);
  return (
    <section className="not-prose mt-16">
      <h2 id="related" className="text-[20px] font-medium tracking-tight">
        Related
      </h2>
      <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
        {list.map((r, i) => (
          <ComponentCard
            key={r.tag}
            index={i}
            height={200}
            data={{ tag: r.tag, title: r.title, collection: r.collection, href: elementHref(r), stage: r.stage, stageClass: r.stageClass, layout: r.layout, demo: r.data === "demo" }}
          />
        ))}
      </div>
    </section>
  );
}
