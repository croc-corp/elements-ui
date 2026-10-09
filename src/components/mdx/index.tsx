import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type * as React from "react";

import { CodeBlock } from "@/components/code/code-block";
import { CodeTabs } from "@/components/code/code-tabs";
import { InstallBlock } from "@/components/code/install-block";
import { ApiTable } from "@/components/mdx/api-table";
import { MdxPre } from "@/components/mdx/mdx-pre";
import { PlaygroundBlock } from "@/components/mdx/playground-block";
import { RelatedComponents } from "@/components/mdx/related";
import { ComponentPreview } from "@/components/preview/component-preview";
import { collections, elementHref, elements, getElement } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/** h2 to h4 with an anchor link to themselves. */
function Heading({ as: Tag, id, children, ...props }: { as: "h2" | "h3" | "h4"; id?: string; children?: React.ReactNode }) {
  return (
    <Tag id={id} className="group/h relative" {...props}>
      {id ? (
        <a href={`#${id}`} data-plain className="no-underline">
          {children}
          <span aria-hidden className="ml-2 font-mono text-[0.75em] text-muted-foreground opacity-0 transition-opacity group-hover/h:opacity-100">
            #
          </span>
        </a>
      ) : (
        children
      )}
    </Tag>
  );
}

/** Site links use client navigation; external links open in a new tab. */
function MdxLink({ href = "", children, ...props }: React.ComponentProps<"a">) {
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  );
}

/** Live preview by tag. Markup defaults to the lab demo. */
function ElementPreview({ tag, html, minHeight }: { tag: string; html?: string; minHeight?: number }) {
  const e = getElement(tag);
  if (!e) return null;
  return (
    <div className="not-prose my-6">
      <ComponentPreview
        tag={tag}
        kind={e.kind}
        component={e.component}
        html={html ?? e.stage}
        layout={e.layout}
        stageClass={e.stageClass}
        tryText={e.tryText}
        minHeight={minHeight}
      />
    </div>
  );
}

/** The install commands and manual files of a component. */
function Install({ tag }: { tag: string }) {
  const e = getElement(tag);
  if (!e) return null;
  return (
    <div className="not-prose my-5">
      <InstallBlock element={e} />
    </div>
  );
}

/** Usage snippets: React for every component, plain HTML for custom elements. */
async function Usage({ tag }: { tag: string }) {
  const e = getElement(tag);
  if (!e?.usage?.react) return null;
  if (!e.usage.html) {
    return (
      <div className="not-prose my-5 overflow-hidden rounded-xl border border-border bg-[var(--code-bg)]">
        <CodeBlock code={e.usage.react} lang="tsx" title={`${e.tag}-example.tsx`} bare item={tag} />
      </div>
    );
  }
  return (
    <div className="not-prose my-5 overflow-hidden rounded-xl border border-border bg-[var(--code-bg)]">
      <CodeTabs
        group="usage"
        className="[&>div:first-child]:bg-surface/70 [&>div:first-child]:px-2"
        items={[
          { value: "react", label: "React", content: <CodeBlock code={e.usage.react} lang="tsx" bare item={tag} /> },
          { value: "html", label: "HTML", content: <CodeBlock code={e.usage.html} lang="html" bare item={tag} /> },
        ]}
      />
    </div>
  );
}

/** A note, tip or warning box. */
function Callout({ title, type = "note", children }: { title?: string; type?: "note" | "tip" | "warning"; children: React.ReactNode }) {
  return (
    <div className={cn("not-prose my-6 rounded-xl border border-border bg-surface/60 px-4 py-3.5 text-[14px] leading-relaxed", type === "warning" && "border-[color-mix(in_oklab,var(--mark-identifier)_45%,var(--border))]")}>
      <p className="mb-1 font-mono text-[11px] text-muted-foreground">{title ?? (type === "tip" ? "Tip" : type === "warning" ? "Warning" : "Note")}</p>
      <div className="text-foreground/85 [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12.5px] [&_p+p]:mt-2">{children}</div>
    </div>
  );
}

/** Components by data kind, grouped by collection, with what each shows. */
function DataList({ kind }: { kind: "input" | "demo" }) {
  const groups = collections
    .map((c) => ({ c, items: elements.filter((e) => e.collection === c.slug && e.data === kind) }))
    .filter((g) => g.items.length);
  if (!groups.length) return <p>None.</p>;
  return (
    <div className="not-prose my-6 grid gap-6">
      {groups.map(({ c, items }) => (
        <section key={c.slug}>
          <h3 className="font-mono text-[11px] text-muted-foreground">
            {c.title} · {items.length}
          </h3>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {items.map((e) => (
              <li key={e.tag} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
                <Link href={elementHref(e)} className="shrink-0 text-[14px] font-medium tracking-tight underline-offset-2 hover:underline sm:w-44">
                  {e.title}
                </Link>
                <span className="text-[13px] leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px]">
                  {(e.dataNote ?? "").split(/(`[^`]*`)/g).map((part, k) => (k % 2 ? <code key={k}>{part.slice(1, -1)}</code> : part))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Numbered steps; each `Step` takes a title. */
function Steps({ children }: { children: React.ReactNode }) {
  return <div className="steps my-6 ml-3 border-l border-border pl-7 [counter-reset:step]">{children}</div>;
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative pb-8 [counter-increment:step] last:pb-2">
      <span className="tabular absolute top-0 -left-[41px] flex size-7 items-center justify-center rounded-full border border-border bg-background font-mono text-[11px] text-muted-foreground before:content-[counter(step)]" aria-hidden />
      <p className="!mt-0 text-[15.5px] font-medium tracking-tight text-foreground">{title}</p>
      <div className="prose mt-2 [&>*:first-child]:mt-0">{children}</div>
    </div>
  );
}

/** A grid of link cards. */
function Cards({ children }: { children: React.ReactNode }) {
  return <div className="not-prose my-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">{children}</div>;
}

function Card({ title, href, children }: { title: string; href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="group/card block bg-background p-5 transition-colors hover:bg-surface">
      <p className="flex items-center justify-between text-[15px] font-medium">
        {title}
        <span className="text-muted-foreground transition-transform duration-300 group-hover/card:translate-x-0.5">→</span>
      </p>
      {children && <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{children}</p>}
    </Link>
  );
}

function Table(props: React.ComponentProps<"table">) {
  // reference tables (… | Description) render as a readable list; everything else stays a table
  const list = ApiTable({ children: props.children });
  if (list) return list;
  return (
    <div className="my-6 overflow-x-auto">
      <table {...props} />
    </div>
  );
}

/** The MDX components of the docs. */
export function getMDXComponents(extra?: MDXComponents): MDXComponents {
  return {
    h2: (p) => <Heading as="h2" {...p} />,
    h3: (p) => <Heading as="h3" {...p} />,
    h4: (p) => <Heading as="h4" {...p} />,
    a: MdxLink,
    pre: MdxPre,
    table: Table,
    ComponentPreview: ElementPreview,
    Playground: PlaygroundBlock,
    Install,
    Usage,
    RelatedComponents,
    Callout,
    DataList,
    Steps,
    Step,
    Cards,
    Card,
    ...extra,
  };
}
