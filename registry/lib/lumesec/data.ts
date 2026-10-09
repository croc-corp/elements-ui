/**
 * LumeSec Elements: data inputs of the custom elements.
 *
 * Elements that show records (series, rows, certificates, rules) take them as a `data` property or as JSON
 * in the `data` attribute; the React wrappers serialise arrays and objects to that attribute. Without data
 * an element shows its sample data, which is invented and only meant for previews.
 */

const warned = new WeakSet<Element>();

/**
 * The parsed JSON of attribute `name`, or `null` when it is missing. Invalid JSON also gives `null` and a
 * console warning (once per element), so the element falls back to its sample data instead of breaking.
 */
export function readJson(el: Element, name = "data"): unknown {
  const text = el.getAttribute(name);
  if (text === null || text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    if (!warned.has(el)) {
      warned.add(el);
      console.warn(`<${el.localName}>: the ${name} attribute is not valid JSON; showing sample data.`);
    }
    return null;
  }
}

/**
 * True for an object that is not an array or `null`: a record parsed from JSON. Read the fields you need from it by
 * name; never merge it into another object.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A finite number, or `fallback`. Numeric strings count, so JSON from a CSV export works. */
export function finite(value: unknown, fallback: number): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** A string, or `fallback`. Numbers are converted. */
export const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;

/** A `Date` from a `Date`, an ISO string or epoch milliseconds; `null` when it does not parse. */
export function toDate(value: unknown): Date | null {
  const d =
    value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  return d && Number.isFinite(d.getTime()) ? d : null;
}

/** Normalises each entry of an array with `parse`, dropping entries it rejects (`null`). Not an array gives `null`. */
export function rows<T>(value: unknown, parse: (entry: unknown, index: number) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  value.forEach((entry, i) => {
    const row = parse(entry, i);
    if (row !== null) out.push(row);
  });
  return out;
}
