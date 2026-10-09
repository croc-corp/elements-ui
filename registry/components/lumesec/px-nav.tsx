"use client";

import * as React from "react";

import { prefersReducedMotion, springEuler, type Spring } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Built-in 7×7 pixel icons. */
export type PxNavIcon = "home" | "chat" | "folder" | "chart" | "gear" | "users" | "bell";

/** One link in the nav. */
export interface PxNavItem {
  /** Link target; also identifies the item in `value`. A `#` link does not navigate. */
  href: string;
  /** Link text. */
  label: string;
  /** Pixel icon drawn before the label. */
  icon?: PxNavIcon;
  /** Short text in a badge at the end of the row, such as an unread count. It is part of the link's name. */
  badge?: string;
}

/** Props of `PxNav`. Other `nav` props go to the root. */
export interface PxNavProps extends Omit<React.ComponentProps<"nav">, "children" | "defaultValue" | "onChange"> {
  /** The links, top to bottom. */
  items: readonly PxNavItem[];
  /** Controlled `href` of the current item. Use with `onValueChange`. */
  value?: string;
  /** `href` of the initially current item when uncontrolled. Defaults to the first item. */
  defaultValue?: string;
  /** Called with the `href` of the link the user clicked. */
  onValueChange?: (value: string) => void;
}

const NAV_ICONS: Record<PxNavIcon, readonly string[]> = {
  home: ["...#...", "..###..", ".#####.", "#######", ".#...#.", ".#.#.#.", ".#.#.#."],
  chat: ["#######", "#.....#", "#.#.#.#", "#.....#", "#######", ".#.....", "#......"],
  folder: ["###....", "#..####", "#.....#", "#.....#", "#.....#", "#.....#", "#######"],
  chart: ["......#", "....#.#", "....#.#", "..#.#.#", "..#.#.#", "#.#.#.#", "#######"],
  gear: ["..#.#..", ".#####.", "##...##", ".#.#.#.", "##...##", ".#####.", "..#.#.."],
  users: [".##..#.", "#..##.#", "#..##.#", ".##..#.", ".......", "####.##", "#..#.#."],
  bell: ["...#...", "..###..", ".#####.", ".#####.", ".#####.", "#######", "...#..."],
};

/**
 * Sidebar nav with pixel icons, count badges, a hover block that follows the pointer and keyboard focus,
 * and an active bar that slides to the current item.
 *
 * @example
 * <PxNav
 *   aria-label="Main"
 *   items={[
 *     { href: "#home", label: "Home", icon: "home" },
 *     { href: "#chats", label: "Chats", icon: "chat", badge: "3" },
 *   ]}
 * />
 */
export function PxNav({ items, value: valueProp, defaultValue, onValueChange, className, ...props }: PxNavProps) {
  const [value, setValue] = useControllableState({
    value: valueProp,
    defaultValue: defaultValue ?? items[0]?.href ?? "",
    onChange: onValueChange,
  });
  const [hovered, setHovered] = React.useState<string | null>(null);

  const linkRefs = React.useRef(new Map<string, HTMLAnchorElement>());
  const active = React.useRef<Spring | null>(null);
  const hover = React.useRef<Spring | null>(null);

  const { ref: canvasRef, redraw } = usePixelCanvas((frame) => {
    const { palette, delta, width, canvas } = frame;
    const reduced = prefersReducedMotion();
    const canvasTop = canvas.getBoundingClientRect().top;
    const top = (link: HTMLAnchorElement) => link.getBoundingClientRect().top - canvasTop;
    const step = (spring: Spring | null, target: number): Spring => {
      if (!spring || reduced) return { position: target, velocity: 0 };
      return springEuler(spring, target, delta, 320, 0.78);
    };
    let moving = false;
    frame.clear();

    const hoveredLink = hovered === null ? undefined : linkRefs.current.get(hovered);
    if (hoveredLink) {
      const target = top(hoveredLink);
      hover.current = step(hover.current, target);
      const y0 = hover.current.position;
      if (Math.abs(target - y0) > 0.3) moving = true;
      for (let y = y0 + 3; y < y0 + 34; y += 4) for (let x = 3; x < width - 3; x += 4) frame.dot(x, y, palette.foreground, 0.06, 2);
    } else {
      hover.current = null;
    }

    const activeLink = linkRefs.current.get(value);
    if (activeLink) {
      const target = top(activeLink);
      active.current = step(active.current, target);
      const y0 = active.current.position;
      if (Math.abs(target - y0) > 0.3) moving = true;
      for (let y = y0 + 3; y < y0 + 34; y += 4) for (let x = 3; x < width - 3; x += 4) frame.dot(x, y, palette.accent, 0.12, 2);
      for (let y = y0 + 8; y < y0 + 28; y += 3) frame.dot(0, y, palette.accent, 1, 2.4);
    }

    for (const item of items) {
      const link = linkRefs.current.get(item.href);
      if (!link) continue;
      const isActive = link === activeLink;
      const rowTop = top(link);
      const icon = item.icon ? NAV_ICONS[item.icon] : undefined;
      if (icon) {
        const y0 = rowTop + 18 - 7;
        icon.forEach((row, y) => {
          [...row].forEach((cell, x) => {
            if (cell === "#") frame.dot(12 + x * 2, y0 + y * 2, isActive ? palette.accent : palette.muted, isActive ? 1 : 0.8, 1.7);
          });
        });
      }
    }
    return moving;
  });

  React.useEffect(redraw, [items, value, hovered, redraw]);

  const enter = (href: string) => setHovered(href);
  const leave = (href: string) => setHovered((current) => (current === href ? null : current));

  return (
    <nav data-slot="px-nav" className={cn("relative grid gap-0.5", className)} {...props}>
      {items.map((item) => (
        <a
          key={item.href}
          ref={(node) => {
            if (node) linkRefs.current.set(item.href, node);
            else linkRefs.current.delete(item.href);
          }}
          href={item.href}
          aria-current={item.href === value ? "page" : undefined}
          className="group/link relative flex h-9 items-center rounded-lg pr-11 pl-[38px] text-[14px] leading-normal font-medium text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-lumesec aria-[current=page]:text-foreground"
          onClick={(event) => {
            // with a modifier key the browser opens or saves the link elsewhere, so the current item stays
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (item.href.startsWith("#")) event.preventDefault();
            setValue(item.href);
          }}
          onPointerEnter={() => enter(item.href)}
          onPointerLeave={() => leave(item.href)}
          onFocus={() => enter(item.href)}
          onBlur={() => leave(item.href)}
        >
          <span className="truncate">{item.label}</span>
          {item.badge ? (
            // above the canvas, so the hover and active blocks never tint it
            <span className="absolute top-2.5 right-2.5 z-[2] h-4 min-w-4 rounded-[3px] bg-destructive px-[5px] text-center font-mono text-[11px] leading-4 font-semibold text-white tabular-nums group-aria-[current=page]/link:bg-lumesec group-aria-[current=page]/link:text-lumesec-foreground">
              {item.badge}
            </span>
          ) : null}
        </a>
      ))}
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1] block size-full [image-rendering:pixelated]" />
    </nav>
  );
}
