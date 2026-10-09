import Link from "next/link";
import type * as React from "react";

import { ArrowLeftIcon, ArrowRightIcon, ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="font-mono text-[12px] text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={it.name} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRightIcon size={11} className="opacity-60" aria-hidden />}
            {it.href && i < items.length - 1 ? (
              <Link href={it.href} className="transition-colors hover:text-foreground">
                {it.name}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined} className={cn(i === items.length - 1 && "text-foreground")}>
                {it.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({
  crumbs,
  meta,
  title,
  description,
  actions,
}: {
  crumbs: { name: string; href?: string }[];
  meta?: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-enter">
      <Breadcrumbs items={crumbs} />
      {meta && <div className="mt-6 flex flex-wrap items-center gap-2">{meta}</div>}
      <h1 className={cn("text-[clamp(32px,4.4vw,46px)] leading-[1.04] font-medium tracking-[-0.04em] text-balance", meta ? "mt-3" : "mt-6")}>{title}</h1>
      {description && <p className="mt-4 max-w-[62ch] text-[17px] leading-[1.6] text-muted-foreground text-pretty">{description}</p>}
      {actions && <div className="mt-6 -ml-2 border-b border-line pb-3">{actions}</div>}
    </header>
  );
}

export function Chip({ children, mono = true, className }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border border-border px-2 text-[11.5px] text-muted-foreground", mono && "font-mono", className)}>{children}</span>
  );
}

export function PrevNext({ prev, next }: { prev?: { title: string; href: string; meta?: string } | null; next?: { title: string; href: string; meta?: string } | null }) {
  if (!prev && !next) return null;
  return (
    <nav aria-label="Previous and next" className="mt-16 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
      {prev ? (
        <Link href={prev.href} className="group/pn flex flex-col gap-1 bg-background p-5 transition-colors hover:bg-surface">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <ArrowLeftIcon size={12} className="transition-transform duration-300 group-hover/pn:-translate-x-0.5" />
            Previous{prev.meta ? ` · ${prev.meta}` : ""}
          </span>
          <span className="text-[15px] font-medium">{prev.title}</span>
        </Link>
      ) : (
        <span className="hidden bg-background sm:block" />
      )}
      {next ? (
        <Link href={next.href} className="group/pn flex flex-col items-end gap-1 bg-background p-5 text-right transition-colors hover:bg-surface">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            Next{next.meta ? ` · ${next.meta}` : ""}
            <ArrowRightIcon size={12} className="transition-transform duration-300 group-hover/pn:translate-x-0.5" />
          </span>
          <span className="text-[15px] font-medium">{next.title}</span>
        </Link>
      ) : (
        <span className="hidden bg-background sm:block" />
      )}
    </nav>
  );
}
