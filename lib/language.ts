import type { ChatTurn } from "./chat";
import type { DictionaryWord } from "./types";
import type { DictionaryMatch } from "./dictionary";
import type { ConceptGraph } from "./concept-graph";
import { expandConcepts, rawTerms } from "./concept-graph";
import { tokenize } from "./rag";

export type UtteranceIntent = "question" | "command" | "statement" | "greeting" | "followup" | "unknown";
export type QuestionKind = "definition" | "how" | "why" | "calculation" | "yesno" | "choice" | "factual" | "none";

export interface SpellingCorrection {
  from: string;
  to: string;
  reason: "informal" | "spelling";
}

export interface LanguageUnderstanding {
  original: string;
  normalized: string;
  corrected: string;
  terms: string[];
  expandedTerms: string[];
  contextTerms: string[];
  corrections: SpellingCorrection[];
  intent: UtteranceIntent;
  questionKind: QuestionKind;
  isQuestion: boolean;
  isFollowup: boolean;
  ambiguities: string[];
  confidence: number;
}

export interface UnderstandInput {
  text: string;
  history: ChatTurn[];
  dictionary?: DictionaryWord[];
  /** Words from the user's own datasets and knowledge. Known words are never
   *  rewritten by the spell Corrector, so "moose" is not changed to "mouse". */
  knownWords?: Iterable<string>;
  dictionaryMatches?: DictionaryMatch[];
  conceptGraph?: ConceptGraph;
}

const INFORMAL: Record<string, string> = {
  u: "you", ur: "your", r: "are", n: "and", plz: "please", pls: "please",
  thx: "thanks", ty: "thank you", btw: "by the way", im: "i am", ive: "i have",
  idk: "i do not know", dunno: "do not know", dont: "do not", doesnt: "does not",
  cant: "cannot", wont: "will not", isnt: "is not", arent: "are not",
  wanna: "want to", gonna: "going to", kinda: "kind of", lemme: "let me",
  nvm: "never mind", msg: "message", info: "information",
};

const GREETINGS = /^(?:hi|hello|hey|yo|good morning|good afternoon|good evening|good night|how are you|who are you)\b/i;
const QUESTION_START = /^(?:what|why|how|who|when|where|which|whose|can|could|would|should|will|do|does|did|is|are|was|were|define|describe|explain|tell)\b/i;
const COMMAND_START = /^(?:please|calculate|compute|solve|show|list|add|create|make|open|close|start|stop|train|remember|forget|compare|summarize|translate)\b/i;
const FOLLOWUP_START = /^(?:and|but|so|because|then|also|what about|how about|why|what|which|that|it|they|this)\b/i;
const CALCULATION_MARKER = /\d|plus|minus|times|multiplied|divided|percent|%|calculate|compute|squared|cubed|\bx\b/i;
const PRONOUNS = new Set(["it", "that", "this", "they", "them", "those", "these", "he", "she", "its"]);

function boundedDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

