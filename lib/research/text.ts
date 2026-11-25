/** Pure text helpers shared by the server (fetch/parse) and browser (rank/synthesise). */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", middot: "·",
  laquo: "«", raquo: "»", copy: "©", reg: "®", trade: "™", deg: "°", times: "×", divide: "÷",
};

/** Decode the small set of HTML/XML entities that appear in feeds and article text. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try { return String.fromCodePoint(code); } catch { return ""; }
}

/** Remove characters that can hide instructions or break layout, without changing meaning. */
export function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DROP_BLOCKS = /<(script|style|noscript|svg|iframe|object|embed|form|nav|footer|header|aside|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK_TAGS = /<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote|pre|table|br|hr)\s*>|<br\s*\/?>/gi;

interface ExtractedHtml { title: string; text: string }

/**
 * Extract readable text from an HTML document. This is a pure string transform:
 * no scripts are ever executed and no downloaded code is evaluated.
 */
export function htmlToText(html: string, maxChars = 16000): ExtractedHtml {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = cleanText(decodeEntities(stripTags(titleMatch?.[1] ?? ""))).slice(0, 200);
  let text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(DROP_BLOCKS, " ")
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(BLOCK_TAGS, "\n")
    .replace(/<[^>]*>/g, " ");
  text = cleanText(decodeEntities(text));
  // Collapse the newlines introduced above into sentence-friendly spacing.
  text = text.replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  if (text.length > maxChars) text = `${text.slice(0, maxChars).trimEnd()} …`;
  return { title, text };
}

export function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

/** Pull text out of a single XML element (RSS/Atom), tolerating namespaces and CDATA. */
export function xmlText(block: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<(?:[\\w-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escaped}\\s*>`, "i"));
  if (!match) return "";
  const raw = match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return cleanText(decodeEntities(stripTags(raw)));
}

export function xmlAttribute(block: string, tag: string, attribute: string): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedAttr = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<(?:[\\w-]+:)?${escapedTag}\\b[^>]*\\b${escapedAttr}\\s*=\\s*["']([^"']+)["'][^>]*>`, "i"));
  return match ? cleanText(decodeEntities(match[1])) : "";
}

