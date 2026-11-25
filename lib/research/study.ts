/**
 * Bounded Internet Study engine.
 *
 * It searches free public sources, reads real pages through the same SSRF-safe
 * route used by chat, extracts topic-relevant statements, and returns structured
 * findings that the page can save to local knowledge. Retrieved text is always
 * untrusted data: it is scored and quoted, never treated as instructions.
 */
import { findingToWebEvidence, isUntrustedWebText } from "./evidence";
import { answerPatternBonus, dedupe, keywords, relevance, sentences } from "./text";
import { findWebEntry, isNewerFinding, webKnowledgeFields, WEB_CATEGORY } from "./knowledge";
import type {
  ResearchActivity, ResearchFinding, ResearchIntent, ResearchStage,
  SearchHit, SourceSearchResult, WebPage,
} from "./types";
import type { KnowledgeEntry } from "../types";

export interface StudyDeps {
  search: (query: string, intent: ResearchIntent, signal?: AbortSignal) => Promise<SourceSearchResult[]>;
  read: (url: string, signal?: AbortSignal) => Promise<WebPage>;
  onActivity?: (activity: ResearchActivity) => void;
  signal?: AbortSignal;
  /** Hard cap on pages opened in one activation. */
  maxPages?: number;
  /** Hard cap on statements stored per page. */
  maxSentencesPerPage?: number;
  /** Used only to report that local knowledge was checked first. */
  localEntryCount?: number;
}

export interface StudyResult {
  topic: string;
  queries: string[];
  activities: ResearchActivity[];
  findings: ResearchFinding[];
  errors: string[];
  pagesRead: number;
  startedAt: string;
  finishedAt: string;
}

export interface StudySaveResult {
  added: number;
  updated: number;
  skipped: number;
}

interface StudySaveDeps {
  findings: ResearchFinding[];
  knowledge: KnowledgeEntry[];
  topic: string;
  addKnowledge: (entry: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">) => KnowledgeEntry;
  updateKnowledge: (id: string, patch: Partial<KnowledgeEntry>) => void;
}

const SOURCE_BONUS: Record<string, number> = {
  wikipedia: 0.18,
  duckduckgo: 0.1,
  "google-news": 0.05,
  arxiv: 0.04,
  "hacker-news": 0.03,
};

// Page chrome and instruction-like text are never absorbed as knowledge.
// The same filter is used by chat research and the brain evidence boundary.
const PAGE_CHROME = /^(?:advertisement|sponsored|share|follow|read more|cookie|privacy|terms|about us|contact us|home|menu|search|log in|sign in)\b/i;

function activityId(): string {
  return `study-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Turn a broad topic into a small, real search plan — never into canned facts. */
export function studyQueries(topic: string): string[] {
  const clean = topic.trim().replace(/\s+/g, " ").slice(0, 90);
  if (clean.length < 2) return [];
  return dedupe([
    clean,
    `${clean} overview`,
    `${clean} important facts`,
    `explain ${clean}`,
  ], (query) => query);
}

function queryIntent(index: number): ResearchIntent {
  return index === 3 ? "tutorial" : "general";
}

function cleanStatement(value: string): string {
  return value
    .replace(/^[\s>*#`\-–—]+/, "")
    .replace(/\[\s*\d+\s*\]$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 340);
}

function statementScore(text: string, terms: string[], headlineOnly: boolean): number {
  const score = relevance(text, terms) + answerPatternBonus(text);
  return headlineOnly ? score - 0.35 : score;
}

