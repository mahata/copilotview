export interface Snippet {
  text: string;
  /** Character ranges within `text` that matched a search term. */
  ranges: [number, number][];
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(content: string, limit: number): Snippet {
  const text = content.slice(0, limit);
  return { text: text.length < content.length ? `${text}…` : text, ranges: [] };
}

/**
 * Builds a short excerpt centred on the first matching term, marking every term
 * occurrence inside the excerpt. Done in JS rather than with FTS5 `snippet()`
 * so terms matched through the LIKE fallback are highlighted too.
 */
export function makeSnippet(content: string, terms: string[], radius = 90): Snippet {
  const usable = terms.filter((t) => t.length > 0);
  if (usable.length === 0) return truncate(content, radius * 2);

  const pattern = new RegExp(usable.map(escapeRegExp).join("|"), "giu");
  const matches = [...content.matchAll(pattern)];
  if (matches.length === 0) return truncate(content, radius * 2);

  const first = matches[0]!.index;
  const start = Math.max(0, first - radius);
  const end = Math.min(content.length, first + radius);
  const prefix = start > 0 ? "…" : "";
  const text = prefix + content.slice(start, end) + (end < content.length ? "…" : "");

  const ranges: [number, number][] = [];
  for (const match of matches) {
    const from = match.index;
    const to = from + match[0].length;
    if (from >= start && to <= end) {
      ranges.push([from - start + prefix.length, to - start + prefix.length]);
    }
  }
  return { text, ranges };
}
