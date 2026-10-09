// Shared with the registry: components import `cn` from `@/lib/utils`, so this module imports nothing else
// from the site (scripts/verify.mjs bundles it on its own).
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and resolves conflicting Tailwind utilities (the shadcn helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `7` → `"07"`: section and list numbers. */
export const pad2 = (n: number) => String(n).padStart(2, "0");

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** `4` → `"four"` (up to ten, digits above); `capital` gives `"Four"`. For counts that change with the catalog. */
export function countWord(n: number, capital = false) {
  const word = NUMBER_WORDS[n] ?? String(n);
  return capital ? word[0].toUpperCase() + word.slice(1) : word;
}
