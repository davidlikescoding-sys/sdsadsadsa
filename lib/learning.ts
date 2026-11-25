import type { ChatTurn } from "./chat";
import type { ReasoningSummary } from "./trace";
import type { LanguageUnderstanding } from "./language";
import type { AnswerVerification, ReasoningPlan } from "./reasoning";
import { normalizedQuery, tokenize } from "./rag";
import { polishAnswer } from "./answer-text";
import { withoutModifierWords } from "./question-terms";
import { hashText } from "./storage";
import type { ChatContextSource } from "./chat";
import type {
  Correction, Feedback, LearningEdit, LearningSession, Memory, MemoryKind, ModelVersion, TrainingExample,
} from "./types";

export interface LearningContextItem {
  id: string;
  sourceType: "memory" | "correction";
  sourceId: string;
  title: string;
  content: string;
  score: number;
  /** The exact remembered/corrected answer, when the context has one. */
  answer?: string;
  /** The question this memory or correction originally answered. */
  sourceQuestion?: string;
}

export interface LocalAnswerResult {
  text: string;
  tokensGenerated: number;
  elapsedMs: number;
  tokensPerSecond: number;
  sources: string[];
  memoryItems: LearningContextItem[];
  correctionItems: LearningContextItem[];
  knowledgeItems: ChatContextSource[];
  modelVersion: number | null;
  answerMode: "grounded" | "generated" | "fallback" | "experimental";
  engine: "generative" | "retrieval";
  reasoning: ReasoningSummary;
  traceId: string;
  candidates: Array<{ text: string; score: number; selected: boolean }>;
  /** Optional explanations from the language/reasoning layer, kept separate from model weights. */
  understanding?: LanguageUnderstanding;
  reasoningPlan?: ReasoningPlan;
  verification?: AnswerVerification;
}

export interface MemoryProposal {
  content: string;
  kind: MemoryKind;
}

const MAX_MEMORY_CHARS = 240;

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/^that\s+/i, "").replace(/^the fact that\s+/i, "");
}

