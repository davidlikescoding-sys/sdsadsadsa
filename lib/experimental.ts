import type { DictionaryWord, KnowledgeEntry } from "./types";
import { analyzeSentence, normalizeWord, retrieveDictionary } from "./dictionary";
import { answerAddressesQuestion } from "./learning";

export interface LocalFact {
  label: string;
  text: string;
}

export interface ExperimentalInput {
  message: string;
  words: DictionaryWord[];
  knowledge: KnowledgeEntry[];
  datasetFacts: LocalFact[];
  memoryFacts: LocalFact[];
  creativity: number;
  risk: "low" | "medium" | "high";
}

export interface ExperimentalResult {
  answer: string;
  sources: string[];
  knownFacts: string[];
  hypotheses: string[];
  alternatives: string[];
}

/**
 * Apply the user-visible risk contract to Sandbox alternatives:
 * Low shows the single answer, Medium shows at most two alternatives, and High
 * keeps every generated alternative plus an explicitly labelled recombination.
 */
export function selectSandboxAlternatives(input: {
  risk: "low" | "medium" | "high";
  alternatives: string[];
  evidence: string[];
}): string[] {
  if (input.risk === "low") return [];
  const unique = Array.from(new Set(input.alternatives.map((item) => item.trim()).filter(Boolean)));
  if (input.risk === "medium") return unique.slice(0, 2);
  const parts = Array.from(new Set([...input.evidence, ...unique].map((item) => item.trim()).filter(Boolean))).slice(0, 6);
  const combined = parts.length > 1
    ? `Combined simulation (unverified): ${parts.join(" ")}`
    : "Combined simulation (unverified): insufficient local evidence to recombine.";
  return [...unique, combined];
}

const HYPOTHESIS_PREFIX = "Hypothesis (unverified):";
const POSSIBILITY_PREFIX = "Possibility (untested):";
const COMBINATION_PREFIX = "Creative combination (not a fact):";

function short(value: string, max = 130): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
}

/**
 * Experimental reasoning over local evidence only. Known facts and guesses are
 * always labelled separately. Nothing here calls a model or executes an action.
 */
export function buildExperimentalResult(input: ExperimentalInput): ExperimentalResult {
  const creativity = Math.max(0, Math.min(100, Math.round(input.creativity)));
  const matches = retrieveDictionary(input.message, input.words).slice(0, 3);
  const analysis = analyzeSentence(input.message, input.words);
  const messageTokens = new Set(input.message.toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean));

  const known: LocalFact[] = [];
  const seen = new Set<string>();
  const addKnown = (fact: LocalFact) => {
    const key = short(fact.text, 90).toLowerCase();
    if (!fact.text || seen.has(key)) return;
    seen.add(key);
    known.push(fact);
  };

  const dictionaryFacts = matches.map((match) => ({
    match,
    fact: { label: `Dictionary · ${match.word.word}`, text: `${match.word.word} (${match.word.partOfSpeech}): ${match.word.definition}` },
  })).filter(({ match, fact }) => answerAddressesQuestion(input.message, fact.text, [match.word.word]));
  const knowledgeStops = new Set(["what", "why", "when", "where", "who", "how", "does", "define", "meaning", "means", "tell", "explain", "with", "from", "that", "this", "about", "into", "your", "the", "and", "for", "are"]);
  const knowledgeHits = input.knowledge
    .map((entry) => {
      const haystack = `${entry.title} ${entry.content}`.toLowerCase();
      const score = [...messageTokens].filter((token) =>
        token.length > 3 && !knowledgeStops.has(token) && haystack.includes(token)).length;
      return { entry, score };
    })
    .filter((hit) => hit.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  for (const fact of input.datasetFacts.slice(0, 2)) addKnown(fact);
  for (const fact of input.memoryFacts.slice(0, 1)) addKnown(fact);
  for (const hit of knowledgeHits) {
    addKnown({ label: `Knowledge · ${hit.entry.title}`, text: short(hit.entry.content, 160) });
  }
  for (const { fact } of dictionaryFacts) addKnown(fact);
  if (analysis.pattern !== "No complete sentence pattern found") {
    addKnown({ label: "Grammar analysis", text: analysis.description });
  }

  const related: string[] = [];
  for (const match of matches) {
    const candidates = [...(match.word.related ?? []), ...(match.word.synonyms ?? []), ...(match.word.topics ?? [])];
    for (const value of candidates) {
      const name = normalizeWord(value);
      if (name && name.length > 2 && !messageTokens.has(name) && !related.includes(name)) related.push(name);
    }
  }

  const hypotheses: string[] = [];
  if (matches.length && related.length) {
    hypotheses.push(`${HYPOTHESIS_PREFIX} ${matches[0].word.word} may be connected to ${related[0]} because your dictionary groups them together. I have not verified this as a fact.`);
  }
  if (related.length > 1) {
    hypotheses.push(`${POSSIBILITY_PREFIX} ${related[1]} could be a useful alternative angle here, based only on word relationships in your local dictionary.`);
  }
  if (known.length >= 2) {
    hypotheses.push(`${COMBINATION_PREFIX} ${short(known[0].text, 80)} — considered alongside — ${short(known[1].text, 80)}. This is a new combination, not a stored answer.`);
  }
  if (!hypotheses.length) {
    hypotheses.push(`${HYPOTHESIS_PREFIX} I found no direct local evidence for this message, so I cannot offer a meaningful guess yet. Add a word, dataset, knowledge entry or memory to give the experiment something to work with.`);
  }

  const extra = Math.floor(creativity / 50) + (input.risk === "high" ? 2 : input.risk === "medium" ? 1 : 0);
  const alternatives = [...hypotheses];
  for (let i = 0; i < extra && known.length; i++) {
    const fact = known[(i + 1) % known.length];
    alternatives.push(`${POSSIBILITY_PREFIX} Reframe the answer around ${short(fact.text, 90)}. This reuses local evidence but is not a confirmed response.`);
  }

  const supported = known[0]?.text ?? "";
  const guess = hypotheses[0];
  const answer = supported
    ? `Known: ${supported}${creativity > 20 && guess ? ` ${guess}` : ""}`
    : guess;

  return {
    answer,
    sources: [...known.map((fact) => `Known · ${fact.label}`), ...hypotheses.map((_, i) => `Hypothesis ${i + 1}`)],
    knownFacts: known.map((fact) => `Known · ${fact.label}: ${fact.text}`),
    hypotheses,
    alternatives,
  };
}
