import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { site } from "@/config/site";
import { totalComponents } from "@/lib/catalog";

const W = 1200;
const H = 630;
const RAIL = 64;

const C = {
  bg: "#09090b",
  fg: "#fafafa",
  muted: "#9f9fa9",
  line: "#27272a",
  dot: "#1c1c20",
  electric: "#8654fb",
};

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 500; style: "normal" }[]> | null = null;
function loadFonts() {
  fonts ??= Promise.all([
    readFile(join(process.cwd(), "src/assets/fonts/Geist-Regular.ttf")).then((data) => ({ name: "Geist", data, weight: 400 as const, style: "normal" as const })),
    readFile(join(process.cwd(), "src/assets/fonts/Geist-Medium.ttf")).then((data) => ({ name: "Geist", data, weight: 500 as const, style: "normal" as const })),
    readFile(join(process.cwd(), "src/assets/fonts/GeistMono-Regular.ttf")).then((data) => ({ name: "Geist Mono", data, weight: 400 as const, style: "normal" as const })),
  ]);
  return fonts;
}

/** 7×7 motifs per collection, drawn as dots on the right of the card. */
const MOTIFS: Record<string, string[]> = {
  interaction: ["0000000", "0000000", "1111111", "1000011", "1111111", "0000000", "0000000"],
  "pixel-lab": ["1010101", "0101010", "1010101", "0101010", "1010101", "0101010", "1010101"],
  "pixel-ui": ["1111111", "1000001", "1011101", "1000001", "1111111", "0000000", "0011100"],
  "pixel-hd": ["0011100", "0111110", "1111111", "1111111", "1111111", "0111110", "0011100"],
  location: ["0011100", "0100110", "1001111", "1000111", "1100001", "0110010", "0011100"],
  default: ["1000001", "0100010", "0010100", "0001000", "0010100", "0100010", "1000001"],
};

const MARK_PATHS = [
  "M0.408654 80.4891C-0.15613 80.8684 -0.159018 81.4974 0.547756 81.747C0.737537 81.8141 0.935505 81.8735 1.14097 81.9249C9.19351 83.9384 39.8218 89.683 58.4486 77.1724L80.6146 62.2848C82.4633 61.0432 82.8394 59.1274 81.5322 57.6112L65.218 38.6897C64.742 38.1376 63.6118 38.0393 62.9386 38.4914L56.8676 42.5689C56.4094 42.8767 56.3126 43.3506 56.6308 43.7286L68.3009 57.5916C68.93 58.3468 68.6523 59.3452 67.7392 59.9585L50.2487 71.7058C44.0562 75.865 35.6422 77.2031 26.6312 76.9928C20.3151 76.8453 13.8243 76.3456 9.70017 75.494C8.97887 75.345 8.10795 75.3179 7.57458 75.6761L0.408654 80.4891Z",
  "M19.3029 31.634C19.8689 31.2566 20.3278 31.5022 20.3278 32.1825L20.3278 65.1939C20.3278 65.8743 19.8689 66.7317 19.3029 67.1091L10.2659 73.1338C9.6998 73.5112 9.2409 73.2656 9.2409 72.5852L9.2409 39.5738C9.2409 38.8935 9.6998 38.036 10.2659 37.6586L19.3029 31.634Z",
  "M36.5492 0.177086C37.1153 -0.200303 37.5742 0.0452932 37.5742 0.725641V53.6964C37.5742 54.3768 37.1153 55.2343 36.5492 55.6117L27.5123 61.6362C26.9463 62.0136 26.4874 61.768 26.4874 61.0876L26.4874 8.11684C26.4874 7.43649 26.9463 6.57902 27.5124 6.20163L36.5492 0.177086Z",
  "M53.7955 3.18262C54.3616 2.80523 54.8205 3.05082 54.8205 3.73117V42.1989C54.8205 42.8792 54.3616 43.7367 53.7955 44.1141L44.7585 50.1387C44.1925 50.5161 43.7336 50.2705 43.7336 49.5901V11.1224C43.7336 10.4421 44.1925 9.58463 44.7585 9.20724L53.7955 3.18262Z",
];

