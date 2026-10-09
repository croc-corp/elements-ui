"use client";

import * as React from "react";

import { mixRgb, rand } from "@/lib/lumesec/math";
import { prefersReducedMotion, useReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { STATUS_COLORS, STATUS_ICONS, type StatusTone } from "@/lib/lumesec/pixel-font";
import { useComposedRef } from "@/lib/lumesec/react";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Tone of the alert: colour, icon and ARIA role. */
export type PxAlertType = StatusTone;

/** Props of `PxAlert`. Other `div` props go to the root element. */
export interface PxAlertProps extends React.ComponentProps<"div"> {
  /** Colour, icon and role: `error` and `warning` are `role="alert"`, the others `role="status"`. */
  type?: PxAlertType;
  /** Bold title above the message. */
  heading?: React.ReactNode;
  /** Shows a dismiss button. */
  dismissible?: boolean;
  /** Controlled visibility. Use with `onOpenChange`; turning it off plays the dismiss animation first. */
  open?: boolean;
  /** Initial visibility when uncontrolled. */
  defaultOpen?: boolean;
  /** Called with `false` when the dismiss button is pressed. */
  onOpenChange?: (open: boolean) => void;
  /** The message. */
  children?: React.ReactNode;
}

/** A pixel thrown off the stripe when the alert is dismissed. */
interface StripeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** The `--tone` variable the border and background mix from. */
const TONE_VARIABLES: Record<PxAlertType, string> = {
  info: "[--tone:var(--lumesec)]",
  success: "[--tone:var(--lumesec-success)]",
  warning: "[--tone:var(--lumesec-warning)]",
  error: "[--tone:var(--destructive)]",
};

/** How long the alert takes to scatter and collapse before it is hidden. */
const EXIT_MS = 380;

/**
 * Inline alert in four tones with a pixel icon and a glowing stripe down its left edge. Dismissing it
 * scatters the stripe's pixels to the right while the alert fades and collapses, then hides it.
 *
 * @example
 * <PxAlert type="warning" heading="Usage at 85%" dismissible>
 *   You’ve used most of this week’s limit.
 * </PxAlert>
 */
export function PxAlert({
  type = "info",
  heading,
  dismissible = false,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  children,
  className,
  ref,
  ...props
}: PxAlertProps) {
  const tone: PxAlertType = type in STATUS_ICONS ? type : "info";
  const reduced = useReducedMotion();
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const rootRef = React.useRef<HTMLDivElement>(null);
  // focus handling needs the root; the caller's `ref` still receives it
  const setRootRef = useComposedRef(rootRef, ref);

  // `visible` lags `open` by the exit animation; `leaving` is that animation
  const [visible, setVisible] = React.useState(open);
  const [leaving, setLeaving] = React.useState(false);
  const [previousOpen, setPreviousOpen] = React.useState(open);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) {
      setVisible(true);
      setLeaving(false);
    } else if (visible) {
      setLeaving(true);
    }
  }

  const particles = React.useRef<StripeParticle[]>([]);

  const { ref: canvasRef, redraw } = usePixelCanvas(({ palette, time, delta, height, clear, dot }) => {
    const color = palette[STATUS_COLORS[tone]];
    clear();
    if (leaving) {
      particles.current = particles.current.filter((particle) => {
        particle.age += delta;
        if (particle.age > particle.life) return false;
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        dot(particle.x, particle.y, color, 1 - particle.age / particle.life, 2.2);
        return true;
      });
      return particles.current.length > 0;
    }
    const glow = reduced ? -9 : ((time * 0.5) % 1.8) - 0.4;
    for (let y = 6; y < height - 6; y += 3) {
      const k = Math.max(0, 1 - Math.abs(y / height - glow) * 6);
      dot(4, y, mixRgb(color, palette.shine, k * 0.6), 0.55 + 0.45 * k, 2.2);
    }
    for (const [x, y] of STATUS_ICONS[tone]) dot(14 + x * 2.4, 14 + y * 2.4, color, 1, 2.1);
    return !reduced;
  });

  // The leaving alert is inert, which would drop focus to the page: move it to the next control first.
  // A layout effect runs before the browser can move focus away from the inert subtree.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (leaving && root?.contains(document.activeElement)) focusNeighbour(root);
  }, [leaving]);

  React.useEffect(() => {
    if (!leaving) return;
    const instant = prefersReducedMotion();
    const height = canvasRef.current?.clientHeight ?? 0;
    particles.current = instant ? [] : stripeParticles(height);
    redraw();
    const timer = window.setTimeout(
      () => {
        particles.current = [];
        setVisible(false);
        setLeaving(false);
      },
      instant ? 0 : EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [leaving, canvasRef, redraw]);

  React.useEffect(redraw, [tone, visible, reduced, redraw]);

  return (
    <div
      ref={setRootRef}
      data-slot="px-alert"
      data-type={tone}
      data-state={open ? "open" : "closed"}
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      hidden={!visible}
      inert={leaving}
      className={cn(
        "relative grid max-h-[400px] grid-cols-[1fr_auto] items-start gap-2.5 overflow-hidden rounded-xl border py-3 pr-2.5 pl-11 text-foreground",
        "border-[color-mix(in_srgb,var(--tone)_30%,var(--border))] bg-[color-mix(in_srgb,var(--tone)_7%,var(--card))]",
        "[transition:opacity_.3s,max-height_.35s_cubic-bezier(.3,.7,.2,1),padding_.35s,margin_.35s]",
        TONE_VARIABLES[tone],
        leaving && "max-h-0 pt-0 pb-0 opacity-0",
        className,
      )}
      {...props}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 block h-full w-10 [image-rendering:pixelated]"
      />
      <span className="grid min-w-0 gap-[3px]">
        {heading != null && heading !== "" && <b className="text-[13.5px] font-semibold">{heading}</b>}
        <span className="text-[13px] leading-[1.5] text-[color-mix(in_srgb,var(--foreground)_80%,var(--muted-foreground))]">
          {children}
        </span>
      </span>
      {dismissible && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setOpen(false)}
          className="grid size-[26px] cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground outline-none select-none hover:bg-foreground/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
        >
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className="size-[11px] fill-none stroke-current [stroke-width:1.8] [stroke-linecap:round]"
          >
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Pixels across the stripe and icon column, flying right. */
function stripeParticles(height: number): StripeParticle[] {
  const particles: StripeParticle[] = [];
  for (let y = 4; y < height - 4; y += 3) {
    for (let x = 6; x < 30; x += 3) {
      particles.push({ x, y, vx: rand(40, 220), vy: rand(-40, 40), age: 0, life: rand(0.3, 0.6) });
    }
  }
  return particles;
}

/** Elements a keyboard user can reach with Tab, before filtering out hidden and inert ones. */
const TABBABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * Focus the first tabbable element after `element` in document order (where Tab would have gone), or the
 * last one before it when nothing follows.
 */
function focusNeighbour(element: HTMLElement) {
  let previous: HTMLElement | null = null;
  for (const candidate of document.querySelectorAll<HTMLElement>(TABBABLE)) {
    if (element.contains(candidate) || candidate.tabIndex < 0 || candidate.closest("[inert]")) continue;
    if (candidate.getClientRects().length === 0) continue;
    if (element.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) {
      candidate.focus();
      return;
    }
    previous = candidate;
  }
  previous?.focus();
}