export function normalizeForHash(text: string): string {
  return text.toLowerCase().replace(/[!?.,;:'"()\[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

export function memoryHash(content: string): string {
  return hashText(normalizeForHash(content));
}

/** Deterministic, conservative extraction. Ordinary messages never become memories. */
export function proposeMemory(userMessage: string): MemoryProposal | null {
  const text = tidy(userMessage);
  if (!text || text.length > 600) return null;

  const rules: Array<{ pattern: RegExp; kind: MemoryKind }> = [
    { pattern: /^(?:please\s+)?(?:remember(?:\s+that)?|don't forget(?:\s+that)?|记住|请记住)\s+(.+)$/i, kind: "explicit" },
    { pattern: /^(?:my name is|i am called|call me)\s+(.+)$/i, kind: "fact" },
    { pattern: /^i\s+(?:prefer|like|love|enjoy|dislike|hate)\s+(.+)$/i, kind: "preference" },
    { pattern: /^i\s+(?:work|live|study)\s+(.+)$/i, kind: "fact" },
  ];

  for (const rule of rules) {
    const match = text.match(rule.pattern);
    if (!match?.[1]) continue;
    let content = tidy(match[1].replace(/^(?:that|the fact that)\s+/i, ""));
    if (!content || /^(?:this|that|it|these|those)$/i.test(content)) return null;
    if (content.length > MAX_MEMORY_CHARS) content = `${content.slice(0, MAX_MEMORY_CHARS - 1).trimEnd()}…`;
    return { content, kind: rule.kind };
  }
  return null;
}

interface RetrieveOptions {
  maxItems?: number;
  maxChars?: number;
  conversationId?: string | null;
}

/** Lexical retrieval with a relevance floor so unrelated memories are never injected. */
export function retrieveLearningContext(
  query: string,
  input: { memories?: Memory[]; corrections?: Correction[] },
  options: RetrieveOptions = {},
): LearningContextItem[] {
  const terms = Array.from(new Set(tokenize(query)));
  if (!terms.length) return [];
  const phrase = normalizedQuery(query);
  const conversationId = options.conversationId;

  interface Candidate extends LearningContextItem {
    titleTerms: Set<string>;
  }

  const candidates: Candidate[] = [];
  for (const memory of input.memories ?? []) {
    if (memory.supersededBy) continue;
    if (conversationId !== undefined && memory.conversationId !== null && memory.conversationId !== conversationId) continue;
    // Correction memories record the question they were created for. Keep that
    // link so a narrow correction cannot answer a broader later question.
    const rememberedQuestion = memory.content.match(/^Correct answer to ["“](.+)["”]\s*:/i)?.[1];
    candidates.push({
      id: `memory:${memory.id}`,
      sourceType: "memory",
      sourceId: memory.id,
      title: memory.kind === "preference" ? "Preference" : memory.kind === "explicit" ? "Remembered" : "Memory",
      content: memory.content,
      answer: memory.content,
      score: 0,
      titleTerms: new Set(tokenize(memory.kind)),
      sourceQuestion: rememberedQuestion,
    });
  }
  // Only the newest approval for a given question is active. Older approvals stay
  // in the audit trail but cannot keep resurrecting a superseded mistake.
  const latestCorrection = new Map<string, Correction>();
  for (const correction of input.corrections ?? []) {
    if (correction.status !== "approved") continue;
    const key = normalizeForHash(correction.question);
    const current = latestCorrection.get(key);
    if (!current || correction.updatedAt > current.updatedAt) latestCorrection.set(key, correction);
  }
  for (const correction of latestCorrection.values()) {
    const wrong = correction.originalAnswer.trim();
    const avoid = wrong && normalizeAnswer(wrong) !== normalizeAnswer(correction.correctedAnswer)
      ? `\nAvoid (wrong answer): ${wrong}` : "";
    const why = correction.explanation.trim() ? `\nWhy: ${correction.explanation.trim()}` : "";
    candidates.push({
      id: `correction:${correction.id}`,
      sourceType: "correction",
      sourceId: correction.id,
      title: "Approved correction",
      content: `Question: ${correction.question}${avoid}\nCorrect answer: ${correction.correctedAnswer}${why}`,
      answer: correction.correctedAnswer,
      score: 0,
      titleTerms: new Set(tokenize(correction.question)),
      sourceQuestion: correction.question,
    });
  }

  const scored: LearningContextItem[] = [];
  for (const candidate of candidates) {
    const contentTerms = new Set(tokenize(candidate.content));
    let matches = 0;
    for (const term of terms) {
      if (contentTerms.has(term) || candidate.titleTerms.has(term)) matches += 1;
    }
    if (matches === 0) continue;
    const exactPhrase = phrase.length > 3 && normalizedQuery(candidate.content).includes(phrase);
    const enough = terms.length === 1
      ? matches === 1
      : matches >= 2 && matches / terms.length >= 0.5;
    if (!enough && !exactPhrase) continue;

    let score = matches * (candidate.sourceType === "correction" ? 1.35 : 1);
    if (exactPhrase) score += 3;
    if (candidate.sourceType === "memory" && candidate.titleTerms.size && terms.some((t) => candidate.titleTerms.has(t))) score += 0.5;
    scored.push({
      id: candidate.id,
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      title: candidate.title,
      content: candidate.content,
      answer: candidate.answer,
      score,
      sourceQuestion: candidate.sourceQuestion,
    });
  }

  const maxItems = Math.max(1, options.maxItems ?? 4);
  const maxChars = Math.max(200, options.maxChars ?? 2200);
  const selected: LearningContextItem[] = [];
  let used = 0;
  for (const item of scored.sort((a, b) => b.score - a.score)) {
    const overhead = `[${item.title}]\n`.length;
    if (used + overhead + item.content.length > maxChars && selected.length) break;
    selected.push(item);
    used += overhead + item.content.length;
    if (selected.length >= maxItems) break;
  }
  return selected;
}

export function searchCorrections(query: string, corrections: Correction[]): Correction[] {
  const items = retrieveLearningContext(query, { corrections }, { maxItems: 50, maxChars: 50_000 });
  const ids = new Set(items.map((item) => item.sourceId));
  return corrections.filter((c) => ids.has(c.id));
}

export interface DatasetAnswer {
  question: string;
  answer: string;
  sourceTitle: string;
  format: "dialogue" | "qa" | "definition";
}

const DATASET_META_KEYS = new Set([
  "version", "category", "purpose", "note", "notes", "title", "author", "date", "description",
  "overview", "last updated", "summary", "contents", "size", "language", "format",
]);

/** Pull real answer-bearing lines out of the user's own datasets. */
export function datasetAnswers(sources: Array<{ title: string; content: string }>): DatasetAnswer[] {
  const out: DatasetAnswer[] = [];
  const seen = new Set<string>();
  const add = (question: string, rawAnswer: string, sourceTitle: string, format: DatasetAnswer["format"]) => {
    const q = tidy(question).replace(/^[-*#\d.)]+\s*/, "").trim();
    const a = tidy(rawAnswer).replace(/^\[[^\]]+\]\s*/, "").trim();
    if (!q || !a || a.length < 12) return;
    if (DATASET_META_KEYS.has(q.toLowerCase())) return;
    if (!isReadableText(a, 2)) return;
    const key = `${normalizeAnswer(q)}::${normalizeAnswer(a)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ question: q, answer: a, sourceTitle, format });
  };

  for (const source of sources) {
    const text = source.content ?? "";
    for (const pair of conversationPairs([text])) add(pair.question, pair.answer, source.title, "dialogue");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const qa = line.match(/^(?:question|q)\s*[:.)]\s*(.+)$/i);
      if (qa) {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const answer = lines[j].trim().match(/^(?:answer|a|davidai)\s*[:.)]\s*(.+)$/i);
          if (answer) { add(qa[1], answer[1], source.title, "qa"); break; }
        }
        continue;
      }
      const definition = line.match(/^([A-Z][\p{L}\w /'()\-]{1,60})\s*:\s*(.{12,})$/u);
      if (definition) add(definition[1], definition[2], source.title, "definition");
    }
  }
  return out;
}

export interface DatasetAnswerMatch extends DatasetAnswer {
  score: number;
}

/** Match a question against real answers stored in datasets. */
export function findDatasetAnswers(query: string, entries: DatasetAnswer[], limit = 3): DatasetAnswerMatch[] {
  const target = normalizeAnswer(query);
  if (!target) return [];
  const terms = Array.from(new Set(tokenize(query)));
  const phrase = normalizedQuery(query);
  const matches: DatasetAnswerMatch[] = [];
  for (const entry of entries) {
    const entryQuestion = normalizeAnswer(entry.question);
    let score = 0;
    if (entryQuestion === target) score = 4;
    else if (phrase.length > 3 && normalizedQuery(entry.question).includes(phrase)) score = 3;
    else {
      const entryTerms = new Set(tokenize(entry.question));
      const overlap = terms.length ? terms.filter((term) => entryTerms.has(term)).length / terms.length : 0;
      if (overlap >= 0.6 || (terms.length === 1 && entryTerms.has(terms[0]))) score = Math.max(overlap, 0.9);
    }
    if (score > 0) matches.push({ ...entry, score });
  }
  return matches
    .sort((a, b) => b.score - a.score || b.answer.length - a.answer.length)
    .slice(0, Math.max(1, limit));
}

export function findDatasetAnswer(query: string, entries: DatasetAnswer[]): DatasetAnswerMatch | null {
  return findDatasetAnswers(query, entries, 1)[0] ?? null;
}

function normalizeAnswer(text: string): string {
  return text.toLowerCase().replace(/[!?.,;:'"()\[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

/** Extract real Q&A pairs from the user's own datasets. */
export function conversationPairs(texts: string[]): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = [];
  for (const text of texts) {
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i++) {
      const question = lines[i].match(/^\s*User:\s*(.+?)\s*$/i)?.[1];
      if (!question) continue;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const answer = lines[j].match(/^\s*DavidAI:\s*(.+?)\s*$/i)?.[1];
        if (answer) {
          pairs.push({ question, answer: answer.trim() });
          break;
        }
        if (lines[j].trim() && !/^\s*(?:\[|#|=|-)/.test(lines[j])) break;
      }
    }
  }
  return pairs;
}

/** Find a real Q&A pair in the user's own datasets, for greetings and known questions. */
export function findConversationAnswer(message: string, texts: string[]): string | null {
  const target = normalizeAnswer(message);
  if (!target) return null;
  const pairs = conversationPairs(texts);
  const exact = pairs.find((pair) => normalizeAnswer(pair.question) === target);
  if (exact) return exact.answer;

  const terms = Array.from(new Set(tokenize(message)));
  if (!terms.length) return null;
  let best: { answer: string; overlap: number } | null = null;
  for (const pair of pairs) {
    const pairTerms = new Set(tokenize(pair.question));
    const overlap = terms.filter((term) => pairTerms.has(term)).length / terms.length;
    if (overlap >= 0.6 && (!best || overlap > best.overlap)) best = { answer: pair.answer, overlap };
  }
  return best?.answer ?? null;
}

/** Words that describe the question itself rather than its subject. */
const QUESTION_META = new Set([
  "define", "defined", "definition", "describe", "explain", "mean", "meaning", "means",
  "show", "tell", "understand",
  // Instructional verbs say what the user wants to do, not what the subject is.
  // "How do you make a game?" is about a game; the answer may explain the game
  // loop without repeating the word "make".
  "make", "build", "create", "code", "write", "print", "draw", "calculate", "solve",
]);

function questionTerms(query: string): string[] {
  return withoutModifierWords(tokenize(query), query).filter((term) => !QUESTION_META.has(term));
}

/**
 * True when a retrieved answer was stored for a narrower question than the one
 * being asked. Example: a correction for "average size of a moose" must not
 * answer the broader question "what is a moose".
 */
function sourceQuestionIsNarrower(sourceQuestion: string | undefined, query: string | undefined): boolean {
  if (!sourceQuestion || !query) return false;
  const sourceTerms = questionTerms(sourceQuestion);
  const queryTerms = new Set(questionTerms(query));
  if (sourceTerms.length <= queryTerms.size) return false;
  return sourceTerms.some((term) => !queryTerms.has(term));
}

/** Fraction of the question's content words that actually appear in an answer. */
export function queryCoverage(query: string, answer: string): number {
  const terms = questionTerms(query);
  if (!terms.length) return 1;
  const answerTerms = new Set(tokenize(answer));
  return terms.filter((term) => answerTerms.has(term)).length / terms.length;
}

/**
 * Content words that have no exact dictionary match. These are the words the
 * answer must address directly; otherwise a definition of another word in the
 * question can masquerade as an answer (for example "average" in a moose question).
 */
export function unansweredSubjectTerms(query: string, matchedDictionaryWords: string[] = []): string[] {
  const matched = new Set(matchedDictionaryWords.flatMap((word) => tokenize(word)));
  return questionTerms(query).filter((term) => !matched.has(term));
}

/**
 * Generic relevance check used before an answer is accepted, ranked or learned.
 * It does not contain per-question strings; the reference words come only from
 * the user's message and the dictionary entries that actually matched it.
 */
export function answerAddressesQuestion(query: string, answer: string, matchedDictionaryWords: string[] = []): boolean {
  const terms = questionTerms(query);
  if (!terms.length) return true;
  const coverage = queryCoverage(query, answer);
  const subjects = unansweredSubjectTerms(query, matchedDictionaryWords);
  if (!subjects.length) return coverage >= 0.4;
  const answerTerms = new Set(tokenize(answer));
  if (subjects.some((term) => answerTerms.has(term))) return true;
  return coverage >= 0.6;
}

/**
 * Return the single sentence that actually answers the question. Chunked
 * datasets contain whole paragraphs, and a chunk boundary can leave a lowercase
 * fragment such as "own responsibilities." at the start; neither belongs in a
 * spoken answer.
 */
export function answerSentence(text: string, terms: string[], maxChars = 320): string {
  const clean = text.replace(/^\[[^\]]+\]\s*/, "").trim();
  if (!clean) return "";
  // Rag chunking flattens a dialogue dataset's lines into one string such as
  // "GAME DEVELOPMENT User: How do you make a game? DavidAI: A game has ...".
  // Only the text after a DavidAI label is answer text. The section header and
  // the User question are metadata, and scoring them can outrank the real
  // answer because they repeat the question's own words.
  let answerText: string;
  if (/\bdavidai\s*:/i.test(clean)) {
    answerText = clean
      .split(/\bdavidai\s*:/i)
      .slice(1)
      .map((segment) => segment.split(/\buser\s*:/i)[0])
      .join(" ")
      .trim();
  } else {
    answerText = clean
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        // Skip all-caps section headers such as "GAME DEVELOPMENT".
        if (/^[A-Z][A-Z0-9 ,/'\-]{2,}$/.test(trimmed)) return false;
        // Skip question lines from dialogue datasets.
        if (/^(?:user|question|q)\s*:/i.test(trimmed)) return false;
        return true;
      })
      .join(" ");
  }
  const normalized = answerText.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const parts = (normalized.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [normalized])
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";

  const complete = parts.filter((part) => /^[\p{Lu}\p{N}"“'(]/u.test(part));
  const pool = complete.length ? complete : parts;
  if (!terms.length) return pool[0].slice(0, maxChars).trim();

  const best = pool.reduce((top, sentence) => {
    const words = new Set(tokenize(sentence));
    const hits = terms.filter((term) => words.has(term)).length;
    const direct = /\b(is|are|was|were|means?|stands for|refers to|equals|located)\b/i.test(sentence) ? 0.25 : 0;
    const score = hits + direct;
    return score > top.score ? { sentence, score } : top;
  }, { sentence: pool[0], score: -1 });
  return best.sentence.slice(0, maxChars).trim();
}

export interface GroundedCandidate {
  text: string;
  source: string;
  priority: number;
  score: number;
  /** Query-content coverage, computed when the original question is supplied. */
  coverage?: number;
  /** The evidence answered a narrower question; it should lose to direct evidence. */
  questionMismatch?: boolean;
}

/**
 * Candidate answers come only from retrieved user data: approved corrections,
 * memories, Q&A pairs in the user's datasets, and uploaded knowledge.
 * The local model scores them; this helper never invents answer text.
 */
export function groundedCandidates(input: {
  query?: string;
  memoryItems?: LearningContextItem[];
  correctionItems?: LearningContextItem[];
  knowledgeItems?: ChatContextSource[];
  conversationAnswer?: string | null;
  datasetMatches?: DatasetAnswerMatch[];
}): GroundedCandidate[] {
  const candidates: GroundedCandidate[] = [];
  const seen = new Set<string>();
  const add = (raw: string, source: string, priority: number, score: number, sourceQuestion?: string) => {
    const text = polishAnswer(tidy(raw), input.query);
    if (!text || !isReadableText(text, 2)) return;
    const key = normalizeAnswer(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const questionMismatch = sourceQuestionIsNarrower(sourceQuestion, input.query);
    candidates.push({
      text, source, priority, score,
      ...(input.query ? { coverage: queryCoverage(input.query, text) } : {}),
      ...(questionMismatch ? { questionMismatch: true } : {}),
    });
  };

  for (const item of input.correctionItems ?? []) add(item.answer ?? item.content, "Approved correction", 4, item.score, item.sourceQuestion);
  for (const item of input.memoryItems ?? []) add(item.answer ?? item.content, item.title, 3, item.score, item.sourceQuestion);
  if (input.conversationAnswer) add(input.conversationAnswer, "Conversation data", 2, 1);
  for (const match of input.datasetMatches ?? []) add(match.answer, `Dataset · ${match.sourceTitle}`, 2, match.score, match.question);
  for (const item of input.knowledgeItems ?? []) {
    // The source title stays in `source`; the spoken answer is only the one
    // sentence from the dataset that matches the question.
    add(answerSentence(item.content, input.query ? questionTerms(input.query) : [], 320), item.title, 1, 0);
  }
  return candidates;
}

export interface RankedRetrievalCandidate extends GroundedCandidate {
  /** Real model log-likelihood plus source priority and retrieval relevance. */
  finalScore: number;
}

/**
 * Rank real retrieved candidates. A teacher-forced forward pass measures how
 * well the local model fits the candidate, while priority keeps a user-approved
 * correction above a loosely related dictionary definition. No answer text is
 * invented here.
 */
export function rankRetrievalCandidates(input: {
  candidates: GroundedCandidate[];
  modelScore?: (text: string) => number;
  useModelScore?: boolean;
  query?: string;
}): RankedRetrievalCandidate[] {
  return input.candidates.map((candidate) => {
    const useModel = input.useModelScore !== false && typeof input.modelScore === "function";
    const likelihood = useModel && Number.isFinite(candidate.score)
      ? input.modelScore!(candidate.text)
      : 0;
    const relevance = Number.isFinite(candidate.score) ? candidate.score * 0.15 : 0;
    const coverage = Number.isFinite(candidate.coverage)
      ? candidate.coverage!
      : input.query
        ? queryCoverage(input.query, candidate.text)
        : 0;
    // Query coverage is a first-class signal; priority is a trust tie-breaker.
    // A candidate that does not address the question cannot win on priority alone.
    const coverageScore = coverage * 4 - (input.query && coverage === 0 ? 6 : 0);
    // A user correction is trusted, but only for the question it corrected.
    // A narrower remembered question must not outrank a direct definition.
    const mismatchPenalty = candidate.questionMismatch ? 12 : 0;
    const finalScore = likelihood + candidate.priority * 2.5 + relevance + coverageScore - mismatchPenalty;
    return { ...candidate, coverage, finalScore };
  }).sort((a, b) => b.finalScore - a.finalScore);
}

/** Common words used to tell a real sentence from character-level sampling noise. */
const COMMON_WORDS = new Set(`
a about after again all also am an and another any are as at back be because been before being best better between both but by
call called can came come could did do does doing done down each even every few find first for from get give go good had has
have he her here him his how i if in into is it its just know last like look made make many may me might more most much my
name need never new next no not now of off old on one only or other our out over own people said same say see she should
since so some still such take than that the their them then there these they thing think this those though three through
time to today too two under until up us use used very want was way we were what when where whether which while who why will
with without word work would you your hello help davidai answer question correct
`.trim().split(/\s+/));

/** Reject sampling noise so chat never displays character-soup as an answer. */
export function isReadableText(text: string, minWords = 3): boolean {
  const clean = text.trim();
  if (clean.length < 8) return false;
  const compact = clean.replace(/\s/g, "");
  if (!compact) return false;
  const letters = (clean.match(/[\p{L}]/gu) ?? []).length;
  const symbols = compact.length - letters - (clean.match(/[0-9]/g) ?? []).length;
  if (letters / compact.length < 0.72 || symbols / compact.length > 0.14) return false;
  const words = clean.split(/\s+/).filter((word) => /[\p{L}]/u.test(word));
  if (words.length < minWords) return false;
  const vowels = (clean.toLowerCase().match(/[aeiou]/g) ?? []).length;
  if (vowels / Math.max(1, letters) < 0.22) return false;
  const latinWords = clean.toLowerCase().match(/[a-z]+/g) ?? [];
  if (!latinWords.length) return false;
  const recognized = latinWords.filter((word) => COMMON_WORDS.has(word)).length;
  return recognized / latinWords.length >= 0.2;
}

export interface LocalPromptInput {
  message: string;
  history: ChatTurn[];
  memoryItems?: LearningContextItem[];
  correctionItems?: LearningContextItem[];
  knowledgeItems?: ChatContextSource[];
  maxChars?: number;
}

/**
 * One prompt format shared by inference and feedback training. The local
 * character model sees this as text; it never receives a canned answer.
 */
export function buildLocalPrompt(input: LocalPromptInput): string {
  const lines = ["DavidAI is a local neural assistant. Continue as DavidAI."];
  for (const turn of input.history.slice(-6)) {
    lines.push(`${turn.role === "user" ? "User" : "DavidAI"}: ${turn.content}`);
  }
  for (const item of input.memoryItems ?? []) lines.push(`[${item.title}] ${item.content}`);
  for (const item of input.correctionItems ?? []) {
    lines.push(`[${item.title}] ${item.content.replace(/\n/g, " ")}`);
  }
  for (const chunk of input.knowledgeItems ?? []) lines.push(chunk.content.replace(/\n/g, " "));
  lines.push(`User: ${input.message}`);
  lines.push("DavidAI:");
  const prompt = lines.join("\n");
  const maxChars = Math.max(120, input.maxChars ?? 900);
  return prompt.length > maxChars ? `…${prompt.slice(-maxChars + 1)}` : prompt;
}

export function trainingText(prompt: string, answer: string): string {
  return `${prompt} ${tidy(answer)}</s>`;
}

export function exampleFromCorrection(correction: Correction): TrainingExample {
  const wrong = correction.originalAnswer.trim();
  const avoid = wrong && normalizeAnswer(wrong) !== normalizeAnswer(correction.correctedAnswer)
    ? `\nAvoid (wrong answer): ${wrong}` : "";
  const context: LearningContextItem = {
    id: `correction:${correction.id}`,
    sourceType: "correction",
    sourceId: correction.id,
    title: "Approved correction",
    content: `Question: ${correction.question}${avoid}\nCorrect answer: ${correction.correctedAnswer}${correction.explanation ? `\nWhy: ${correction.explanation}` : ""}`,
    answer: correction.correctedAnswer,
    score: 1,
  };
  const prompt = buildLocalPrompt({
    message: correction.question,
    history: [],
    correctionItems: [context],
    maxChars: 700,
  });
  const answer = correction.correctedAnswer.trim();
  return {
    id: "",
    kind: "correction",
    sourceId: correction.id,
    question: correction.question,
    answer,
    prompt,
    text: trainingText(prompt, answer),
    hash: hashText(normalizeForHash(`${correction.question}\n${answer}`)),
    createdAt: new Date().toISOString(),
    usedInSessionIds: [],
  };
}

export function describeCorrectionChange(correction: Correction): string {
  if (correction.explanation.trim()) return correction.explanation.trim();
  const before = correction.originalAnswer.trim() || "(empty)";
  const after = correction.correctedAnswer.trim() || "(empty)";
  return `Changed answer from "${before}" to "${after}".`;
}

export function learningStats(input: {
  memories: Memory[];
  feedback: Feedback[];
  corrections: Correction[];
  examples: TrainingExample[];
  sessions: LearningSession[];
  versions: ModelVersion[];
}) {
  return {
    memories: input.memories.filter((m) => !m.supersededBy).length,
    feedback: input.feedback.length,
    positive: input.feedback.filter((f) => f.rating === "helpful").length,
    negative: input.feedback.filter((f) => f.rating === "not_helpful").length,
    approved: input.corrections.filter((c) => c.status === "approved").length,
    pending: input.corrections.filter((c) => c.status === "pending").length,
    examples: input.examples.length,
    sessions: input.sessions.length,
    version: input.versions.length ? Math.max(...input.versions.map((v) => v.version)) : 0,
    latestLoss: input.sessions.length ? input.sessions[input.sessions.length - 1].finalLoss : null,
    latestValidationLoss: input.sessions.length ? input.sessions[input.sessions.length - 1].finalValidationLoss : null,
  };
}

export function exportLearningData(input: {
  memories: Memory[];
  feedback: Feedback[];
  corrections: Correction[];
  examples: TrainingExample[];
  sessions: LearningSession[];
  versions: ModelVersion[];
  edits?: LearningEdit[];
}): string {
  return JSON.stringify({
    app: "DavidAI-learning",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...input,
  }, null, 2);
}

export function exportTrainingData(examples: TrainingExample[]): string {
  return JSON.stringify({
    app: "DavidAI-training-data",
    version: 1,
    exportedAt: new Date().toISOString(),
    examples: examples.map((e) => ({
      id: e.id,
      kind: e.kind,
      question: e.question,
      answer: e.answer,
      prompt: e.prompt,
      text: e.text,
      sourceId: e.sourceId,
    })),
  }, null, 2);
}
