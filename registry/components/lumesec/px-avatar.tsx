"use client";

import * as React from "react";

import type { ThemeColorName } from "@/lib/lumesec/color";
import { clamp, hslToRgb, mixRgb, stringHash, TAU, type RGB } from "@/lib/lumesec/math";
import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { cn } from "@/lib/utils";

/** Presence shown as a dot in the lower right corner. */
export type PxAvatarStatus = "online" | "away" | "busy" | "offline";

/** Round or rounded-square outline. */
export type PxAvatarShape = "circle" | "square";

/** Props of `PxAvatar`. Other `span` props go to the root element. */
export interface PxAvatarProps extends Omit<React.ComponentProps<"span">, "children"> {
  /** Source of the initials (first letters of the first two words), the colour and the accessible name. Empty means "Guest". */
  name?: string;
  /** Size of the avatar in pixels. The canvas is 6px larger, so the online pulse has room. */
  size?: number;
  /** Adds a coloured dot; `online` pulses. */
  status?: PxAvatarStatus;
  /** `square` gives rounded-square corners; otherwise the avatar is round. */
  shape?: PxAvatarShape;
}

const STATUS_COLOR = {
  online: "success",
  away: "warning",
  busy: "destructive",
  offline: "muted",
} as const satisfies Record<PxAvatarStatus, ThemeColorName>;

const WHITE: RGB = [255, 255, 255];

/**
 * Avatar with initials on a pixel field coloured from the name, a status dot that pulses when online and
 * a ripple through the field when the pointer enters.
 *
 * @example
 * <PxAvatar name="Ada Lovelace" status="online" size={44} />
 */
export function PxAvatar({
  name = "Guest",
  size = 40,
  status,
  shape = "circle",
  className,
  onPointerEnter,
  ...props
}: PxAvatarProps) {
  const displayName = name.trim() || "Guest";
  const initials = initialsOf(displayName);
  const hoverAt = React.useRef<number | null>(null);
  const initialsRef = React.useRef<HTMLSpanElement>(null);

  const { ref, redraw } = usePixelCanvas((frame) => {
    const { palette, time } = frame;
    const reduced = prefersReducedMotion();
    const s = size;
    const c = s / 2;
    const square = shape === "square";
    const corner = Math.min(10, s * 0.25);
    const hue = stringHash(displayName) % 360;
    const background = hslToRgb(hue, 0.55, palette.dark ? 0.42 : 0.55);
    const background2 = hslToRgb(hue + 25, 0.6, palette.dark ? 0.52 : 0.64);
    const pitch = Math.max(2.5, s / 14);
    const age = hoverAt.current === null ? 9 : time - hoverAt.current;

    // the initials take whichever of white or black contrasts more with the field, so every name stays readable
    const label = initialsRef.current;
    const ink = relativeLuminance(mixRgb(background, background2, 0.5)) > 0.18 ? "dark" : "light";
    if (label && label.dataset.ink !== ink) label.dataset.ink = ink;

    frame.clear();
    for (let y = pitch / 2; y < s; y += pitch) {
      for (let x = pitch / 2; x < s; x += pitch) {
        const d = Math.hypot(x - c, y - c);
        // the shape is cut from the dot field here, so the canvas itself needs no clipping and the pulse has room
        if (square ? outsideRoundedSquare(x, y, s, corner) : d > c - 0.5) continue;
        // a bright ring that expands from the centre for 0.8 s after the pointer enters
        const ripple =
          age < 0.8 && !reduced ? Math.exp(-((d - age * s * 1.4) ** 2) / (pitch * pitch * 2)) * (1 - age / 0.8) : 0;
        const fill = mixRgb(mixRgb(background, background2, (x + y) / (2 * s)), WHITE, ripple * 0.5);
        frame.dot(x - pitch * 0.42, y - pitch * 0.42, fill, 1, pitch * 0.84);
      }
    }

    if (status && status in STATUS_COLOR) {
      const sx = s * 0.84;
      const sy = s * 0.84;
      const r = Math.max(4, s * 0.13);
      const color = palette[STATUS_COLOR[status]];
      for (let y = -r - 2; y <= r + 2; y += 1.5) {
        for (let x = -r - 2; x <= r + 2; x += 1.5) {
          const d = Math.hypot(x, y);
          if (d <= r + 2) frame.dot(sx + x, sy + y, d <= r ? color : palette.card, 1, 1.6);
        }
      }
      if (status === "online" && !reduced) {
        const k = (time * 0.8) % 1;
        const ring = r + 2 + k * 6;
        for (let a = 0; a < TAU; a += 0.5) frame.dot(sx + Math.cos(a) * ring - 0.8, sy + Math.sin(a) * ring - 0.8, color, (1 - k) * 0.7, 1.6);
      }
    }
    return (status === "online" && !reduced) || age < 0.8;
  });

  React.useEffect(redraw, [displayName, size, status, shape, redraw]);

  const canvasSize = size + 6;
  return (
    <span
      data-slot="px-avatar"
      role="img"
      aria-label={status ? `${displayName}, ${status}` : displayName}
      className={cn("relative inline-block align-middle", className)}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (event.defaultPrevented) return;
        hoverAt.current = performance.now() / 1000;
        redraw();
      }}
      {...props}
    >
      <canvas
        ref={ref}
        aria-hidden="true"
        className="block [image-rendering:pixelated]"
        style={{ width: canvasSize, height: canvasSize }}
      />
      {/* the initials sit over the avatar's own square, which is the canvas minus the pulse margin */}
      <span
        ref={initialsRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 grid place-items-center leading-none font-semibold tracking-[-0.01em] whitespace-nowrap text-white select-none [text-shadow:0_1px_1px_rgb(0_0_0/0.18)] data-[ink=dark]:text-black/75 data-[ink=dark]:[text-shadow:none]"
        style={{ width: size, height: size, fontSize: Math.round(size * (Array.from(initials).length > 1 ? 0.36 : 0.42)) }}
      >
        {initials}
      </span>
    </span>
  );
}

/**
 * WCAG relative luminance of an sRGB colour, 0 to 1. Above about 0.18, black text contrasts more than white.
 */
function relativeLuminance([red, green, blue]: RGB) {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** Whether `(x, y)` lies outside a `size` px square whose corners are rounded with `radius`. */
function outsideRoundedSquare(x: number, y: number, size: number, radius: number) {
  const cx = clamp(x, radius, size - radius);
  const cy = clamp(y, radius, size - radius);
  return Math.hypot(x - cx, y - cy) > radius - 0.5;
}

/** First letters of the first two words, upper-case. Letters outside the Basic Multilingual Plane stay whole. */
function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
}
