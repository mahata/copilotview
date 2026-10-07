/**
 * The trigram tokenizer cannot index a term shorter than 3 characters, which
 * rules out many short Japanese words. Such terms fall back to a
 * LIKE scan, which is acceptable because the corpus is a few thousand rows.
 */
export const MIN_TRIGRAM_LENGTH = 3;

export interface ParsedQuery {
  /** Every term, in the order the user typed them. Used for highlighting. */
  terms: string[];
  /** Terms long enough for the trigram index. */
  ftsTerms: string[];
  /** Terms that must be matched with LIKE instead. */
  likeTerms: string[];
  /** FTS5 MATCH expression, or null when no term is long enough. */
  match: string | null;
}

function splitTerms(input: string): string[] {
  const terms: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const term = (match[1] ?? match[2] ?? "").trim();
    if (term.length > 0) terms.push(term);
  }
  return terms;
}

export function parseQuery(input: string): ParsedQuery | null {
  const terms = splitTerms(input);
  if (terms.length === 0) return null;
  const ftsTerms = terms.filter((t) => t.length >= MIN_TRIGRAM_LENGTH);
  const likeTerms = terms.filter((t) => t.length < MIN_TRIGRAM_LENGTH);
  return {
    terms,
    ftsTerms,
    likeTerms,
    // Quoting every term keeps accidental FTS5 operators (-, *, NEAR) literal.
    match: ftsTerms.length > 0 ? ftsTerms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ") : null,
  };
}

/** Escapes a LIKE pattern so wildcards typed by the user stay literal. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
