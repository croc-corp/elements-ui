"use client";

import * as React from "react";

import { ArrowUpRightIcon, ExpandIcon, MoonIcon, ReplayIcon, SunIcon } from "@/components/icons";
import { demoSetups } from "@/components/preview/demo-setups";
import { DemoBoundary, isReactTag, ReactDemo } from "@/components/preview/react-demo";
import { useTheme } from "@/components/site/theme";
import { loaders } from "@/generated/loaders";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

/** Props of {@link ComponentPreview}. */
export type PreviewProps = {
  tag: string;
  /** Demo markup for custom elements (from the lab gallery, authored in this repository). */
  html: string;
  layout: "center" | "fill" | "wide";
  stageClass?: string;
  /** One line of what to try, with inline `code` and **bold**. Shown under the page variant. */
  tryText?: string | null;
  /** page: full toolbar. view: toolbar on a full-height page. card: bare stage for grids. hero: borderless showcase. */
  variant?: "page" | "card" | "hero" | "view";
  minHeight?: number;
  className?: string;
  /** Load as soon as mounted instead of when scrolled near. */
  eager?: boolean;
  /** Native React component (renders its demo) or custom element (renders `html`). Inferred from the tag. */
  kind?: "react" | "element";
  /** Name shown in the toolbar for React components, e.g. `UiToggle`. */
  component?: string;
  /** Custom React content for the stage, instead of the component's demo. */
  children?: React.ReactNode;
};

const TAG_RE = /<([a-z][a-z0-9]*-[a-z0-9-]+)/g;

/** The main tag plus every other custom element a demo uses (e.g. a shell that hosts a map). */
export function tagsIn(html: string, main: string) {
  const set = new Set([main]);
  for (const match of html.matchAll(TAG_RE)) if (loaders[match[1]]) set.add(match[1]);
  return [...set];
}

/** Asks every element to re-read its palette (they watch <html> for style changes). */
export function repaintElements() {
  document.documentElement.style.setProperty("--elements-repaint", String(Date.now() % 100000));
}

/** Imports the element modules for `tags` once `when` is true; true when all of them are defined. */
export function useElementLoader(tags: string[], when: boolean) {
  const [ready, setReady] = React.useState(false);
  const key = tags.join(",");
  React.useEffect(() => {
    if (!when) return;
    let live = true;
    Promise.all(key.split(",").map((t) => loaders[t]?.()))
      .then(() => live && setReady(true))
      .catch((err: unknown) => console.error("[preview] failed to load", key, err));
    return () => {
      live = false;
    };
  }, [key, when]);
  return ready;
}

/** True once the element is within `margin` of the viewport (or right away when `eager`). Never turns false. */
export function useNearViewport<T extends Element>(ref: React.RefObject<T | null>, eager = false, margin = "300px") {
  const [near, setNear] = React.useState(eager);
  React.useEffect(() => {
    if (near || !ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: margin });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near, ref, margin]);
  return near;
}

