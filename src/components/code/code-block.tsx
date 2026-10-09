import { CopyButton } from "@/components/code/copy-button";
import { FileIcon, TerminalIcon } from "@/components/icons";
import { highlight } from "@/lib/highlight";
import type { TrackType } from "@/lib/track";
import { cn } from "@/lib/utils";

type Props = {
  code: string;
  lang?: string;
  /** File name or label in the caption; without it the copy button floats over the code. */
  title?: string;
  className?: string;
  /** Statistics event of the copy button. */
  event?: TrackType;
  /** Component tag the copy is counted for. */
  item?: string;
  /** Hide the frame: for use inside tabs that already draw one. */
  bare?: boolean;
};

/** Server-highlighted code with a copy button. Switches theme with the page. */
export async function CodeBlock({ code, lang = "tsx", title, className, event = "copy_code", item, bare }: Props) {
  const text = code.replace(/\n+$/, "");
  // shiki output for code authored in this repository
  const html = await highlight(text, lang);
  const Icon = lang === "bash" ? TerminalIcon : FileIcon;
  return (
    <figure className={cn("group/code relative overflow-hidden text-[13px]", !bare && "rounded-xl border border-border bg-[var(--code-bg)]", className)}>
      {title ? (
        <figcaption className="flex h-10 items-center justify-between gap-2 border-b border-border pr-1.5 pl-3.5">
          <span className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-muted-foreground">
            <Icon size={13} className="shrink-0" />
            <span className="truncate">{title}</span>
          </span>
          <CopyButton text={text} event={event} item={item} />
        </figcaption>
      ) : (
        <CopyButton text={text} event={event} item={item} className="absolute top-1.5 right-1.5 z-10 bg-[var(--code-bg)] opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100" />
      )}
      <div className="code-scroll" dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  );
}
