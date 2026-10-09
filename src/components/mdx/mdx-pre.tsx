"use client";

import * as React from "react";

import { CopyButton } from "@/components/code/copy-button";
import { FileIcon, TerminalIcon } from "@/components/icons";

type Props = React.ComponentProps<"pre"> & { title?: string; "data-language"?: string };

/** Frame for MDX code fences highlighted at build time by rehype-code. */
export function MdxPre({ title, children, ...props }: Props) {
  const ref = React.useRef<HTMLPreElement>(null);
  const lang = props["data-language"];
  const Icon = lang === "bash" || lang === "sh" ? TerminalIcon : FileIcon;
  const getText = () => ref.current?.textContent ?? "";
  return (
    <figure className="not-prose group/code relative my-5 overflow-hidden rounded-xl border border-border bg-[var(--code-bg)] text-[13px]">
      {title ? (
        <figcaption className="flex h-10 items-center justify-between gap-2 border-b border-border pr-1.5 pl-3.5">
          <span className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-muted-foreground">
            <Icon size={13} className="shrink-0" />
            <span className="truncate">{title}</span>
          </span>
          <CopyButton getText={getText} />
        </figcaption>
      ) : (
        <CopyButton
          getText={getText}
          className="absolute top-1.5 right-1.5 z-10 bg-[var(--code-bg)] opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
        />
      )}
      <div className="code-scroll">
        <pre ref={ref} {...props}>
          {children}
        </pre>
      </div>
    </figure>
  );
}
