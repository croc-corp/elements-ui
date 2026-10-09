import type { SVGProps } from "react";

/** SVG props plus `size` in px (16 by default). The icons are decorative: aria-hidden. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** The shared frame of the line icons: a 16 px grid, 1.4 px round strokes in the current colour. */
function base({ size = 16, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3 3" />
  </svg>
);
export const CopyIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" />
    <path d="M10.75 5.25V4a1.25 1.25 0 0 0-1.25-1.25H4A1.25 1.25 0 0 0 2.75 4v5.5A1.25 1.25 0 0 0 4 10.75h1.25" />
  </svg>
);
export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m3.25 8.5 3 3 6.5-7" />
  </svg>
);
export const ArrowRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 8H3M7 4 3 8l4 4" />
  </svg>
);
export const ArrowUpRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 11 11 5M6 5h5v5" />
  </svg>
);
export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
  </svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6.25 4.5 3.5 3.5-3.5 3.5" />
  </svg>
);
export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </svg>
);
export const MoonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85Z" />
  </svg>
);
export const MonitorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.75" width="12" height="8.5" rx="1.5" />
    <path d="M5.5 13.75h5M8 11.25v2.5" />
  </svg>
);
export const MenuIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.75 5h10.5M2.75 11h10.5" />
  </svg>
);
export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);
export const TerminalIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m3.5 5 3 3-3 3M8.5 11h4" />
  </svg>
);
export const ReplayIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77" />
    <path d="M2.75 2.75v3h3" />
  </svg>
);
export const ExpandIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9.5 2.75h3.75V6.5M6.5 13.25H2.75V9.5M13.25 2.75 9 7M2.75 13.25 7 9" />
  </svg>
);
export const ThumbUpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5.25 7.25 7.5 2.5a1.5 1.5 0 0 1 1.5 1.5v2.25h3.1a1.25 1.25 0 0 1 1.23 1.47l-.8 4.5a1.25 1.25 0 0 1-1.23 1.03H5.25M5.25 7.25v6M5.25 7.25h-2v6h2" />
  </svg>
);
export const ThumbDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10.75 8.75 8.5 13.5A1.5 1.5 0 0 1 7 12V9.75H3.9a1.25 1.25 0 0 1-1.23-1.47l.8-4.5A1.25 1.25 0 0 1 4.7 2.75h6.05M10.75 8.75v-6M10.75 8.75h2v-6h-2" />
  </svg>
);
export const PencilIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10.5 2.75 13.25 5.5 6 12.75H3.25V10L10.5 2.75Z" />
  </svg>
);
export const FlagIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.25 14V2.75M3.25 3h8l-1.5 3 1.5 3h-8" />
  </svg>
);
export const FileIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 1.75H4.25a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V6L9 1.75Z" />
    <path d="M9 1.75V6h4.25" />
  </svg>
);
export const MarkdownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
    <path d="M4.25 10.25v-4.5l1.75 2 1.75-2v4.5M10.75 5.75v4.5M9.25 8.75l1.5 1.5 1.5-1.5" />
  </svg>
);
export const BookIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.75 3.25h3.5a1.75 1.75 0 0 1 1.75 1.75v8.25a1.5 1.5 0 0 0-1.5-1.5H2.75V3.25ZM13.25 3.25h-3.5A1.75 1.75 0 0 0 8 5v8.25a1.5 1.5 0 0 1 1.5-1.5h3.75V3.25Z" />
  </svg>
);
export const GridIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1" />
    <rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1" />
    <rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1" />
    <rect x="9.25" y="9.25" width="4.5" height="4.5" rx="1" />
  </svg>
);
export const LayersIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m8 2.25 5.75 3L8 8.25l-5.75-3L8 2.25Z" />
    <path d="m2.25 8 5.75 3 5.75-3M2.25 10.75l5.75 3 5.75-3" />
  </svg>
);
export const WidthIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.25 3v10M13.75 3v10M4.75 8h6.5M6.25 6.25 4.5 8l1.75 1.75M9.75 6.25 11.5 8l-1.75 1.75" />
  </svg>
);

export const GitHubIcon = ({ size = 16, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden {...props}>
    <path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 .2Z" />
  </svg>
);

/** The glyph of a collection, by slug; unknown slugs get the grid icon. */
export const CollectionGlyph = ({ slug, size = 16, ...props }: IconProps & { slug: string }) => {
  const b = base({ size, ...props });
  switch (slug) {
    case "interaction":
      return (
        <svg {...b}>
          <rect x="2" y="5.25" width="12" height="5.5" rx="2.75" />
          <circle cx="10.75" cy="8" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pixel-lab":
      return (
        <svg {...b} stroke="none" fill="currentColor">
          {[3, 6.5, 10].flatMap((x) =>
            [3, 6.5, 10].map((y) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="2.5" height="2.5" rx="0.4" opacity={x + y > 12 ? 1 : 0.45} />
            )),
          )}
        </svg>
      );
    case "pixel-ui":
      return (
        <svg {...b}>
          <rect x="2" y="4" width="12" height="8" rx="2" />
          <path d="M5 8h4" />
          <rect x="10.5" y="7" width="2" height="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pixel-hd":
      return (
        <svg {...b} stroke="none" fill="currentColor">
          {Array.from({ length: 25 }, (_, i) => {
            const x = 2.5 + (i % 5) * 2.75;
            const y = 2.5 + Math.floor(i / 5) * 2.75;
            const d = Math.hypot(x - 8, y - 8);
            return <circle key={i} cx={x} cy={y} r={d < 3 ? 0.95 : d < 5 ? 0.7 : 0.45} />;
          })}
        </svg>
      );
    case "location":
      return (
        <svg {...b}>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M2.25 8h11.5M8 2.25c-2.2 2.4-2.2 9.1 0 11.5M8 2.25c2.2 2.4 2.2 9.1 0 11.5" opacity="0.55" />
          <circle cx="10.6" cy="5.6" r="1.25" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return <GridIcon size={size} {...props} />;
  }
};