export function xmlBlocks(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escaped}\\s*>`, "gi"))].map((m) => m[0]);
}

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "all", "am", "an", "and", "any", "are", "as", "at", "be",
  "because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "could", "did",
  "do", "does", "doing", "down", "during", "each", "few", "for", "from", "further", "had", "has", "have",
  "having", "he", "her", "here", "hers", "herself", "him", "himself", "his", "how", "i", "if", "in",
  "into", "is", "it", "its", "itself", "just", "me", "more", "most", "my", "myself", "no", "nor", "not",
  "now", "of", "off", "on", "once", "only", "or", "other", "our", "ours", "out", "over", "own", "s", "same",
  "she", "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves",
  "then", "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "very",
  "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will", "with",
  "would", "you", "your", "yours", "please", "tell", "explain", "show", "find", "give", "want", "know",
  "latest", "news", "today", "current", "recent", "update", "updates", "developments",
]);

export function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [])
    .map((word) => word.replace(/^['-]+|['-]+$/g, ""))
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/** Frequency-ranked content words, used for queries and relevance scoring. */
export function keywords(value: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const word of tokenize(value)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

/** Split retrieved text into quotable sentences. */
export function sentences(value: string, min = 45, max = 420): string[] {
  return (value.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/g))
    .map((part) => cleanText(part))
    .filter((part) => part.length >= min && part.length <= max && /[a-z]{3}/i.test(part))
    .slice(0, 80);
}

/** Overlap score between a sentence and the question keywords (0..1). */
export function relevance(sentence: string, terms: string[]): number {
  if (!terms.length) return 0;
  const words = new Set(tokenize(sentence));
  let hits = 0;
  for (const term of terms) if (words.has(term) || words.has(term.replace(/s$/, ""))) hits += 1;
  return hits / Math.max(1, Math.min(terms.length, 6));
}

export function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item).toLowerCase().replace(/\W+/g, "").slice(0, 90);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** Small bonus for sentences that state a direct fact ("is Paris", "was founded ..."). */
export function answerPatternBonus(text: string): number {
  if (/\b(?:is|are|was|were|became|lies|equals)\s+[A-Z][a-z]+/.test(text)) return 0.28;
  if (/\b(?:is|are|was|were|has|have)\b/.test(text) && text.length < 240) return 0.1;
  return 0;
}

export interface FactQuestion {
  kind: "capital" | "person";
  /** Display form of the subject, e.g. "France" or "Canadian". */
  label: string;
  /** Office or title being asked about, e.g. "prime minister". */
  role?: string;
  /** Content words that must appear in a sentence before it can answer this question. */
  required: string[];
}

const CAPITAL_SUBJECT = /\bcapital\s+(?:city\s+)?of\s+(?:the\s+)?([\p{L}][\p{L}\s'-]{1,60})/iu;
const PERSON_OF = /\b(prime minister|president|chancellor|king|queen|mayor)\b\s+of\s+(?:the\s+)?([\p{L}][\p{L}\s'-]{1,60})/iu;
const PERSON_ADJ = /\b([\p{Lu}][\p{L}]+)\s+(prime minister|president|chancellor|king|queen|mayor)\b/u;

/**
 * Recognise the small set of single-value factual questions where the right
 * answer is one short phrase, not a paragraph of related facts. Anything else
 * falls back to ordinary sentence extraction.
 */
export function detectFactQuestion(question: string): FactQuestion | null {
  const clean = question.trim().replace(/[?.!]+$/, "");
  const capital = clean.match(CAPITAL_SUBJECT);
  if (capital?.[1]) {
    const label = capital[1].trim().replace(/^(?:the|what|which)\s+/i, "");
    const subject = tokenize(label);
    if (subject.length) {
      return { kind: "capital", label: label.charAt(0).toUpperCase() + label.slice(1), required: ["capital", ...new Set(subject)] };
    }
  }

  // Only present-tense "who is" questions are single-value office-holder
  // questions. Historical/former-office questions need full sentences.
  const asksCurrentPerson = /^(?:who(?:'s| is)|what(?:'s| is)|name the|identify the)\b/i.test(clean)
    && !/\b(was|were|former|previous|historical|first|last|in\s+\d{4})\b/i.test(clean);
  if (!asksCurrentPerson) return null;

  const personOf = clean.match(PERSON_OF);
  if (personOf?.[2]) {
    const role = personOf[1].toLowerCase();
    const label = personOf[2].trim().replace(/^(?:the|what|which)\s+/i, "");
    const subject = tokenize(label);
    if (subject.length) {
      return { kind: "person", role, label: label.charAt(0).toUpperCase() + label.slice(1), required: [...tokenize(role), ...new Set(subject)] };
    }
  }

  const personAdj = clean.match(PERSON_ADJ);
  if (personAdj?.[1] && personAdj[2]) {
    const role = personAdj[2].toLowerCase();
    return { kind: "person", role, label: personAdj[1], required: [...tokenize(role), personAdj[1].toLowerCase()] };
  }
  return null;
}

/** Pull the named capital out of a real source sentence, without inventing one. */
export function extractCapital(sentence: string): string | null {
  if (/\bcapital\s+(?:punishment|gains?|crimes?|expenditure|allocation|investment)\b/i.test(sentence)) return null;
  const appositive = sentence.match(/\bcapital\s+of\s+[A-Z][\p{L}]+\s*,\s*([A-Z][\p{L}][\p{L}'’-]*)/u);
  if (appositive?.[1]) return appositive[1];
  const capitalIs = sentence.match(/\bcapital(?:\s+city)?\b[^.?!]{0,100}?\bis\s+(?:the\s+)?([A-Z][\p{L}][\p{L}'’-]*)/u);
  if (capitalIs?.[1] && capitalIs[1].length > 1) return capitalIs[1];
  const isCapital = sentence.match(/\b([A-Z][\p{L}][\p{L}'’-]*)\b[^.?!]{0,24}?\bis\s+(?:the\s+)?capital\b/u);
  return isCapital?.[1] && isCapital[1].length > 1 ? isCapital[1] : null;
}

const PERSON_NAME = "[A-Z][\\p{L}]+(?:\\s+[A-Z][\\p{L}]+){0,2}";

/** Pull the named office-holder out of a real source sentence. */
export function extractPerson(sentence: string, role: string): string | null {
  const office = role.replace(/\s+/g, "\\s+");
  const named = new RegExp(`\\b(${PERSON_NAME})\\b[^.?!]{0,40}?\\bis\\s+(?:the\\s+)?(?:current\\s+)?${office}\\b`, "u");
  const match = sentence.match(named);
  if (match?.[1] && !/^(?:the|a|this|that)$/i.test(match[1])) return match[1];
  const reversed = new RegExp(`\\b${office}\\b[^.?!]{0,40}?\\bis\\s+(${PERSON_NAME})\\b`, "u");
  const other = sentence.match(reversed);
  return other?.[1] && !/^(?:the|a|this|that)$/i.test(other[1]) ? other[1] : null;
}

/** Local, deterministic similarity used to compare source claims and avoid duplicates. */
export function overlap(left: string, right: string): number {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.max(a.size, b.size);
}
