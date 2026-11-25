import type { ChatContextSource } from "./chat";
import { withoutModifierWords } from "./question-terms";
import type { Dataset, KnowledgeEntry } from "./types";

export interface RagDocument {
  id: string;
  title: string;
  type: "dataset" | "knowledge";
  category?: string;
  content: string;
}

export interface RagChunk {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: "dataset" | "knowledge";
  text: string;
  score: number;
}

export interface RetrievalResult {
  chunks: RagChunk[];
  sources: ChatContextSource[];
  chars: number;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "did", "do", "does", "for", "from", "how",
  "i", "in", "is", "it", "me", "my", "of", "on", "or", "our", "so", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "to", "was", "we", "were", "what", "when", "where", "which",
  "who", "why", "will", "with", "you", "your", "请", "什么", "怎么", "为什么", "是否", "可以", "一下",
]);

const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_OVERLAP = 120;
const DEFAULT_MAX_CHUNKS = 5;
const DEFAULT_MAX_CHARS = 6000;

const SMALL_TALK = new Set([
  "hello", "hi", "hey", "yo",
  "hello davidai", "hi davidai", "hey davidai", "hello there",
  "hello who are you", "hi who are you", "good morning", "good afternoon",
  "good evening", "good night", "how are you", "who are you",
  "what can you do", "thanks", "thank you",
]);

