/**
 * LumeSec Elements: fuzzy matching for search and command lists.
 */
import * as React from "react";

/** A match: higher `score` ranks first, `indices` are the matched character positions in the text. */
export interface FuzzyMatch {
  score: number;
  indices: number[];
}

/**
 * Match `query` against `text`, case-insensitively. A contiguous substring scores 100 minus its start
 * position; otherwise every query character must appear in order and the score drops with the span.
 * Returns null when the text does not match. An empty query matches everything with score 1.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  if (!needle) return { score: 1, indices: [] };
  const start = haystack.indexOf(needle);
  if (start >= 0) return { score: 100 - start, indices: Array.from({ length: needle.length }, (_, i) => start + i) };
  const indices: number[] = [];
  for (let i = 0, j = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) {
      indices.push(i);
      j++;
    }
  }
  if (indices.length !== needle.length) return null;
  return { score: 50 - (indices[indices.length - 1] - indices[0]), indices };
}

/** Render `text` with the characters at `indices` wrapped in `<mark>`. */
export function FuzzyHighlight({ text, indices, markClassName }: { text: string; indices: readonly number[]; markClassName?: string }) {
  if (indices.length === 0) return <>{text}</>;
  const marked = new Set(indices);
  const parts: React.ReactNode[] = [];
  let run = "";
  let runMarked = false;
  const flush = (key: number) => {
    if (!run) return;
    parts.push(runMarked ? <mark key={key} className={markClassName}>{run}</mark> : <React.Fragment key={key}>{run}</React.Fragment>);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const isMarked = marked.has(i);
    if (isMarked !== runMarked) {
      flush(i);
      runMarked = isMarked;
    }
    run += text[i];
  }
  flush(text.length);
  return <>{parts}</>;
}
