"use client";

import * as React from "react";

import { CheckIcon, CopyIcon } from "@/components/icons";
import { track, type TrackType } from "@/lib/track";
import { cn } from "@/lib/utils";

/** Copies with the textarea fallback for browsers that refuse the Clipboard API (e.g. without HTTPS). */
function copyWithSelection(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

/** `copy(text)` writes to the clipboard; `copied` stays true for `timeout` ms afterwards. */
export function useCopy(timeout = 1600) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = React.useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        copyWithSelection(text);
      }
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), timeout);
    },
    [timeout],
  );
  return { copied, copy };
}

/** Icon button that copies `text` (or the result of `getText`) and counts the copy. */
export function CopyButton({
  text,
  getText,
  event = "copy_code",
  item,
  label = "Copy",
  className,
}: {
  text?: string;
  getText?: () => string;
  event?: TrackType;
  item?: string;
  label?: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => {
        void copy(text ?? getText?.() ?? "");
        track(event, item ?? null);
      }}
      className={cn(
        "relative inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95",
        className,
      )}
    >
      <CopyIcon size={14} className={cn("transition-all duration-300 ease-[var(--ease-expo)]", copied ? "scale-50 opacity-0" : "scale-100 opacity-100")} />
      <CheckIcon size={14} className={cn("absolute text-success transition-all duration-300 ease-[var(--ease-expo)]", copied ? "scale-100 opacity-100" : "scale-50 opacity-0")} />
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
