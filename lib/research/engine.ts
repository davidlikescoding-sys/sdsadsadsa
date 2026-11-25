/**
 * Browser-side research orchestrator. It never invents facts: every sentence in
 * the answer is extracted from a real page fetched through /api/research/read.
 * Retrieved text is untrusted data — it is scored and quoted, never obeyed.
 */
import { answerSentence } from "../learning";
import { isUntrustedWebText } from "./evidence";
import { answerPatternBonus, dedupe, detectFactQuestion, extractCapital, extractPerson, keywords, overlap, relevance, sentences } from "./text";
import type {
  LocalKnowledgeMatch, ResearchActivity, ResearchCitation, ResearchFinding, ResearchIntent,
  ResearchStage, SearchHit, SourceSearchResult, WebPage, WebResearchResult,
} from "./types";
import type { FactQuestion } from "./text";

export interface ResearchDeps {
  search: (query: string, intent: ResearchIntent, signal?: AbortSignal) => Promise<SourceSearchResult[]>;
  read: (url: string, signal?: AbortSignal) => Promise<WebPage>;
  localKnowledge?: LocalKnowledgeMatch[];
  /** Recent conversation text, used only to resolve an unspecified comparison subject. */
  historyContext?: string;
  onActivity?: (activity: ResearchActivity) => void;
  signal?: AbortSignal;
  maxPages?: number;
}

const NEWS_WORDS = /\b(latest|news|today|current|recent|happened|happening|update|updates|developments|this week|headlines|now)\b/i;
const TUTORIAL_WORDS = /\b(tutorial|learn|explain|explanation|guide|introduction|teach|walkthrough|how (?:do|does|to|can)|steps)\b/i;
const TECHNICAL_WORDS = /\b(api|code|coding|javascript|typescript|python|react|next\.?js|algorithm|implementation|error|debug|library|github|model training)\b/i;
const LOCAL_ONLY = /^(hi|hey|hello|thanks|thank you|bye|goodbye|ok|okay|yes|no)[.!?\s]*$/i;
const LOCAL_DATA = /\b(my|our|this)\b[^.?!]{0,40}\b(memor(?:y|ies)|settings|model|training|checkpoints?|knowledge base|feedback|conversations?|dictionary)\b/i;

