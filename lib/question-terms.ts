/**
 * Temporal/version qualifiers describe *which* version of a subject is being
 * asked about; they are not the subject itself. Without this distinction,
 * "the current Canadian prime minister" is matched against the electrical
 * dictionary entry for "current" instead of the prime-minister evidence.
 */
const QUALIFIERS = [
  "current", "latest", "recent", "present", "former", "upcoming",
  "new", "old", "main", "major",
] as const;
const QUALIFIER_PATTERN = new RegExp(`\\b(${QUALIFIERS.join("|")})\\b`, "g");

/**
 * Words that can follow a qualifier without becoming its subject. "What does
 * current mean?" must keep "current" as the headword, whereas "the current
 * Canadian prime minister" must drop it.
 */
const NON_SUBJECT = new Set([
  "a", "an", "the", "and", "or", "is", "am", "are", "was", "were", "be", "been",
  "do", "does", "did", "to", "of", "in", "on", "at", "for", "with", "from",
  "my", "your", "this", "that", "it", "its", "as", "so", "if", "about",
  "what", "why", "how", "when", "where", "who", "which", "can", "could",
  "would", "should", "will", "just", "please",
  "mean", "means", "meaning", "define", "definition", "describe", "explain",
  "show", "tell", "understand", "called", "known",
]);

/** Qualifiers that modify a following content word in this message. */
export function qualifierModifiers(text: string): Set<string> {
  const modifiers = new Set<string>();
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(QUALIFIER_PATTERN)) {
    const qualifier = match[1];
    const rest = lower.slice((match.index ?? 0) + match[0].length);
    const next = rest.match(/^[^\p{L}\p{N}]+([\p{L}]+)/u)?.[1];
    if (next && next !== qualifier && !NON_SUBJECT.has(next)) modifiers.add(qualifier);
  }
  return modifiers;
}

/** Drop modifier qualifiers from a term list, unless they are the only terms. */
export function withoutModifierWords(terms: string[], text: string): string[] {
  const modifiers = qualifierModifiers(text);
  if (!modifiers.size) return terms;
  const remaining = terms.filter((term) => !modifiers.has(term));
  return remaining.length || !terms.length ? remaining : terms;
}
