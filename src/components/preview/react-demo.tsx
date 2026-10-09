"use client";

import * as React from "react";

import { demos } from "@/generated/demos";
import reactTags from "@/generated/react-tags.json";

const reactSet = new Set<string>(reactTags);

/** Whether a tag is a native React component (it has a demo in registry/examples). */
export const isReactTag = (tag: string) => reactSet.has(tag);

// one lazy component per demo, created at import: each module loads the first time its demo renders
const lazyDemos: Partial<Record<string, React.LazyExoticComponent<React.ComponentType>>> = Object.fromEntries(
  Object.entries(demos).map(([tag, load]) => [tag, React.lazy(load)]),
);

/** Calls `onReady` once it is mounted, which inside Suspense means once the demo has loaded. */
function ReadySignal({ onReady }: { onReady?: () => void }) {
  React.useEffect(() => onReady?.(), [onReady]);
  return null;
}

/** The demo of a native React component, loaded on first render. Renders nothing for unknown tags. */
export function ReactDemo({ tag, onReady }: { tag: string; onReady?: () => void }) {
  const Demo = lazyDemos[tag];
  if (!Demo) return null;
  return (
    <React.Suspense fallback={null}>
      <Demo />
      <ReadySignal onReady={onReady} />
    </React.Suspense>
  );
}

/** Catches a crashing demo so one broken preview never takes the page down. */
export class DemoBoundary extends React.Component<{ tag: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[preview] demo crashed", this.props.tag, error);
  }

  render() {
    if (this.state.failed) {
      return <span className="font-mono text-[11px] text-muted-foreground">Preview unavailable</span>;
    }
    return this.props.children;
  }
}
