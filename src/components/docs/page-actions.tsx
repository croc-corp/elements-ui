"use client";

import * as React from "react";

import { useCopy } from "@/components/code/copy-button";
import { ArrowUpRightIcon, CheckIcon, ChevronDownIcon, CopyIcon, MarkdownIcon } from "@/components/icons";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

type Props = {
  /** Absolute URL of the page. */
  url: string;
  /** Site-relative path of the Markdown twin. */
  markdownPath: string;
  /** shadcn registry item URL, enables "Open in v0". */
  registryUrl?: string;
  /** Component tag the actions are counted for. */
  item?: string;
};

const markdown = new Map<string, Promise<string>>();

/** The Markdown twin of a page, fetched once; a failed fetch is forgotten so the next click retries. */
function loadMarkdown(path: string) {
  let pending = markdown.get(path);
  if (!pending) {
    pending = fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path} answered ${r.status}`);
      return r.text();
    });
    pending.catch(() => markdown.delete(path));
    markdown.set(path, pending);
  }
  return pending;
}

/** Copy the page as Markdown, view the Markdown, or open the page in an assistant. */
export function PageActions({ url, markdownPath, registryUrl, item }: Props) {
  const { copied, copy } = useCopy();
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copyPage = async () => {
    try {
      await copy(await loadMarkdown(markdownPath));
      track("copy_page", item ?? markdownPath);
    } catch {
      // the Markdown could not be fetched; "View as Markdown" still works
    }
  };

  const mdUrl = `${new URL(url).origin}${markdownPath}`;
  const prompt = `Read ${mdUrl} so I can ask questions about it.`;
  const targets = [
    { id: "chatgpt", label: "Open in ChatGPT", href: `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}` },
    { id: "claude", label: "Open in Claude", href: `https://claude.ai/new?q=${encodeURIComponent(prompt)}` },
    { id: "perplexity", label: "Open in Perplexity", href: `https://www.perplexity.ai/search?q=${encodeURIComponent(prompt)}` },
    ...(registryUrl ? [{ id: "v0", label: "Open in v0", href: `https://v0.dev/chat/api/open?url=${encodeURIComponent(registryUrl)}` }] : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => void copyPage()}
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {copied ? <CheckIcon size={13} className="text-success" /> : <CopyIcon size={13} />}
        {copied ? "Copied" : "Copy page"}
      </button>
      <a href={markdownPath} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
        <MarkdownIcon size={13} />
        View as Markdown
      </a>
      {/* a disclosure with a list of links (not an ARIA menu): Tab moves through them, Escape closes */}
      <div ref={menuRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Open in
          <ChevronDownIcon size={13} className={cn("transition-transform duration-300", open && "rotate-180")} />
        </button>
        {open && (
          <ul id={listId} className="absolute top-8 left-0 z-50 w-52 rounded-xl border border-border bg-card p-1 shadow-[var(--shadow-pop)] animate-[sl-fade-up_.2s_var(--ease-expo)]">
            {targets.map((t) => (
              <li key={t.id}>
                <a
                  href={t.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    track("open_in", item ?? markdownPath, { target: t.id });
                    setOpen(false);
                  }}
                  className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] hover:bg-muted"
                >
                  {t.label}
                  <ArrowUpRightIcon size={13} className="text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