function capitalizeLike(source: string, value: string): string {
  if (!/^[A-Z]/.test(source)) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Small, reusable typo/informal normalizer driven by the user's own dictionary. */
export function correctSpelling(text: string, vocabulary: Set<string>): { text: string; corrections: SpellingCorrection[] } {
  const corrections: SpellingCorrection[] = [];
  const byLength = new Map<number, string[]>();
  for (const word of vocabulary) {
    if (!/^[a-z]+$/.test(word)) continue;
    const bucket = byLength.get(word.length) ?? [];
    bucket.push(word);
    byLength.set(word.length, bucket);
  }

  const output = text.replace(/[A-Za-z][A-Za-z']*/g, (token) => {
    const lower = token.toLowerCase().replace(/'/g, "");
    if (INFORMAL[lower]) {
      const replacement = capitalizeLike(token, INFORMAL[lower]);
      corrections.push({ from: token, to: replacement, reason: "informal" });
      return replacement;
    }
    if (lower.length < 4 || vocabulary.has(lower)) return token;

    const max = lower.length >= 7 ? 2 : 1;
    let best: { word: string; distance: number } | null = null;
    let runnerUp: number | null = null;
    for (const delta of [-1, 0, 1]) {
      for (const candidate of byLength.get(lower.length + delta) ?? []) {
        if (candidate[0] !== lower[0]) continue;
        const distance = boundedDistance(lower, candidate, max);
        if (distance > max) continue;
        if (!best || distance < best.distance) {
          runnerUp = best?.distance ?? null;
          best = { word: candidate, distance };
        } else if (distance === best.distance) {
          runnerUp = distance;
        }
      }
    }
    // Only correct when one candidate is clearly closest. Ambiguous misspellings
    // are reported as uncertainty instead of being silently rewritten.
    if (best && (runnerUp === null || best.distance < runnerUp)) {
      corrections.push({ from: token, to: capitalizeLike(token, best.word), reason: "spelling" });
      return capitalizeLike(token, best.word);
    }
    return token;
  });
  return { text: output, corrections };
}

export interface UtteranceClassification {
  intent: UtteranceIntent;
  questionKind: QuestionKind;
  isQuestion: boolean;
  isFollowup: boolean;
  confidence: number;
}

export function classifyUtterance(text: string, hasHistory: boolean): UtteranceClassification {
  const clean = text.trim();
  if (!clean) return { intent: "unknown", questionKind: "none", isQuestion: false, isFollowup: false, confidence: 0 };
  const isQuestion = clean.endsWith("?") || QUESTION_START.test(clean);
  const isFollowup = hasHistory && clean.split(/\s+/).length <= 7 && FOLLOWUP_START.test(clean);
  let intent: UtteranceIntent = "statement";
  if (GREETINGS.test(clean)) intent = "greeting";
  else if (isFollowup) intent = "followup";
  else if (isQuestion) intent = "question";
  else if (COMMAND_START.test(clean)) intent = "command";

  let questionKind: QuestionKind = "none";
  if (isQuestion || isFollowup || (intent === "command" && CALCULATION_MARKER.test(clean))) {
    if (CALCULATION_MARKER.test(clean)) questionKind = "calculation";
    else if (/^(?:define|what is|what does|what do|meaning of|what does .* mean)\b/i.test(clean)) questionKind = "definition";
    else if (/^(?:how|in what way)\b/i.test(clean)) questionKind = "how";
    else if (/^(?:why|because|what causes)\b/i.test(clean)) questionKind = "why";
    else if (/^(?:is|are|was|were|do|does|did|can|could|would|should|will)\b/i.test(clean)) questionKind = "yesno";
    else if (/\bor\b/i.test(clean)) questionKind = "choice";
    else questionKind = "factual";
  }
  const confidence = Math.min(0.95, 0.55 + (clean.endsWith("?") ? 0.15 : 0) + (QUESTION_START.test(clean) ? 0.15 : 0) + (hasHistory ? 0.1 : 0));
  return { intent, questionKind, isQuestion, isFollowup, confidence };
}

/** Resolve short follow-ups against the last meaningful turns instead of guessing. */
export function resolveContext(text: string, history: ChatTurn[]): string[] {
  const raw = rawTerms(text);
  const current = new Set([...raw, ...tokenize(text)]);
  const needsContext = raw.some((term) => PRONOUNS.has(term)) || text.trim().split(/\s+/).length <= 3;
  if (!needsContext || !history.length) return [];
  // User turns carry the subject; assistant turns are secondary context.
  const userTerms: string[] = [];
  const assistantTerms: string[] = [];
  for (const turn of history.slice(-4).reverse()) {
    const bucket = turn.role === "user" ? userTerms : assistantTerms;
    for (const term of rawTerms(turn.content)) {
      if (!current.has(term) && !bucket.includes(term)) bucket.push(term);
    }
  }
  return [...userTerms, ...assistantTerms].slice(0, 6);
}

export function detectAmbiguities(
  original: string,
  corrections: SpellingCorrection[],
  matches: DictionaryMatch[] = [],
  contextTerms: string[] = [],
): string[] {
  const notes: string[] = [];
  for (const correction of corrections.slice(0, 3)) {
    notes.push(`${correction.reason === "spelling" ? "Possible spelling correction" : "Informal wording expanded"}: ${correction.from} → ${correction.to}.`);
  }
  if (matches.length >= 2 && matches[0].score === matches[1].score) {
    notes.push(`Several dictionary entries could match: ${matches.slice(0, 3).map((m) => m.word.word).join(", ")}.`);
  }
  if (/\bor\b/i.test(original)) notes.push("The question contains alternatives, so more than one interpretation may be valid.");
  if (rawTerms(original).some((term) => PRONOUNS.has(term)) && !contextTerms.length) {
    notes.push("A pronoun refers to something that could not be resolved from recent conversation.");
  }
  return notes.slice(0, 4);
}

function dictionaryExpansion(matches: DictionaryMatch[]): string[] {
  const out: string[] = [];
  for (const match of matches.slice(0, 5)) {
    for (const value of [...(match.word.synonyms ?? []), ...match.word.related, ...(match.word.topics ?? [])]) {
      for (const term of rawTerms(value)) out.push(term);
    }
  }
  return out;
}

/** Full reusable understanding pass. No answer text is produced here. */
export function understandMessage(input: UnderstandInput): LanguageUnderstanding {
  const original = input.text;
  const matches = input.dictionaryMatches ?? [];
  const vocabulary = new Set((input.dictionary ?? []).map((word) => word.word.toLowerCase().replace(/[^a-z]/g, "")));
  for (const word of input.knownWords ?? []) vocabulary.add(word);
  const { text: corrected, corrections } = correctSpelling(original, vocabulary);
  const classification = classifyUtterance(corrected, input.history.length > 0);
  const contextTerms = resolveContext(corrected, input.history);
  const terms = Array.from(new Set(tokenize(corrected)));
  const expanded = input.conceptGraph ? expandConcepts(rawTerms(corrected), input.conceptGraph, 10) : [];
  const expandedTerms = Array.from(new Set([
    ...terms,
    ...dictionaryExpansion(matches),
    ...expanded,
    ...contextTerms,
  ])).slice(0, 24);
  const ambiguities = detectAmbiguities(original, corrections, matches, contextTerms);

  return {
    original,
    normalized: corrected.toLowerCase().replace(/\s+/g, " ").trim(),
    corrected,
    terms,
    expandedTerms,
    contextTerms,
    corrections,
    intent: classification.intent,
    questionKind: classification.questionKind,
    isQuestion: classification.isQuestion,
    isFollowup: classification.isFollowup,
    ambiguities,
    confidence: classification.confidence,
  };
}

/** Light second pass after dictionary retrieval, kept separate to avoid re-running tokenization twice. */
export function enrichUnderstanding(understanding: LanguageUnderstanding, matches: DictionaryMatch[]): LanguageUnderstanding {
  const extra = dictionaryExpansion(matches);
  return {
    ...understanding,
    expandedTerms: Array.from(new Set([...understanding.expandedTerms, ...extra])).slice(0, 24),
    ambiguities: detectAmbiguities(understanding.original, understanding.corrections, matches, understanding.contextTerms),
  };
}