function normalizeTerm(word: string): string {
  if (!/^[a-z]+$/.test(word)) return word;
  // Keep stopwords intact so the caller can remove them; naive stemming turned
  // "does" into "doe" and "this" into "thi", which leaked into relevance scores.
  if (STOPWORDS.has(word)) return word;
  if (word === "uses" || word === "used" || word === "using") return "use";
  if (word.endsWith("ization") && word.length > 7) return word.slice(0, -7);
  if (word.endsWith("izer") && word.length > 5) return word.slice(0, -4);
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3 && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function normalizedQuery(query: string): string {
  return query.toLowerCase().replace(/[!?.,;:]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(normalizeTerm)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function hardSplit(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += size) parts.push(text.slice(start, start + size));
  return parts;
}

function splitLongSegment(segment: string, size: number): string[] {
  if (segment.length <= size) return [segment];
  const sentences = segment.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [segment];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > size) {
      if (current.trim()) pieces.push(current.trim());
      current = "";
      pieces.push(...hardSplit(sentence.trim(), size));
      continue;
    }
    if (current && current.length + sentence.length > size) {
      pieces.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

export function chunkText(text: string, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const size = Math.max(200, Math.min(4000, Math.floor(chunkSize)));
  const tail = Math.max(0, Math.min(overlap, Math.floor(size / 2)));
  const paragraphs = clean.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const segments: string[] = [];
  for (const paragraph of paragraphs) segments.push(...splitLongSegment(paragraph, size));

  const chunks: string[] = [];
  let current = "";
  for (const segment of segments) {
    if (current && current.length + segment.length + 1 > size) {
      chunks.push(current.trim());
      const previous = current.slice(-tail);
      const boundary = previous.indexOf(" ");
      current = (boundary >= 0 ? previous.slice(boundary + 1) : previous).trim();
      if (current.length + segment.length + 1 > size) {
        const room = Math.max(0, size - segment.length - 1);
        current = current.slice(-room).trim();
      }
    }
    current = current ? `${current} ${segment}`.trim() : segment;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

export function documentsFromStore(datasets: Dataset[], knowledge: KnowledgeEntry[]): RagDocument[] {
  return [
    ...knowledge.map((k) => ({
      id: k.id,
      title: k.title,
      type: "knowledge" as const,
      category: k.category,
      content: k.content,
    })),
    ...datasets.map((d) => ({
      id: d.id,
      title: d.name,
      type: "dataset" as const,
      category: d.category,
      content: d.content,
    })),
  ].filter((doc) => doc.content.trim().length > 0);
}

export function retrieveContext(
  query: string,
  documents: RagDocument[],
  options: {
    maxChunks?: number;
    maxChars?: number;
    chunkSize?: number;
  } = {},
): RetrievalResult {
  const queryTerms = Array.from(new Set(withoutModifierWords(tokenize(query), query)));
  const empty: RetrievalResult = { chunks: [], sources: [], chars: 0 };
  if (!queryTerms.length || !documents.length || SMALL_TALK.has(normalizedQuery(query))) return empty;
  const queryText = query.toLowerCase();

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunks: RagChunk[] = [];
  const titleTermsById = new Map<string, Set<string>>();
  for (const doc of documents) {
    titleTermsById.set(doc.id, new Set(tokenize(`${doc.title} ${doc.category ?? ""}`)));
    for (const [index, text] of chunkText(doc.content, chunkSize).entries()) {
      chunks.push({
        id: `${doc.id}:${index}`,
        sourceId: doc.id,
        sourceTitle: doc.title,
        sourceType: doc.type,
        text,
        score: 0,
      });
    }
  }
  if (!chunks.length) return empty;

  const documentFrequency = new Map<string, number>();
  for (const chunk of chunks) {
    const terms = new Set(tokenize(chunk.text));
    for (const term of terms) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  const phrase = normalizedQuery(query);
  const scored = chunks.map((chunk) => {
    const terms = tokenize(chunk.text);
    const titleTerms = titleTermsById.get(chunk.sourceId) ?? new Set<string>();
    let score = 0;
    let matches = 0;
    for (const term of queryTerms) {
      const count = terms.filter((t) => t === term).length;
      const titleMatch = titleTerms.has(term);
      if (!count && !titleMatch) continue;
      matches += 1;
      const idf = Math.log(1 + chunks.length / (1 + (documentFrequency.get(term) ?? 0)));
      score += count * idf;
      if (titleMatch) score += 2 * idf;
    }

    // A single coincidental word is not enough evidence that an excerpt answers
    // the question. Require either an exact single-term match or at least half
    // of the meaningful query terms, with two or more terms matched.
    const isRelevant = queryTerms.length === 1
      ? matches === 1
      : matches >= 2 && matches / queryTerms.length >= 0.5;

    if (isRelevant) {
      if (phrase.length > 3 && chunk.text.toLowerCase().replace(/[!?.,;:]/g, " ").includes(phrase)) score += 5;
      if (/what|which|who|when|where|why|how|什么|怎么|为什么/.test(queryText)) {
        if (/what|which|什么/.test(queryText) && /\b(use|is|are|采用|使用)\b/.test(chunk.text.toLowerCase())) score += 2;
        if (/how|怎么|如何/.test(queryText) && /\b(by|use|通过|使用)\b/.test(chunk.text.toLowerCase())) score += 2;
        if (/why|为什么/.test(queryText) && /\b(because|since|to|因为)\b/.test(chunk.text.toLowerCase())) score += 2;
      }
      // Uploaded knowledge is preferred over generic training text when both match.
      score *= chunk.sourceType === "knowledge" ? 1.5 : 1;
    } else {
      score = 0;
    }
    return { ...chunk, score };
  });

  const maxChunks = Math.max(1, options.maxChunks ?? DEFAULT_MAX_CHUNKS);
  const maxChars = Math.max(500, options.maxChars ?? DEFAULT_MAX_CHARS);
  const selected: RagChunk[] = [];
  let used = 0;
  for (const chunk of scored.filter((c) => c.score > 0).sort((a, b) => b.score - a.score)) {
    const label = chunk.sourceType === "knowledge" ? "Knowledge" : "Dataset";
    const overhead = `[${label}: ${chunk.sourceTitle}]\n`.length;
    if (used + overhead + chunk.text.length > maxChars && selected.length) break;
    selected.push(chunk);
    used += overhead + chunk.text.length;
    if (selected.length >= maxChunks) break;
  }

  const sources = selected.map((chunk) => ({
    title: chunk.sourceTitle,
    type: chunk.sourceType,
    content: `[${chunk.sourceType === "knowledge" ? "Knowledge" : "Dataset"}: ${chunk.sourceTitle}]\n${chunk.text}`,
  }));
  return { chunks: selected, sources, chars: used };
}