/** The text of one card. */
export type OgInput = {
  /** Mono line above the title. */
  eyebrow: string;
  title: string;
  /** Cut to about 150 characters. */
  description?: string;
  /** A collection slug; other values get the default motif. */
  motif?: string;
  /** Mono text at the bottom right, such as the install command. */
  footer?: string;
};

/** Keep to glyphs Geist ships, so the renderer never fetches a fallback font. */
const clean = (s?: string) =>
  s
    ?.replace(/⌘/g, "Cmd")
    .replace(/[⇧]/g, "Shift")
    .replace(/[⌥]/g, "Alt")
    .replace(/[^ -ɏ‐-‧←-↓·]/g, "");

/** A 1200×630 Open Graph card in the Screen Line style, with the bundled Geist fonts. */
export async function renderOg(input: OgInput) {
  const eyebrow = clean(input.eyebrow) ?? "";
  const title = clean(input.title) ?? "";
  const description = clean(input.description);
  const footer = clean(input.footer);
  const motif = input.motif ?? "default";
  const grid = MOTIFS[motif] ?? MOTIFS.default;
  const titleSize = title.length > 28 ? 64 : title.length > 18 ? 78 : 92;
  const desc = description && description.length > 150 ? `${description.slice(0, 147).replace(/\s+\S*$/, "")}…` : description;

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative", background: C.bg, color: C.fg, fontFamily: "Geist" }}>
        {/* rails and hairlines */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: RAIL, width: 1, background: C.line }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, right: RAIL, width: 1, background: C.line }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: 96, height: 1, background: C.line }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 84, height: 1, background: C.line }} />
        {/* hatch in the bottom band */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 84,
            backgroundImage: `repeating-linear-gradient(315deg, ${C.dot} 0px, ${C.dot} 1px, transparent 1px, transparent 9px)`,
          }}
        />

        {/* header */}
        <div style={{ position: "absolute", left: RAIL + 40, right: RAIL + 40, top: 0, height: 96, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="30" height="31" viewBox="0 0 83 85" fill={C.fg}>
              {MARK_PATHS.map((d) => (
                <path key={d.slice(0, 12)} d={d} />
              ))}
            </svg>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5 }}>Elements</span>
              <span style={{ fontFamily: "Geist Mono", fontSize: 12, color: C.muted, marginTop: 2 }}>by LumeSec Technologies</span>
            </div>
          </div>
          <span style={{ fontFamily: "Geist Mono", fontSize: 16, color: C.muted }}>{new URL(site.url).host}</span>
        </div>

        {/* body */}
        <div style={{ position: "absolute", left: RAIL + 40, top: 140, width: 720, display: "flex", flexDirection: "column" }}>
          <span style={{ fontFamily: "Geist Mono", fontSize: 18, color: C.muted }}>{eyebrow}</span>
          <span style={{ marginTop: 22, fontSize: titleSize, fontWeight: 500, letterSpacing: -titleSize * 0.05, lineHeight: 1 }}>{title}</span>
          {desc && <span style={{ marginTop: 26, fontSize: 25, lineHeight: 1.45, color: C.muted }}>{desc}</span>}
        </div>

        {/* dot motif */}
        <div style={{ position: "absolute", right: RAIL + 48, top: 168, display: "flex", flexDirection: "column", gap: 14 }}>
          {grid.map((row, j) => (
            <div key={j} style={{ display: "flex", gap: 14 }}>
              {row.split("").map((v, i) => (
                <div
                  key={i}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 3,
                    background: v === "1" ? ((i + j) % 5 === 0 ? C.electric : C.fg) : C.dot,
                    opacity: v === "1" ? 0.92 : 1,
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        {/* footer */}
        <div style={{ position: "absolute", left: RAIL + 40, right: RAIL + 40, bottom: 0, height: 84, display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "Geist Mono", fontSize: 17, color: C.muted }}>
          <span>{totalComponents} components · shadcn registry · MIT</span>
          {footer && <span style={{ color: C.fg }}>{footer}</span>}
        </div>
      </div>
    ),
    { width: W, height: H, fonts: await loadFonts() },
  );
}
