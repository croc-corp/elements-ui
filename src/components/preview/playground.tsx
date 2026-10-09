"use client";

import * as React from "react";

import { useCopy } from "@/components/code/copy-button";
import { CheckIcon, CopyIcon, ReplayIcon } from "@/components/icons";
import { useElementLoader, useNearViewport } from "@/components/preview/component-preview";
import type { ControlMeta } from "@/lib/catalog";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

/** One prop or attribute the playground can change. */
export type Control = ControlMeta;

type Props = {
  tag: string;
  component: string;
  controls: Control[];
  observed: string[];
  /** Attributes and children of the first instance in the demo markup. */
  initial: Record<string, string>;
  inner: string;
  layout: "center" | "fill" | "wide";
};

type Values = Record<string, string | boolean>;

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function startValues(controls: Control[], initial: Record<string, string>): Values {
  const v: Values = {};
  for (const c of controls) {
    if (c.kind === "boolean") v[c.name] = c.name in initial ? true : c.default === "true";
    else v[c.name] = initial[c.name] ?? (c.default && !/^\(|^none$|^empty$/i.test(c.default) ? c.default.replace(/^["'`]|["'`]$/g, "") : "");
  }
  return v;
}

function toMarkup(tag: string, values: Values, inner: string, passthrough: Record<string, string>) {
  const attrs = Object.entries({ ...passthrough, ...values })
    .filter(([, v]) => v !== false && v !== "")
    .map(([k, v]) => (v === true ? k : `${k}="${esc(String(v))}"`))
    .join(" ");
  return `<${tag}${attrs ? ` ${attrs}` : ""}>${inner}</${tag}>`;
}

function toJsx(component: string, values: Values, controls: Control[]) {
  const props = controls
    .map((c) => {
      const v = values[c.name];
      if (v === false || v === "" || v === undefined) return null;
      if (v === true) return camel(c.name);
      if (c.kind === "number" && /^-?\d+(\.\d+)?$/.test(String(v))) return `${camel(c.name)}={${v}}`;
      return `${camel(c.name)}=${JSON.stringify(v)}`;
    })
    .filter(Boolean);
  if (props.join(" ").length < 60) return `<${component}${props.length ? ` ${props.join(" ")}` : ""} />`;
  return `<${component}\n${props.map((p) => `  ${p}`).join("\n")}\n/>`;
}

/** Live props panel: change a control, the element updates, the code follows. */
export function Playground({ tag, component, controls, observed, initial, inner, layout }: Props) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const near = useNearViewport(frameRef);
  const ready = useElementLoader([tag], near);
  const [values, setValues] = React.useState<Values>(() => startValues(controls, initial));
  const [lang, setLang] = React.useState<"react" | "html">("react");
  const { copied, copy } = useCopy();
  const passthrough = React.useMemo(() => Object.fromEntries(Object.entries(initial).filter(([k]) => !controls.some((c) => c.name === k) && !/^(id|class|style)$/.test(k))), [initial, controls]);
  const lastMarkup = React.useRef<string | null>(null);

  // first render, and any change to an attribute the element does not observe, rebuilds the element
  const structural = controls.filter((c) => !observed.includes(c.name)).map((c) => `${c.name}=${values[c.name]}`).join("|");
  // reads the latest values without making them a dependency: observed attributes change in place (see `set`)
  const currentMarkup = React.useEffectEvent(() => toMarkup(tag, values, inner, passthrough));
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready) return;
    const id = window.setTimeout(() => {
      const markup = currentMarkup();
      if (markup === lastMarkup.current) return;
      lastMarkup.current = markup;
      stage.innerHTML = markup;
    }, lastMarkup.current ? 160 : 0);
    return () => window.clearTimeout(id);
  }, [structural, ready, tag, inner, passthrough]);

  const set = (name: string, value: string | boolean) => {
    setValues((v) => ({ ...v, [name]: value }));
    // observed attributes update in place, so the component animates to the new value
    if (observed.includes(name)) {
      const el = stageRef.current?.querySelector(tag);
      if (el) {
        if (value === false || value === "") el.removeAttribute(name);
        else el.setAttribute(name, value === true ? "" : String(value));
        lastMarkup.current = toMarkup(tag, { ...values, [name]: value }, inner, passthrough);
      }
    }
  };

  const code = lang === "react" ? toJsx(component, values, controls) : toMarkup(tag, values, inner, passthrough);

  return (
    <div ref={frameRef} className="not-prose overflow-hidden rounded-xl border border-border">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="sl-dot-grid relative min-h-[320px] bg-background">
          <div ref={stageRef} data-layout={layout} data-ready={ready || undefined} className="stage elements-stage min-h-[320px]" />
          {!ready && <span className="absolute inset-0 grid place-items-center font-mono text-[11px] text-muted-foreground">Loading &lt;{tag}&gt;</span>}
        </div>
        <div className="border-t border-border bg-surface/50 lg:border-t-0 lg:border-l">
          <div className="flex h-10 items-center justify-between border-b border-border px-3.5">
            <span className="font-mono text-[11px] text-muted-foreground">Props</span>
            <button
              type="button"
              onClick={() => {
                setValues(startValues(controls, initial));
                lastMarkup.current = null;
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
                  <span className="block font-mono text-[10.5px] text-muted-foreground">{observed.includes(c.name) ? "live" : "remounts"}</span>
                </span>
                <ControlInput control={c} value={values[c.name]} onChange={(v) => set(c.name, v)} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-border bg-[var(--code-bg)]">
        <div className="flex h-9 items-center justify-between border-b border-border pr-1.5 pl-2">
          <div role="group" aria-label="Code language" className="flex gap-1">
            {(["react", "html"] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={cn("h-9 px-2 font-mono text-[11.5px] transition-colors", lang === l ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {l === "react" ? "React" : "HTML"}
              </button>
            ))}
          </div>
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
        <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.7] whitespace-pre text-foreground/90">{code}</pre>
      </div>
    </div>
  );
}

/** The input for one control: a switch, a segmented choice or select, a number stepper or a text field. */
export function ControlInput({ control, value, onChange }: { control: Control; value: string | boolean | undefined; onChange: (v: string | boolean) => void }) {
  if (control.kind === "boolean") {
    const on = value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={control.name}
        onClick={() => onChange(!on)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-foreground" : "bg-muted")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow transition-transform duration-300 ease-[var(--ease-spring)]", on && "translate-x-4")} />
      </button>
    );
  }
  if (control.kind === "enum" && control.options) {
    if (control.options.length <= 3 && control.options.join("").length < 22) {
      return (
        <span role="group" aria-label={control.name} className="flex shrink-0 rounded-lg border border-border p-0.5">
          {control.options.map((o) => (
            <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value === o} className={cn("h-6 rounded-md px-2 font-mono text-[11px] transition-colors", value === o ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {o}
            </button>
          ))}
        </span>
      );
    }
    return (
      <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} aria-label={control.name} className="h-7 max-w-[150px] rounded-md border border-border bg-background px-1.5 font-mono text-[11.5px] outline-none focus:border-ring">
        <option value="">default</option>
        {control.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (control.kind === "number") {
    const n = Number(value);
    const step = Math.abs(n) > 0 && Math.abs(n) < 2 && !Number.isInteger(n) ? 0.1 : 1;
    const bump = (d: number) => onChange(String(Math.round(((Number.isFinite(n) ? n : 0) + d * step) * 100) / 100));
    return (
      <span className="flex shrink-0 items-center rounded-md border border-border">
        <button type="button" aria-label={`Decrease ${control.name}`} onClick={() => bump(-1)} className="h-7 w-6 text-muted-foreground hover:text-foreground">
          −
        </button>
        <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} inputMode="decimal" aria-label={control.name} className="tabular h-7 w-14 border-x border-border bg-background text-center font-mono text-[11.5px] outline-none focus:bg-muted" />
        <button type="button" aria-label={`Increase ${control.name}`} onClick={() => bump(1)} className="h-7 w-6 text-muted-foreground hover:text-foreground">
          +
        </button>
      </span>
    );
  }
  return <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} aria-label={control.name} className="h-7 w-[150px] shrink-0 rounded-md border border-border bg-background px-2 font-mono text-[11.5px] outline-none focus:border-ring" />;
}
