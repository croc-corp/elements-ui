/**
 * LumeSec Elements: the 5x7 pixel font and the bitmap icons of the Pixel UI components (check marks, alerts and
 * status icons). The font draws pixel lettering on a canvas; the components themselves show text as real,
 * selectable text. Pure; safe on the server.
 */
import type { ThemeColorName } from "@/lib/lumesec/color";
import { rgba, type RGB } from "@/lib/lumesec/math";

/** Glyph rows, top to bottom, `1` for a lit pixel. Lower-case input is drawn upper-case. */
export const PIXEL_FONT: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11100 10010 10001 10001 10001 10010 11100",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 10001 01010 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110",
  "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010",
  "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110",
  "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  " ": "00000 00000 00000 00000 00000 00000 00000",
  ".": "00000 00000 00000 00000 00000 01100 01100",
  ":": "00000 01100 01100 00000 01100 01100 00000",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  "/": "00000 00001 00010 00100 01000 10000 00000",
  "·": "00000 00000 00000 01100 01100 00000 00000",
  "%": "11000 11001 00010 00100 01000 10011 00011",
  "+": "00000 00100 00100 11111 00100 00100 00000",
  ">": "01000 00100 00010 00001 00010 00100 01000",
  "<": "00010 00100 01000 10000 01000 00100 00010",
  "!": "00100 00100 00100 00100 00100 00000 00100",
  "?": "01110 10001 00001 00010 00100 00000 00100",
  ",": "00000 00000 00000 00000 01100 00100 01000",
  "'": "00100 00100 01000 00000 00000 00000 00000",
  "#": "01010 11111 01010 01010 11111 01010 00000",
  "=": "00000 00000 11111 00000 11111 00000 00000",
  "*": "00000 10101 01110 11111 01110 10101 00000",
  "(": "00010 00100 01000 01000 01000 00100 00010",
  ")": "01000 00100 00010 00010 00010 00100 01000",
  "▲": "00000 00100 01110 11111 00000 00000 00000",
  "▼": "00000 11111 01110 00100 00000 00000 00000",
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const glyphCache = new Map<string, string[]>();

/** The seven rows of a character. Unknown characters render as a space. */
export function glyph(character: string): string[] {
  let rows = glyphCache.get(character);
  if (!rows) {
    rows = (PIXEL_FONT[character] ?? PIXEL_FONT[" "]).split(" ");
    glyphCache.set(character, rows);
  }
  return rows;
}

/** Width in CSS pixels of `text` at `scale` pixels per font pixel, with `gap` font pixels between glyphs. */
export const pixelTextWidth = (text: string, scale: number, gap = 1) =>
  Math.max(0, text.length * (GLYPH_WIDTH + gap) * scale - gap * scale);

/**
 * Draw `text` in the pixel font with its top-left at `(x, y)`. `fill` is the share of each cell that is
 * painted, which leaves the hairline gaps that make the type read as pixels.
 */
export function drawPixelText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: RGB,
  alpha = 1,
  gap = 1,
  fill = 0.82,
) {
  context.fillStyle = rgba(color);
  context.globalAlpha = alpha;
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const rows = glyph(character);
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      for (let column = 0; column < GLYPH_WIDTH; column++) {
        if (rows[row][column] !== "1") continue;
        context.fillRect(cursor + column * scale, y + row * scale, scale * fill, scale * fill);
      }
    }
    cursor += (GLYPH_WIDTH + gap) * scale;
  }
  context.globalAlpha = 1;
}

/** A point `[x, y]` in pixels. */
export type PixelPoint = [x: number, y: number];

/** Lit pixel positions of `text` in the pixel font at `scale`, relative to the top-left corner. */
export function pixelTextPoints(text: string, scale: number, gap = 1): PixelPoint[] {
  const points: PixelPoint[] = [];
  let cursor = 0;
  for (const character of text.toUpperCase()) {
    const rows = glyph(character);
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      for (let column = 0; column < GLYPH_WIDTH; column++) {
        if (rows[row][column] === "1") points.push([cursor + column * scale, row * scale]);
      }
    }
    cursor += (GLYPH_WIDTH + gap) * scale;
  }
  return points;
}

/** Lit cells of an ASCII bitmap where `#` is on: `bitmap(["#.", ".#"])` is `[[0, 0], [1, 1]]`. */
export function bitmap(rows: readonly string[]): PixelPoint[] {
  const points: PixelPoint[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === "#") points.push([x, y]);
    });
  });
  return points;
}

/** The small pixel check mark used by checkboxes, choices and buttons. */
export const SMALL_CHECK = bitmap(["......#", ".....#.", "#...#..", ".#.#...", "..#...."]);

/** The small pixel exclamation mark that buttons and fields show next to an error: an icon, not text. */
export const SMALL_ALERT = bitmap(["#", "#", "#", "#", "#", ".", "#"]);

/** Tone of a status message (toasts, alerts): picks its pixel icon and colour. */
export type StatusTone = "info" | "success" | "warning" | "error";

/** 7x7 pixel icons for status messages, keyed by tone. */
export const STATUS_ICONS: Readonly<Record<StatusTone, PixelPoint[]>> = {
  info: bitmap(["...#...", ".......", "..##...", "...#...", "...#...", "...#...", "..###.."]),
  success: bitmap([".......", "......#", ".....#.", "#...#..", ".#.#...", "..#....", "......."]),
  error: bitmap(["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"]),
  warning: bitmap(["...#...", "...#...", "...#...", "...#...", "...#...", ".......", "...#..."]),
};

/** The palette colour (a `Palette` key from `@/lib/lumesec/color`) each status tone draws in. */
export const STATUS_COLORS = {
  info: "accent",
  success: "success",
  error: "destructive",
  warning: "warning",
} as const satisfies Record<StatusTone, ThemeColorName>;