function rankHits(hits: SearchHit[], terms: string[]): SearchHit[] {
  return dedupe(hits, (hit) => hit.url)
    .map((hit) => {
      const text = `${hit.title} ${hit.snippet}`.toLowerCase();
      const matched = terms.filter((term) => text.includes(term)).length;
      const coverage = terms.length ? matched / terms.length : 0;
      const score = relevance(text, terms) * 0.6 + coverage * 0.4 + (SOURCE_BONUS[hit.source] ?? 0);
      return { hit, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((value) => value.hit);
}

/** Choose a diverse but bounded set of pages, with no source monopolising the session. */
export function selectStudyPages(hits: SearchHit[], maxPages: number): SearchHit[] {
  const limit = Math.min(12, Math.max(1, Math.floor(maxPages) || 4));
  const perSource = Math.max(1, Math.ceil(limit / 2));
  const selected: SearchHit[] = [];
  const counts = new Map<string, number>();
  for (const hit of hits) {
    if (selected.length >= limit) break;
    const used = counts.get(hit.source) ?? 0;
    if (used >= perSource) continue;
    selected.push(hit);
    counts.set(hit.source, used + 1);
  }
  for (const hit of hits) {
    if (selected.length >= limit) break;
    if (!selected.some((entry) => entry.url === hit.url)) selected.push(hit);
  }
  return selected;
}

function extractStatements(
  hit: SearchHit,
  page: WebPage | undefined,
  terms: string[],
  limit: number,
): string[] {
  const headlineOnly = !page;
  const raw = page ? sentences(page.text) : [hit.snippet];
  const minLength = headlineOnly ? 30 : 45;
  const ranked = raw
    .map(cleanStatement)
    .filter((text) => text.length >= minLength && /[a-z]{3}/i.test(text))
    .filter((text) => !isUntrustedWebText(text) && !PAGE_CHROME.test(text))
    .map((text) => ({ text, score: statementScore(text, terms, headlineOnly) }))
    .filter((value) => value.score > 0.14)
    .sort((a, b) => b.score - a.score)
    .map((value) => value.text);
  return dedupe(ranked, (text) => text).slice(0, Math.max(1, Math.min(6, limit)));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Run one complete, bounded study activation. */
export async function runInternetStudy(topic: string, deps: StudyDeps): Promise<StudyResult> {
  const startedAt = new Date().toISOString();
  const activities: ResearchActivity[] = [];
  const errors: string[] = [];
  const cleanTopic = topic.trim().replace(/\s+/g, " ").slice(0, 90);
  const emit = (stage: ResearchStage, status: ResearchActivity["status"], message: string, detail?: string) => {
    const activity: ResearchActivity = {
      id: activityId(), stage, status, message, detail, at: new Date().toISOString(),
    };
    activities.push(activity);
    deps.onActivity?.(activity);
  };
  const checkAbort = () => {
    if (deps.signal?.aborted) throw new Error("Internet Study was stopped.");
  };

  const queries = studyQueries(cleanTopic);
  if (!queries.length) {
    emit("understanding", "error", "No study topic was provided");
    return {
      topic: cleanTopic, queries, activities, findings: [], errors: ["Enter a topic to study."],
      pagesRead: 0, startedAt, finishedAt: new Date().toISOString(),
    };
  }
  const terms = keywords(cleanTopic, 8);
  emit("understanding", "ok", `Prepared to study “${cleanTopic}”`, `${terms.length} topic term(s) will be used to score retrieved statements.`);
  if (deps.localEntryCount !== undefined) {
    emit("local", "ok", "Checked local knowledge first", `${deps.localEntryCount} saved knowledge entry/entries are already available.`);
  }
  emit("planning", "ok", `Planned ${queries.length} web queries`, queries.map((query) => `“${query}”`).join(" · "));

  checkAbort();
  const searchBatches = await Promise.all(queries.map(async (query, index) => {
    const intent = queryIntent(index);
    emit("searching", "running", `Searching free sources for “${query}”`, `Intent: ${intent}.`);
    try {
      const results = await deps.search(query, intent, deps.signal);
      for (const result of results) {
        if (result.ok) emit("searching", "ok", `${result.source} returned ${result.hits.length} result(s)`, `Query: ${query} · ${result.elapsedMs} ms`);
        else { emit("searching", "error", `${result.source} unavailable`, result.error); errors.push(`${result.source}: ${result.error}`); }
      }
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit("searching", "error", "Study search failed", message);
      errors.push(message);
      return [] as SourceSearchResult[];
    }
  }));

  const hits = rankHits(searchBatches.flatMap((batch) => batch.flatMap((result) => result.hits)), terms);
  if (!hits.length) {
    emit("opening", "error", "No usable web results were found", errors.slice(0, 3).join(" · ") || "All free sources returned no results.");
    return {
      topic: cleanTopic, queries, activities, findings: [], errors,
      pagesRead: 0, startedAt, finishedAt: new Date().toISOString(),
    };
  }

  const selected = selectStudyPages(hits, deps.maxPages ?? 8);
  emit("opening", "ok", `Selected ${selected.length} page(s) from ${new Set(selected.map((hit) => hit.source)).size} service(s)`, selected.map((hit) => `${hit.source}: ${hit.title}`).join(" · "));

  checkAbort();
  const perPageLimit = Math.max(1, Math.min(6, Math.floor(deps.maxSentencesPerPage ?? 4)));
  const opened = await mapWithConcurrency(selected, 3, async (hit) => {
    if (hit.source === "google-news") {
      emit("opening", "skipped", "Kept Google News headline", "Google News links are redirect pages; only the feed headline is used.");
      return { hit, page: undefined as WebPage | undefined };
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
      return { hit, page: undefined as WebPage | undefined };
    }
  });

  const findings: ResearchFinding[] = opened
    .map(({ hit, page }) => {
      const sentencesToStore = extractStatements(hit, page, terms, perPageLimit);
      return {
        hit,
        page,
        sentences: sentencesToStore,
        relevance: relevance(`${hit.title} ${sentencesToStore.join(" ")}`, terms),
        headlineOnly: !page,
      };
    })
    .filter((finding) => finding.sentences.length > 0);

  const statementCount = findings.reduce((total, finding) => total + finding.sentences.length, 0);
  emit("extracting", statementCount ? "ok" : "error", `Extracted ${statementCount} study statement(s)`, findings.map((finding) => `${finding.hit.source}: ${finding.sentences.length}`).join(" · "));
  emit("comparing", findings.length ? "ok" : "error", `Reviewed ${new Set(findings.map((finding) => finding.hit.source)).size} source(s)`, "Statements are kept as quoted evidence, not instructions.");

  return {
    topic: cleanTopic,
    queries,
    activities,
    findings,
    errors,
    pagesRead: opened.filter((entry) => Boolean(entry.page)).length,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\W+/g, "");
}

function findStudyEntry(finding: ResearchFinding, knowledge: KnowledgeEntry[], topic: string): KnowledgeEntry | undefined {
  const byUrl = findWebEntry(knowledge, finding);
  if (byUrl) return byUrl;
  const title = normalized(finding.hit.title);
  const titled = normalized(`${topic}: ${finding.hit.title}`);
  return knowledge.find((entry) => {
    if (entry.category !== WEB_CATEGORY) return false;
    const entryTitle = normalized(entry.title);
    return entryTitle === title || entryTitle === titled || (title.length > 12 && entryTitle.endsWith(title));
  });
}

/** Save findings with URL and retrieval date, avoiding duplicates and refreshing older entries. */
export function saveStudyFindings({
  findings, knowledge, topic, addKnowledge, updateKnowledge,
}: StudySaveDeps): StudySaveResult {
  const result: StudySaveResult = { added: 0, updated: 0, skipped: 0 };
  const seen = new Set(knowledge.map((entry) => normalized(entry.sourceUrl ?? entry.title)));
  for (const finding of findings) {
    const existing = findStudyEntry(finding, knowledge, topic);
    const baseFields = webKnowledgeFields(finding);
    if (!baseFields) {
      result.skipped += 1;
      continue;
    }
    const fields = {
      ...baseFields,
      title: `${topic}: ${finding.hit.title}`.slice(0, 180),
    };
    const key = normalized(finding.hit.url);
    if (!existing && seen.has(key)) {
      result.skipped += 1;
    } else if (!existing) {
      addKnowledge(fields);
      seen.add(key);
      result.added += 1;
    } else if (isNewerFinding(existing, finding)) {
      updateKnowledge(existing.id, fields);
      result.updated += 1;
    } else {
      result.skipped += 1;
    }
  }
  return result;
}

export interface BrainMirrorResult {
  saved: number;
  failed: number;
}

/**
 * Mirror saved study evidence into the SQLite brain so /api/brain/answer can
 * retrieve it. The browser store remains authoritative for the study page;
 * this is an additive, best-effort local write of the same filtered evidence.
 */
export async function mirrorStudyFindingsToBrain(findings: ResearchFinding[]): Promise<BrainMirrorResult> {
  const result: BrainMirrorResult = { saved: 0, failed: 0 };
  for (const finding of findings) {
    const evidence = findingToWebEvidence(finding);
    if (!evidence) {
      result.failed += 1;
      continue;
    }
    try {
      const response = await fetch("/api/brain/research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(evidence),
      });
      if (response.ok) result.saved += 1;
      else result.failed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
