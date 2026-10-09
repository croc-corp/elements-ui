"use client";

import * as React from "react";

import { useCopy } from "@/components/code/copy-button";
import { CheckIcon, CopyIcon, ReplayIcon } from "@/components/icons";
import { useNearViewport } from "@/components/preview/component-preview";
import { type Control, ControlInput } from "@/components/preview/playground";
import { DemoBoundary } from "@/components/preview/react-demo";
import { reactModules } from "@/generated/demos";
import { track } from "@/lib/track";

type Props = {
  tag: string;
  component: string;
  controls: Control[];
  /** Props every render gets (content, data), from the component's notes. */
  baseProps: Record<string, unknown>;
  layout: "center" | "fill" | "wide";
};

type Values = Record<string, string | boolean>;
type AnyComponent = React.ComponentType<Record<string, unknown>>;

const unquote = (v: string) => v.replace(/^["'`]|["'`]$/g, "");

function startValues(controls: Control[], base: Record<string, unknown>): Values {
  const values: Values = {};
  for (const c of controls) {
    const given = base[c.name];
    if (c.kind === "boolean") values[c.name] = typeof given === "boolean" ? given : c.default === "true";
    else if (given !== undefined) values[c.name] = String(given);
    else values[c.name] = c.default && !/^(-|\(.*\)|none|empty|undefined)$/i.test(c.default) ? unquote(c.default) : "";
  }
  return values;
}

/** Control values as typed props; empty strings mean "not set". */
function toProps(controls: Control[], values: Values) {
  const props: Record<string, unknown> = {};
  for (const c of controls) {
    const v = values[c.name];
    if (v === "" || v === undefined) continue;
    if (c.kind === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) props[c.name] = n;
    } else props[c.name] = v;
  }
  return props;
}

/** A prop value as JSX attribute source. */
function attribute(name: string, value: unknown) {
  if (value === true) return name;
  if (typeof value === "number") return `${name}={${value}}`;
  if (typeof value === "string") return `${name}=${JSON.stringify(value)}`;
  const literal = JSON.stringify(value, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, "$1:");
  return `${name}={${literal.replace(/\n/g, "\n  ")}}`;
}

function toJsx(component: string, props: Record<string, unknown>) {
  const { children, ...rest } = props;
  const attrs = Object.entries(rest)
    .filter(([, v]) => v !== false && v !== undefined && v !== null)
    .map(([k, v]) => attribute(k, v));
  const inline = attrs.join(" ");
  const multiline = attrs.length > 0 && (inline.length >= 60 || inline.includes("\n"));
  const open = multiline
    ? `<${component}\n${attrs.map((a) => `  ${a}`).join("\n")}\n`
    : `<${component}${attrs.length ? ` ${inline}` : ""}`;
  if (typeof children === "string" && children) return `${open}>${children}</${component}>`;
  return multiline ? `${open}/>` : `${open} />`;
}

/** Live props panel for a native React component: change a control, the component re-renders. */
export function ReactPlayground({ tag, component, controls, baseProps, layout }: Props) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const near = useNearViewport(frameRef);
  const [Component, setComponent] = React.useState<AnyComponent | null>(null);
  const [values, setValues] = React.useState<Values>(() => startValues(controls, baseProps));
  const { copied, copy } = useCopy();

  React.useEffect(() => {
    const load = reactModules[tag];
    if (!near || !load) return;
    let live = true;
    load()
      .then((module) => {
        const exported = module[component];
        // function components, and memo or forwardRef objects
        if (live && (typeof exported === "function" || (typeof exported === "object" && exported !== null)))
          setComponent(() => exported as AnyComponent);
      })
      .catch((error: unknown) => console.error("[playground] failed to load", tag, error));
    return () => {
      live = false;
    };
  }, [near, tag, component]);

  // uncontrolled `default*` props only apply on mount, so changing one remounts the component
  const remountKey = controls
    .filter((c) => /^default[A-Z]/.test(c.name))
    .map((c) => `${c.name}=${values[c.name]}`)
    .join("|");
  const props = { ...baseProps, ...toProps(controls, values) };
  const code = toJsx(component, props);

  return (
    <div ref={frameRef} className="not-prose overflow-hidden rounded-xl border border-border">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="sl-dot-grid relative min-h-[320px] bg-background">
          <div
            data-layout={layout}
            data-kind="react"
            data-ready={Component ? true : undefined}
            className="stage elements-stage min-h-[320px]"
          >
            {Component && (
              <DemoBoundary tag={tag}>
                {/* block components (div, nav, section roots) fill the demo width; inline ones stay centred */}
                <div
                  className={
                    layout === "center"
                      ? "flex w-full max-w-[380px] justify-center [&>:is(div,nav,section,form)]:w-full"
                      : "w-full"
                  }
                >
                  <Component key={remountKey} {...props} />
                </div>
              </DemoBoundary>
            )}
          </div>
          {!Component && (
            <span className="absolute inset-0 grid place-items-center font-mono text-[11px] text-muted-foreground">
              Loading &lt;{component} /&gt;
            </span>
          )}
        </div>
        <div className="border-t border-border bg-surface/50 lg:border-t-0 lg:border-l">
          <div className="flex h-10 items-center justify-between border-b border-border px-3.5">
            <span className="font-mono text-[11px] text-muted-foreground">Props</span>
            <button
              type="button"
              onClick={() => {
                setValues(startValues(controls, baseProps));
                track("preview_action", tag, { action: "playground-reset" });
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ReplayIcon size={12} />
              Reset
            </button>
          </div>
          <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {controls.map((c) => (
              <div key={c.name} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px]">{c.name}</span>
                  <span className="block font-mono text-[10.5px] text-muted-foreground">
                    {/^default[A-Z]/.test(c.name) ? "remounts" : "live"}
                  </span>
                </span>
                <ControlInput
                  control={c}
                  value={values[c.name]}
                  onChange={(v) => setValues((current) => ({ ...current, [c.name]: v }))}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-border bg-[var(--code-bg)]">
        <div className="flex h-9 items-center justify-between border-b border-border pr-1.5 pl-3.5">
          <span className="font-mono text-[11.5px] text-foreground">React</span>
          <button
            type="button"
            aria-label="Copy code"
            onClick={() => {
              copy(code);
              track("copy_code", tag, { source: "playground" });
            }}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {copied ? <CheckIcon size={14} className="text-success" /> : <CopyIcon size={14} />}
          </button>
        </div>
        <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.7] whitespace-pre text-foreground/90">
          {code}
        </pre>
      </div>
    </div>
  );
}