function activityId(): string {
  return `ra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Decide what kind of research the question needs, and whether the web is needed at all. */
export function understandQuestion(question: string): { intent: ResearchIntent; terms: string[]; needWeb: boolean; reason: string } {
  const trimmed = question.trim();
  const terms = keywords(trimmed, 8);
  if (LOCAL_ONLY.test(trimmed)) return { intent: "general", terms, needWeb: false, reason: "Greetings do not need internet research." };
  if (LOCAL_DATA.test(trimmed)) return { intent: "general", terms, needWeb: false, reason: "This asks about your local lab data, which is answered from this browser." };
  if (/^[\d\s+\-*/().=^%x]+$/i.test(trimmed) && /[+\-*/=^]/.test(trimmed)) return { intent: "general", terms, needWeb: false, reason: "Arithmetic is computed locally, not searched online." };
  if (terms.length === 0) return { intent: "general", terms, needWeb: false, reason: "The question has no searchable terms." };
  if (/\bcompar\w*\b/i.test(trimmed) && /\b(website|site|source|paper|article)\w*\b/i.test(trimmed) && /\b(three|multiple|different|several|various)\b/i.test(trimmed)) {
    return { intent: "comparison", terms, needWeb: true, reason: "The question asks for information from several different websites." };
  }
  if (detectFactQuestion(trimmed)) return { intent: "general", terms, needWeb: true, reason: "A specific current fact is best answered from reference sources." };
  if (NEWS_WORDS.test(trimmed)) return { intent: "news", terms, needWeb: true, reason: "The question asks for current information." };
  if (TUTORIAL_WORDS.test(trimmed)) return { intent: "tutorial", terms, needWeb: true, reason: "The question asks for an explanation or tutorial." };
  if (TECHNICAL_WORDS.test(trimmed)) return { intent: "technical", terms, needWeb: true, reason: "The question asks for technical information." };
  return { intent: "general", terms, needWeb: true, reason: "A factual question benefits from current web sources." };
}

/** Turn the question into real search queries, never into a canned answer. */
export function generateQueries(question: string, intent: ResearchIntent, terms: string[]): string[] {
  const primary = question.trim().replace(/\?+$/, "").replace(/^(can you|could you|please|tell me)\s+/i, "").slice(0, 140);
  const year = String(new Date().getFullYear());
  const suffix = intent === "news" ? `news today ${year}` : intent === "tutorial" ? "tutorial" : intent === "technical" ? "documentation" : "";
  const secondaryTerms = terms.slice(0, 6).join(" ");
  const secondary = suffix ? `${secondaryTerms} ${suffix}` : secondaryTerms;
  return dedupe([primary, secondary].filter((q) => q.length >= 2), (q) => q);
}

function sourcePriority(intent: ResearchIntent, source: string): number {
  if (intent === "news") {
    return { "google-news": 0.3, "hacker-news": 0.22, wikipedia: 0.05, duckduckgo: 0.04, arxiv: 0.02 }[source] ?? 0;
  }
  if (intent === "tutorial" || intent === "technical") {
    return { wikipedia: 0.16, arxiv: 0.12, "hacker-news": 0.05, duckduckgo: 0.08, "google-news": 0.02 }[source] ?? 0;
  }
  return { wikipedia: 0.16, duckduckgo: 0.09, "google-news": 0.05, arxiv: 0.03, "hacker-news": 0.03 }[source] ?? 0;
}

interface Candidate { text: string; score: number; hit: SearchHit; page?: WebPage }

/** Score a quoted statement against the subject the user actually asked about. */
function statementScore(text: string, terms: string[], fact: FactQuestion | null): number {
  let score = relevance(text, terms) + answerPatternBonus(text);
  if (!fact) return score;
  const lower = text.toLowerCase();
  score -= fact.required.filter((term) => !lower.includes(term)).length * 0.35;
  if (fact.kind === "capital") {
    if (extractCapital(text)) score += 0.9;
    if (/\bcapital\s+(?:punishment|gains?|crimes?|expenditure|allocation|investment)\b/i.test(text)) score -= 1.2;
  }
  if (fact.kind === "person" && fact.role && extractPerson(text, fact.role)) score += 0.9;
  return score;
}

function cleanSentence(value: string): string {
  const cleaned = value
    .replace(/^[\s>*#`\-–—]+/, "")
    .replace(/\s+/g, " ")
    .replace(/\[\s*\d+\s*\]$/, "")
    .trim()
    .slice(0, 340);
  // Page text is untrusted data. Never quote instruction-like text as fact.
  return isUntrustedWebText(cleaned) ? "" : cleaned;
}

