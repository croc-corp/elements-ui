"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/** Adds data-shown to every .reveal inside once it enters the viewport. */
export function Reveal({
  children,
  className,
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  // a callback ref, so one ref type fits every `as` element
  const [root, setRoot] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!root) return;
    const targets = [root, ...root.querySelectorAll<HTMLElement>(".reveal")].filter((el) =>
      el.classList.contains("reveal"),
    );
    if (!targets.length) return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (!e.isIntersecting || !(e.target instanceof HTMLElement)) continue;
          e.target.dataset.shown = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [root]);
  return (
    <Tag ref={setRoot} className={className} {...rest}>
      {children}
    </Tag>
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the user asked for reduced motion; false on the server and until hydrated. */
export function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * Counts up from zero once visible. Tabular digits, so the width never jumps. The final number is rendered
 * until then, so it is right without JavaScript and with reduced motion.
 */
export function CountUp({ to, duration = 1200, className }: { to: number; duration?: number; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();
  const [v, setV] = React.useState(to);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    let raf = 0;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / duration);
        setV(Math.round(to * (1 - Math.pow(1 - k, 4))));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration, reduced]);
  return (
    <span ref={ref} className={cn("tabular", className)}>
      {reduced ? to : v}
    </span>
  );
}

/** A soft light that follows the pointer across a surface. */
export function Spotlight({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div ref={ref} onPointerMove={onMove} className={cn("group/spot relative", className)}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-500 group-hover/spot:opacity-100"
        style={{
          background:
            "radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), color-mix(in oklab, var(--foreground) 5%, transparent), transparent 60%)",
        }}
      />
      {children}
    </div>
  );
}

/** Splits a line into words that rise in sequence. */
export function RiseText({ text, className, offset = 0 }: { text: string; className?: string; offset?: number }) {
  return (
    <span className={cn("rise", className)}>
      {text.split(" ").map((w, i, all) => (
        <React.Fragment key={i}>
          <span style={{ "--w": i + offset } as React.CSSProperties}>{w}</span>
          {i < all.length - 1 ? " " : ""}
        </React.Fragment>
      ))}
    </span>
  );
}
