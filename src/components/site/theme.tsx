"use client";

import * as React from "react";

import { MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** The stored choice; "system" follows the operating system. */
export type ThemePref = "system" | "light" | "dark";

type Resolved = "light" | "dark";

const THEME_EVENT = "elements:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const isThemePref = (value: string | null): value is ThemePref => value === "system" || value === "light" || value === "dark";

// the choice made on this page; it wins over storage, which can be blocked
let chosen: ThemePref | null = null;

/** The preference: chosen on this page, else stored, else "system". */
function readPref(): ThemePref {
  if (chosen) return chosen;
  try {
    const value = localStorage.getItem("theme");
    return isThemePref(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** The theme in effect, as the theme script and `apply` set it on <html>. */
const readResolved = (): Resolved => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function subscribePref(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/** Also follows the operating system while the preference is "system". */
function subscribeResolved(onChange: () => void) {
  const query = matchMedia(DARK_QUERY);
  const onSystemChange = () => {
    if (readPref() === "system") apply("system");
    onChange();
  };
  query.addEventListener("change", onSystemChange);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    query.removeEventListener("change", onSystemChange);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}

/** Runs before paint so the first frame already has the right theme. */
export const themeScript = `(function(){try{var p=localStorage.getItem("theme")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.add("js");r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light";if(localStorage.getItem("layout")==="full")r.dataset.layout="full"}catch(e){}})()`;

const ThemeContext = React.createContext<{ pref: ThemePref; resolved: Resolved; setPref: (p: ThemePref) => void } | null>(null);

/** Sets the theme on <html>. */
function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && matchMedia(DARK_QUERY).matches);
  const root = document.documentElement;
  // no transition flash while every token swaps
  root.dataset.switching = "";
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.switching));
}

/**
 * Theme state for the site. The inline `themeScript` sets the first frame; <html data-theme> and storage stay
 * the source of truth, read through external stores (the server renders "system" and dark).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pref = React.useSyncExternalStore(subscribePref, readPref, () => "system" as const);
  const resolved = React.useSyncExternalStore(subscribeResolved, readResolved, () => "dark" as const);

  const setPref = React.useCallback((p: ThemePref) => {
    chosen = p;
    try {
      localStorage.setItem("theme", p);
    } catch {
      // storage can be blocked; the choice still applies until the page is left
    }
    apply(p);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  const value = React.useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The theme preference, the theme in effect and a setter. */
export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}

/** Header button: flips between light and dark with a rotating glyph. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPref } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setPref(next)}
      className={cn(
        "group relative inline-flex size-8 items-center justify-center overflow-hidden rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
        className,
      )}
    >
      <SunIcon className="absolute transition-all duration-500 ease-[var(--ease-expo)] [[data-theme=light]_&]:rotate-0 [[data-theme=light]_&]:opacity-100 [[data-theme=dark]_&]:-rotate-90 [[data-theme=dark]_&]:scale-50 [[data-theme=dark]_&]:opacity-0" />
      <MoonIcon className="absolute transition-all duration-500 ease-[var(--ease-expo)] [[data-theme=dark]_&]:rotate-0 [[data-theme=dark]_&]:opacity-100 [[data-theme=light]_&]:rotate-90 [[data-theme=light]_&]:scale-50 [[data-theme=light]_&]:opacity-0" />
    </button>
  );
}

/** Footer control: system, light, dark. */
export function ThemeSegmented({ className }: { className?: string }) {
  const { pref, setPref } = useTheme();
  const options: { id: ThemePref; label: string; Icon: typeof SunIcon }[] = [
    { id: "system", label: "System theme", Icon: MonitorIcon },
    { id: "light", label: "Light theme", Icon: SunIcon },
    { id: "dark", label: "Dark theme", Icon: MoonIcon },
  ];
  return (
    <div role="group" aria-label="Theme" className={cn("inline-flex items-center gap-0.5 rounded-full border border-border p-0.5", className)}>
      {options.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={pref === id}
          aria-label={label}
          title={label}
          onClick={() => setPref(id)}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
            pref === id && "bg-muted text-foreground",
          )}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