/** Full pipeline: plan → search → open → extract → compare → answer. */
export async function runWebResearch(question: string, deps: ResearchDeps): Promise<WebResearchResult> {
  const startedAt = new Date().toISOString();
  const activities: ResearchActivity[] = [];
  const errors: string[] = [];
  const emit = (stage: ResearchStage, status: ResearchActivity["status"], message: string, detail?: string) => {
    const item: ResearchActivity = { id: activityId(), stage, status, message, detail, at: new Date().toISOString() };
    activities.push(item);
    deps.onActivity?.(item);
  };
  const checkAbort = () => { if (deps.signal?.aborted) throw new DOMException("Research stopped.", "AbortError"); };

  const understood = understandQuestion(question);
  emit("understanding", "ok", "Understood the question", `${understood.reason} Intent: ${understood.intent}.`);

  // "Compare three websites" with no named subject: resolve it from the current conversation.
  let effectiveQuestion = question;
  let effectiveTerms = understood.terms;
  const META_TERMS = new Set(["compare", "comparison", "different", "three", "websites", "website", "sources", "source", "information", "subject", "same", "about", "find", "show"]);
  const isMetaQuestion = effectiveTerms.length > 0 && effectiveTerms.every((term) => META_TERMS.has(term));
  if (isMetaQuestion && deps.historyContext) {
    // Prefer the last real user question; role labels never become search terms.
    const userLines = deps.historyContext.split("\n").map((line) => line.trim()).filter((line) => /^user:/i.test(line) && line.length > 8);
    const lastUser = userLines[userLines.length - 1];
    if (lastUser) {
      effectiveQuestion = lastUser.replace(/^user:\s*/i, "").replace(/\?+$/, "").slice(0, 140);
      effectiveTerms = keywords(effectiveQuestion, 8);
      emit("understanding", "ok", "Resolved the comparison subject", `Used the earlier question: “${effectiveQuestion.slice(0, 90)}”.`);
    }
  }
  // Comparison questions are lists by nature. A specific "who is / what is the
  // capital" question is a single value even when it contains "current".
  const fact = understood.intent === "comparison" ? null : detectFactQuestion(effectiveQuestion);
  if (fact) emit("understanding", "ok", "Detected a single-value factual question", `Looking for one value for “${fact.label}”, not a paragraph of related facts.`);
  const queries = generateQueries(effectiveQuestion, understood.intent, effectiveTerms);
  emit("planning", "ok", "Planned web queries", queries.map((q) => `“${q}”`).join(" · "));

  if (!understood.needWeb) {
    emit("searching", "skipped", "Web search skipped", understood.reason);
    return {
      usedWeb: false, question, queries: [], answer: "", citations: [], findings: [], activities,
      localKnowledge: deps.localKnowledge ?? [], startedAt, finishedAt: new Date().toISOString(), errors,
      skippedReason: understood.reason,
    };
  }

  if (deps.localKnowledge?.length) {
    emit("local", "ok", "Checked your knowledge base first", `${deps.localKnowledge.length} local passage(s) matched this question.`);
  } else {
    emit("local", "skipped", "Checked your knowledge base first", "No matching local entry; the web is needed.");
  }

  checkAbort();
  const searchBatches = await Promise.all(queries.map(async (query) => {
    emit("searching", "running", `Searching free sources for “${query}”`);
    try {
      const results = await deps.search(query, understood.intent, deps.signal);
      for (const result of results) {
        if (result.ok) emit("searching", "ok", `${result.source} returned ${result.hits.length} result(s)`, `Query: ${query} · ${result.elapsedMs} ms`);
        else { emit("searching", "error", `${result.source} unavailable`, result.error); errors.push(`${result.source}: ${result.error}`); }
      }
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit("searching", "error", "Search request failed", message);
      errors.push(message);
      return [] as SourceSearchResult[];
    }
  }));

  const allResults = searchBatches.flat();
  const hits = dedupe(allResults.flatMap((result) => result.hits), (item) => item.url)
    .map((item) => {
      const normalized = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const titleWords = normalized.split(" ").filter(Boolean);
      const matched = effectiveTerms.filter((term) => normalized.includes(term)).length;
      const precision = matched / Math.max(1, titleWords.length);
      const titleScore = relevance(item.title, effectiveTerms);
      const subjectText = `${item.title} ${item.snippet}`.toLowerCase();
      const subjectHit = fact
        ? fact.required.filter((term) => subjectText.includes(term)).length / fact.required.length
        : 0;
      const score = relevance(`${item.title} ${item.snippet}`, effectiveTerms) * 0.3
        + titleScore * 0.3 + 0.6 * Math.min(1, precision)
        + (fact ? subjectHit * 0.8 : 0)
        + sourcePriority(understood.intent, item.source);
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((value) => value.item);

  if (!hits.length) {
    emit("opening", "error", "No web results could be retrieved", errors.slice(0, 3).join(" · ") || "All sources returned no usable results.");
    return {
      usedWeb: false, question, queries, answer: "I could not retrieve any usable web results for this question. The search services may be blocked or the query may be too narrow. No answer was invented.",
      citations: [], findings: [], activities, localKnowledge: deps.localKnowledge ?? [], startedAt,
      finishedAt: new Date().toISOString(), errors,
    };
  }

  const pageLimit = Math.min(5, Math.max(1, deps.maxPages ?? 3));
  const perSourceLimit = understood.intent === "comparison" ? 1 : understood.intent === "news" ? 2 : pageLimit;
  const selected: typeof hits = [];
  const sourceCounts = new Map<string, number>();
  for (const hit of hits) {
    if (selected.length >= pageLimit) break;
    const used = sourceCounts.get(hit.source) ?? 0;
    if (used >= perSourceLimit) continue;
    selected.push(hit);
    sourceCounts.set(hit.source, used + 1);
  }
  for (const hit of hits) {
    if (selected.length >= pageLimit) break;
    if (!selected.some((entry) => entry.url === hit.url)) selected.push(hit);
  }
  emit("opening", "ok", `Selected ${selected.length} promising page(s) from ${new Set(selected.map((h) => h.source)).size} service(s)`, selected.map((h) => `${h.source}: ${h.title}`).join(" · "));

  checkAbort();
  const pages = await Promise.all(selected.map(async (hit) => {
    if (hit.source === "google-news") {
      // Google News links are JS redirects: the feed snippet is the only
      // dependable text. Use it as a labelled headline instead of fetching a
      // redirect that commonly returns 429/502.
      emit("opening", "skipped", "Using headline from Google News", "Google News links are redirect pages; the snippet is kept as a headline-only finding.");
      return { hit, page: undefined };
    }
    emit("opening", "running", `Opening ${hit.source}: ${hit.title}`, hit.url);
    try {
      const page = await deps.read(hit.url, deps.signal);
      emit("opening", "ok", `Read ${page.title || hit.source}`, `${page.bytes.toLocaleString()} bytes · ${page.text.length.toLocaleString()} characters${page.truncated ? " (truncated)" : ""}`);
      return { hit, page };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit("opening", "error", `Could not open ${hit.source}`, `${message} · ${hit.url}`);
      errors.push(`${hit.source}: ${message}`);
      return { hit, page: undefined };
    }
  }));

  const findings: ResearchFinding[] = pages.map(({ hit, page }) => {
    const extracted = page ? sentences(page.text).map(cleanSentence).filter(Boolean) : [];
    const ranked = extracted
      .map((text) => ({ text, score: statementScore(text, effectiveTerms, fact) }))
      .filter((value) => value.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((value) => value.text);
    const headlineOnly = !page;
    const usable = ranked.length ? ranked : [cleanSentence(hit.snippet)].filter((text) => text.length > 30);
    return { hit, page, sentences: usable, relevance: relevance(`${hit.title} ${usable.join(" ")}`, effectiveTerms), headlineOnly };
  }).filter((finding) => finding.sentences.length > 0);

  emit("extracting", findings.length ? "ok" : "error", `Extracted ${findings.reduce((n, f) => n + f.sentences.length, 0)} relevant statement(s)`, findings.map((f) => `${f.hit.source}: ${f.sentences.length}`).join(" · "));

  const comparison = findings.slice(0, 4).map((f) => `${f.hit.source} — ${f.sentences[0].slice(0, 150)}`);
  emit("comparing", comparison.length ? "ok" : "error", `Compared ${new Set(findings.map((f) => f.hit.source)).size} source(s)`, comparison.join(" | "));

  const candidates: Candidate[] = dedupe(
    findings.flatMap((finding) => {
      const titleWords: string[] = finding.hit.title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      const matchedTerms = effectiveTerms.filter((term) => titleWords.includes(term) || titleWords.includes(term.replace(/s$/, ""))).length;
      const precision = matchedTerms / Math.max(1, titleWords.length);
      const focus = 0.55 + Math.min(1, precision);
      return finding.sentences.map((text) => ({
        text,
        score: statementScore(text, effectiveTerms, fact) * focus
          + finding.relevance * 0.3 - (finding.headlineOnly ? 0.5 : 0),
        hit: finding.hit, page: finding.page,
      }));
    }),
    (candidate) => candidate.text,
  );

  // Round-robin across sources so the answer is not just one website repeated.
  const bySource = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const list = bySource.get(candidate.hit.source) ?? [];
    list.push(candidate);
    bySource.set(candidate.hit.source, list);
  }
  for (const list of bySource.values()) list.sort((a, b) => b.score - a.score);
  // A single-value question gets one answer; lists of news, tutorials or
  // comparison results legitimately need several statements.
  const answerLimit = fact ? 1
    : understood.intent === "comparison" ? 4
      : understood.intent === "news" ? 3
        : understood.intent === "tutorial" || understood.intent === "technical" ? 3
          : 1;
  const chosen: Candidate[] = [];
  const usedSources = new Set<string>();
  for (let round = 0; round < answerLimit && chosen.length < answerLimit; round += 1) {
    for (const [source, list] of bySource) {
      if (chosen.length >= answerLimit) break;
      if (usedSources.has(source) && list.length <= round) continue;
      const candidate = list[round];
      if (!candidate) continue;
      if (chosen.some((item) => overlap(item.text, candidate.text) > 0.82)) continue;
      chosen.push(candidate);
      usedSources.add(source);
    }
  }

  const citations: ResearchCitation[] = [];
  for (const candidate of chosen) {
    if (!citations.some((entry) => entry.url === candidate.hit.url)) {
      citations.push({ index: citations.length + 1, title: candidate.hit.title, url: candidate.hit.url, source: candidate.hit.source });
    }
  }
  const citationFor = (candidate: Candidate) => citations.find((entry) => entry.url === candidate.hit.url)!;
  const factLines = chosen.map((candidate) => {
    const citation = citationFor(candidate);
    return candidate.page
      ? `${candidate.text} [${citation.index}]`
      : `Headline from ${candidate.hit.source} (full article page could not be retrieved): “${candidate.text}” [${citation.index}]`;
  });

  // Local knowledge is shown only when it names the same subject as the
  // question. A generic hit about Ottawa must not appear under a question
  // about France.
  const localTerms = effectiveTerms.filter((term) => term.length > 2);
  const local = (deps.localKnowledge ?? [])
    .filter((entry) => {
      const text = entry.text.toLowerCase();
      return localTerms.length > 0 && localTerms.every((term) => text.includes(term));
    })
    .slice(0, 1)
    .map((entry) => {
      // Use the same dialogue-aware extraction as the local answer path so a
      // flattened dataset never contributes its header or its User question.
      const sentence = answerSentence(entry.text, localTerms, 180);
      return sentence ? `“${sentence}” (${entry.title})` : "";
    })
    .filter(Boolean);

  let answer: string;
  const capitalValue = fact?.kind === "capital" && chosen[0] ? extractCapital(chosen[0].text) : null;
  const personValue = fact?.kind === "person" && fact.role && chosen[0]
    ? extractPerson(chosen[0].text, fact.role) : null;
  if (capitalValue && fact && chosen[0]) {
    const citation = citationFor(chosen[0]);
    answer = [
      `The capital of ${fact.label} is ${capitalValue}. [${citation.index}]`,
      "",
      ...(local.length ? ["From your local knowledge base (not from the web):", ...local, ""] : []),
      "This statement was extracted from the linked page, not generated from DavidAI's trained weights.",
    ].join("\n");
  } else if (personValue && fact?.kind === "person" && fact.role && chosen[0]) {
    const citation = citationFor(chosen[0]);
    const label = fact.label;
    const adjective = /\b(?:an|ese|ish|i|ic)$/i.test(label);
    const subject = adjective ? `${label} ${fact.role}` : `${fact.role} of ${label}`;
    answer = [
      `The current ${subject} is ${personValue}. [${citation.index}]`,
      "",
      ...(local.length ? ["From your local knowledge base (not from the web):", ...local, ""] : []),
      "This statement was extracted from the linked page, not generated from DavidAI's trained weights.",
    ].join("\n");
  } else if (factLines.length && answerLimit === 1) {
    answer = [
      factLines[0],
      "",
      ...(local.length ? ["From your local knowledge base (not from the web):", ...local, ""] : []),
      "This statement was extracted from the linked page, not generated from DavidAI's trained weights.",
    ].join("\n");
  } else if (factLines.length) {
    answer = [
      `Based on ${citations.length} current web source${citations.length === 1 ? "" : "s"}:`,
      "",
      ...factLines.map((line, index) => `${index + 1}. ${line}`),
      "",
      ...(local.length ? ["From your local knowledge base (not from the web):", ...local, ""] : []),
      "These statements were extracted from the linked pages; the wording comes from those sources, not from DavidAI's trained weights.",
    ].join("\n");
  } else {
    answer = "I opened webpages but could not extract a statement that clearly answers this question. I will not guess. Try a more specific question or check the source list below.";
  }

  emit("answering", factLines.length ? "ok" : "error", `Prepared answer from ${factLines.length} statement(s)`, `${citations.length} source(s) cited${errors.length ? ` · ${errors.length} source error(s)` : ""}`);
  return {
    usedWeb: true, question, queries, answer, citations, findings: findings.filter((f) => citations.some((c) => c.url === f.hit.url)),
    activities, localKnowledge: deps.localKnowledge ?? [], startedAt, finishedAt: new Date().toISOString(), errors,
  };
}
