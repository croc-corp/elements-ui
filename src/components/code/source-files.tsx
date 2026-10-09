"use client";

import * as React from "react";

import { useCopy } from "@/components/code/copy-button";
import { CheckIcon, ChevronDownIcon, CopyIcon, FileIcon } from "@/components/icons";
import type { RegistryFile } from "@/lib/registry-files";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

/** A registry file as served by /source/[...path]: its text and the highlighted HTML. */
type Loaded = { code: string; html: string; lines: number };

const sources = new Map<string, Promise<Loaded>>();

async function fetchSource(src: string): Promise<Loaded> {
  const response = await fetch(`/source/${src}`);
  if (!response.ok) throw new Error(`/source/${src} answered ${response.status}`);
  const body: unknown = await response.json();
  if (!isLoaded(body)) throw new Error(`/source/${src} returned an unexpected body`);
  return body;
}

function isLoaded(value: unknown): value is Loaded {
  if (typeof value !== "object" || value === null) return false;
  return (
    "code" in value &&
    typeof value.code === "string" &&
    "html" in value &&
    typeof value.html === "string" &&
    "lines" in value &&
    typeof value.lines === "number"
  );
}

/** Loads a file once per page; a failed load is forgotten so the next attempt retries. */
function load(src: string) {
  let pending = sources.get(src);
  if (!pending) {
    pending = fetchSource(src);
    pending.catch(() => sources.delete(src));
    sources.set(src, pending);
  }
  return pending;
}

/** Numbered steps; each file loads its highlighted source when opened. */
export function SourceFiles({ files, tag }: { files: RegistryFile[]; tag: string }) {
  return (
    <ol className="divide-y divide-border">
      {files.map((f, i) => (
        <SourceFile key={f.source} file={f} index={i + 1} tag={tag} defaultOpen={i === files.length - 1} />
      ))}
      <li className="flex gap-3 px-3.5 py-3 text-[13px] text-muted-foreground">
        <span className="tabular flex size-5 shrink-0 items-center justify-center rounded border border-border font-mono text-[10.5px]">
          {files.length + 1}
        </span>
        <span>
          Adjust the <code className="font-mono text-[12px] text-foreground">@/lib</code> and{" "}
          <code className="font-mono text-[12px] text-foreground">@/components</code> imports if your aliases differ.
        </span>
      </li>
    </ol>
  );
}

function SourceFile({
  file,
  index,
  tag,
  defaultOpen,
}: {
  file: RegistryFile;
  index: number;
  tag: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  const [data, setData] = React.useState<Loaded | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const { copied, copy } = useCopy();

  React.useEffect(() => {
    if (!open || data) return;
    let live = true;
    load(file.source)
      .then((loaded) => live && setData(loaded))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, data, file.source]);

  const copyFile = async () => {
    try {
      const loaded = data ?? (await load(file.source));
      setData(loaded);
      await copy(loaded.code);
      track("copy_code", tag, { file: file.target });
    } catch {
      setFailed(true);
    }
  };

  const collapsed = !expanded && data !== null && data.lines > 24;

  return (
    <li>
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <span className="tabular flex size-5 shrink-0 items-center justify-center rounded border border-border font-mono text-[10.5px] text-muted-foreground">
          {index}
        </span>
        <button
          type="button"
          onClick={() => {
            // opening again retries a failed load
            setFailed(false);
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium">{file.title}</span>
            <span className="flex items-center gap-1.5 truncate font-mono text-[11.5px] text-muted-foreground">
              <FileIcon size={12} className="shrink-0" />
              {file.target}
              {data && <span className="text-caption">· {data.lines} lines</span>}
            </span>
          </span>
          <ChevronDownIcon
            size={14}
            className={cn(
              "ml-auto shrink-0 text-muted-foreground transition-transform duration-300",
              open && "rotate-180",
            )}
          />
        </button>
        <button
          type="button"
          aria-label={`Copy ${file.target}`}
          title="Copy file"
          onClick={() => void copyFile()}
          className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <CheckIcon size={14} className="text-success" /> : <CopyIcon size={14} />}
        </button>
      </div>
      {open && (
        <div className="border-t border-border bg-[var(--code-bg)]">
          <p className="px-3.5 pt-2.5 text-[12.5px] text-muted-foreground">{file.note}</p>
          {data ? (
            <div className={cn("relative", collapsed && "max-h-[360px] overflow-hidden")}>
              {/* shiki output for a file of this repository */}
              <div className="code-scroll" dangerouslySetInnerHTML={{ __html: data.html }} />
              {collapsed && (
                <div className="absolute inset-x-0 bottom-0 flex h-28 items-end justify-center bg-gradient-to-t from-[var(--code-bg)] to-transparent pb-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="rounded-full border border-border bg-background px-3 py-1 text-[12px] font-medium shadow-[var(--shadow-drop-sm)] hover:border-input"
                  >
                    Show all {data.lines} lines
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="px-3.5 py-6 font-mono text-[11px] text-muted-foreground" role="status">
              {failed ? "The source could not be loaded. Close and open the file to try again." : "Loading source…"}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
