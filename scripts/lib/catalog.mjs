// Collections, shared modules and naming: the single source of truth for how the registry sources map onto
// the public catalog. Shared by the scripts in scripts/.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The repository root, so the scripts do not depend on the working directory. */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Parses a JSON file; a syntax error names the file. */
export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

/**
 * The public site. Generated sources (the React wrappers, usage snippets) link here, so they come out the same
 * wherever they are generated. Only the registry build reads NEXT_PUBLIC_SITE_URL, for self-hosted registries.
 */
export const SITE_URL = "https://elements.lumesec.ai";

export const COLLECTIONS = [
  {
    slug: "interaction",
    title: "Interaction",
    prefix: "ui-",
    summary: "Micro-interactions on everyday controls: send buttons, toggles, dials, meters.",
    description:
      "Ordinary controls with one considered motion each. The effect switches on for the state that matters and stays out of the way for the rest.",
  },
  {
    slug: "pixel-lab",
    title: "Pixel Lab",
    prefix: "px-",
    summary: "Components that live in a pixel lattice: meters, gauges, orbs, radars, AI moments.",
    description:
      "The visual is the data. Meters, gauges, clocks and model moments drawn on a 4 px lattice, with shine near the active edge.",
  },
  {
    slug: "pixel-ui",
    title: "Pixel UI",
    prefix: "px-",
    summary: "Form controls you can ship, each with one pixel detail.",
    description:
      "Text fields, selects, date pickers, toasts, tabs and charts as React components on your Tailwind theme. They submit with native forms and are keyboard complete, with a single pixel detail each.",
  },
  {
    slug: "pixel-hd",
    title: "Pixel HD",
    prefix: "hf-",
    summary: "Regular controls on a high-fidelity dot field with bloom and ordered dither.",
    description:
      "A fine dot grid with bloom and ordered dither behind regular controls. Numerals and labels are real text; the field reacts around them.",
  },
  {
    slug: "location",
    title: "Location",
    prefix: "geo-",
    summary:
      "Globes, maps and connection lines for locations, visitors, sign-ins, latency and traffic between regions.",
    description:
      "Where things happen and how they connect: dot globes, partial globes and flat maps drawn from an embedded world dataset, with no map tiles. The dots carry the motion; every label and number stays real text.",
  },
];

/** Shared modules in registry/lib/lumesec: [title, description]. Engines back the custom elements. */
export const LIB_MODULES = {
  math: ["Math helpers", "Clamp, lerp, easing, hashing and RGB colour helpers."],
  color: [
    "Theme colours",
    "Resolves theme CSS variables (any colour format) to RGB for canvas drawing and repaints on theme changes.",
  ],
  motion: [
    "Motion hooks",
    "Reduced motion, in-view detection, an off-screen-aware animation loop, lazy refs, springs and shake.",
  ],
  canvas: [
    "Canvas sizing",
    "Device-pixel-ratio aware canvas sizing, pixel snapping and pointer positions in CSS pixels.",
  ],
  "pixel-canvas": ["Pixel canvas", "The canvas loop behind the Pixel UI components."],
  "pixel-font": ["Pixel font", "The 5x7 pixel font and bitmap helpers."],
  sparks: ["Sparks", "Square pixel sparks, in a canvas or as a one-off burst over a component."],
  ticker: [
    "Shared ticker",
    "One shared animation frame for every animated component, with timed waits for loops that draw at a lower rate.",
  ],
  "roll-text": ["Rolling text", "Text that rolls over a horizontal axis when it changes."],
  "use-controllable-state": [
    "Controllable state",
    "State that can be controlled or uncontrolled, like a native input.",
  ],
  data: [
    "Data inputs",
    "Reads and validates the JSON `data` attribute and property that custom elements take for your records.",
  ],
  fuzzy: ["Fuzzy match", "Fuzzy matching and match highlighting for search and command lists."],
  geo: [
    "Geo helpers",
    "Map and globe projections, great-circle lines, rotation and dot lattices for the Location components.",
  ],
  "geo-data": [
    "Geo data and text",
    "Time zones, coordinate, distance and IP parsing and formatting, demo cities and regions, and seeded randomness for the Location components.",
  ],
  "geo-world": [
    "World data",
    "An embedded land mask at 0.5° and simplified coastlines (Natural Earth, public domain).",
  ],
  "geo-countries": [
    "Country data",
    "ISO codes, names, regions, label points and simplified outlines of 175 countries (Natural Earth).",
  ],
  react: [
    "React bindings",
    "Renders LumeSec custom elements from React 19, wires their custom events and composes refs.",
  ],
  pixel: [
    "Pixel engine",
    "Runtime for the Pixel Lab and Pixel HD custom elements: theme tokens, base element, animation loop, drawing helpers.",
  ],
};

/** Engines are registry items named lumesec-engine-*; other modules lumesec-*. */
export const ENGINES = new Set(["pixel"]);
export const libItemName = (name) => (ENGINES.has(name) ? `lumesec-engine-${name}` : `lumesec-${name}`);

/** `hf-split-flap` → `HfSplitFlap` (component and event prop names). */
export function pascal(name) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

/** `max-value` → `maxValue` (React prop names of attributes). */
export function camel(name) {
  const p = pascal(name);
  return p[0].toLowerCase() + p.slice(1);
}
