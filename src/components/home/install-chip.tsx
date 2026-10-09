"use client";

import * as React from "react";

import { useSyncedChoice } from "@/components/code/code-tabs";
import { useCopy } from "@/components/code/copy-button";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { site } from "@/config/site";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

const PACKAGE_MANAGERS = [
  { id: "npm", run: "npx" },
  { id: "pnpm", run: "pnpm dlx" },
  { id: "yarn", run: "yarn dlx" },
  { id: "bun", run: "bunx --bun" },
] as const;

const IDS = PACKAGE_MANAGERS.map((p) => p.id);

/** One-line install command with a package-manager switch, shared with the install tabs on component pages. */
export function InstallChip({ item = "effort-slider", className }: { item?: string; className?: string }) {
  const [pm, setPm] = useSyncedChoice("pm", IDS, "npm");
  const { copied, copy } = useCopy();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [bar, setBar] = React.useState({ x: 0, w: 0 });

  React.useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-pm="${pm}"]`);
    if (el) setBar({ x: el.offsetLeft, w: el.offsetWidth });
  }, [pm]);

  const run = (PACKAGE_MANAGERS.find((p) => p.id === pm) ?? PACKAGE_MANAGERS[0]).run;
  const name = `${site.registry.namespace}/${item}`;
  const cmd = `${run} shadcn@latest add ${name}`;

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-surface/70 backdrop-blur", className)}>
      <div ref={listRef} role="group" aria-label="Package manager" className="relative flex items-center gap-1 border-b border-border px-2">
        {PACKAGE_MANAGERS.map((p) => (
          <button
            key={p.id}
            type="button"
            data-pm={p.id}
            onClick={() => setPm(p.id)}
            aria-pressed={pm === p.id}
            className={cn("h-8 px-2 font-mono text-[11.5px] transition-colors", pm === p.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {p.id}
          </button>
        ))}
        <span aria-hidden className="absolute -bottom-px left-0 h-px bg-foreground transition-[transform,width] duration-300 ease-[var(--ease-expo)]" style={{ transform: `translateX(${bar.x}px)`, width: bar.w }} />
      </div>
      <button
        type="button"
        onClick={() => {
          void copy(cmd);
          track("copy_install", item, { source: "home" });
        }}
        className="group/cmd flex w-full items-center gap-3 px-3.5 py-3 text-left"
        aria-label={`Copy: ${cmd}`}
      >
        <span className="font-mono text-[13px] text-muted-foreground">$</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
          <span className="text-muted-foreground">{run} shadcn@latest add </span>
          <span className="text-foreground">{name}</span>
        </span>
        <span className="relative flex size-6 items-center justify-center text-muted-foreground transition-colors group-hover/cmd:text-foreground">
          <CopyIcon size={14} className={cn("transition-all duration-300", copied ? "scale-50 opacity-0" : "opacity-100")} />
          <CheckIcon size={14} className={cn("absolute text-success transition-all duration-300", copied ? "scale-100 opacity-100" : "scale-50 opacity-0")} />
        </span>
      </button>
    </div>
  );
}
