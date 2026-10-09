import Link from "next/link";

import { ArrowLeftIcon } from "@/components/icons";
import { ComponentPreview } from "@/components/preview/component-preview";
import { LumeSecMark } from "@/components/site/logo";
import { ThemeToggle } from "@/components/site/theme";
import { type ElementMeta, elementHref } from "@/lib/catalog";

/** A component on its own, with a header that links back to its page. */
export function ViewFrame({ e }: { e: ElementMeta }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-11 items-center justify-between border-b border-border px-3">
        <Link
          href={elementHref(e)}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon size={14} />
          <LumeSecMark className="h-[13px] w-auto" />
          <span className="font-medium text-foreground">{e.title}</span>
          <span className="font-mono text-[11.5px]">{e.kind === "react" ? `<${e.component} />` : `<${e.tag}>`}</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 flex-col">
        <ComponentPreview
          variant="view"
          tag={e.tag}
          kind={e.kind}
          component={e.component}
          html={e.stage}
          layout={e.layout}
          stageClass={e.stageClass}
          tryText={e.tryText}
          eager
          className="flex-1"
        />
      </main>
    </div>
  );
}