/** Runs the demo wiring of the elements on a stage once they are defined, and again after every replay. */
export function useDemoSetups(stageRef: React.RefObject<HTMLElement | null>, tags: string[], active: boolean, replay = 0) {
  React.useEffect(() => {
    const root = stageRef.current;
    if (!active || !root) return;
    const cleanups = tags.flatMap((tag) => {
      const cleanup = demoSetups[tag]?.(root);
      return cleanup ? [cleanup] : [];
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [stageRef, tags, active, replay]);
}

/** A live component: a React demo or custom-element markup, loaded when it scrolls near. */
export function ComponentPreview({ tag, html, layout, stageClass, tryText, variant = "page", minHeight, className, eager, kind, component, children }: PreviewProps) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [replay, setReplay] = React.useState(0);
  const [theme, setTheme] = React.useState<"light" | "dark" | null>(null);
  const { resolved: pageTheme } = useTheme();
  const isReact = kind ? kind === "react" : isReactTag(tag);
  const tags = React.useMemo(() => tagsIn(html, tag), [html, tag]);
  const near = useNearViewport(frameRef, eager);
  const elementsReady = useElementLoader(tags, near && !isReact);
  const [demoReady, setDemoReady] = React.useState(false);
  const markDemoReady = React.useCallback(() => setDemoReady(true), []);
  const ready = isReact ? Boolean(children) || demoReady : elementsReady;
  const label = isReact ? `<${component ?? tag} />` : `<${tag}>`;
  const previewTheme = theme ?? pageTheme;
  const otherTheme = previewTheme === "dark" ? "light" : "dark";

  useDemoSetups(stageRef, tags, !isReact && ready, replay);

  React.useEffect(() => {
    if (theme) repaintElements();
  }, [theme]);

  const toggleFullscreen = () => {
    const frame = frameRef.current;
    if (!frame) return;
    const request = document.fullscreenElement ? document.exitFullscreen() : frame.requestFullscreen?.();
    request?.catch(() => {});
  };

  const toolbar = variant === "page" || variant === "view";
  const extraClass = stageClass?.replace(/\bstage\b/, "").trim();
  const stageProps = {
    ref: stageRef,
    "data-layout": layout,
    "data-ready": ready || undefined,
    "data-compact": variant === "card" || undefined,
    className: cn("stage elements-stage", extraClass, variant === "view" && "w-full"),
    style: minHeight ? { minHeight } : undefined,
  };

  return (
    <div
      ref={frameRef}
      data-theme={theme ?? undefined}
      className={cn(
        "group/preview relative isolate overflow-hidden bg-background text-foreground",
        variant === "page" && "rounded-xl border border-border",
        variant === "view" && "min-h-dvh",
        className,
      )}
    >
      {toolbar && (
        <div className="relative z-10 flex h-10 items-center justify-between gap-2 border-b border-border bg-surface/70 pr-1.5 pl-3.5 backdrop-blur">
          <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full transition-colors duration-500", ready ? "bg-success" : "bg-muted-foreground/40")} aria-hidden />
            {label}
            <span className="hidden sm:inline">{ready ? "· live" : "· loading"}</span>
          </span>
          <div className="flex items-center gap-0.5">
            <ToolButton
              label={`Preview in ${otherTheme} theme`}
              onClick={() => {
                setTheme(otherTheme);
                track("preview_action", tag, { action: `theme:${otherTheme}` });
              }}
            >
              {previewTheme === "dark" ? <SunIcon size={14} /> : <MoonIcon size={14} />}
            </ToolButton>
            <ToolButton
              label="Replay"
              onClick={() => {
                setReplay((n) => n + 1);
                track("preview_action", tag, { action: "replay" });
              }}
            >
              <ReplayIcon size={14} />
            </ToolButton>
            <ToolButton label="Fullscreen" onClick={toggleFullscreen}>
              <ExpandIcon size={14} />
            </ToolButton>
            {variant === "page" && (
              <a
                href={`/view/${tag}`}
                target="_blank"
                rel="noopener"
                aria-label="Open in a new tab"
                title="Open in a new tab"
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowUpRightIcon size={14} />
              </a>
            )}
          </div>
        </div>
      )}
      <div className={cn("relative", variant !== "card" && "sl-dot-grid", variant === "view" && "min-h-[calc(100dvh-40px)] grid place-items-center")}>
        {variant === "page" && <Corners />}
        {isReact ? (
          // the key remounts the demo on replay
          <div key={replay} {...stageProps} data-kind="react">
            <DemoBoundary tag={tag}>{children ?? (near ? <ReactDemo tag={tag} onReady={markDemoReady} /> : null)}</DemoBoundary>
          </div>
        ) : (
          // demo markup from the lab gallery: static, authored in this repository
          <div key={replay} {...stageProps} dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {!ready && variant !== "card" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
            <span className="font-mono text-[11px] text-muted-foreground animate-pulse">Loading {label}</span>
          </div>
        )}
      </div>
      {tryText && variant === "page" && (
        <div className="border-t border-border bg-surface/70 px-3.5 py-2.5">
          <p className="text-[13px] text-muted-foreground">
            <span className="mr-2 font-mono text-[11px] text-foreground">Try</span>
            <TryText text={tryText} />
          </p>
        </div>
      )}
    </div>
  );
}

/** The lab's try notes carry a "**Try:**" prefix and inline Markdown; the label is drawn separately. */
function TryText({ text }: { text: string }) {
  const clean = text.replace(/^\*\*Try:?\*\*:?\s*/i, "");
  return (
    <>
      {clean.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="rounded bg-muted px-1 font-mono text-[12px] text-foreground">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-medium text-foreground">{part.slice(2, -2)}</strong>;
        return part;
      })}
    </>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
    >
      {children}
    </button>
  );
}

function Corners() {
  return (
    <>
      <span className="sl-cross top-2.5 left-2.5" />
      <span className="sl-cross top-2.5 right-2.5" />
      <span className="sl-cross bottom-2.5 left-2.5" />
      <span className="sl-cross right-2.5 bottom-2.5" />
    </>
  );
}
