/** Shared, serialisable types for the real web-research pipeline. */

export type ResearchSource = "wikipedia" | "duckduckgo" | "google-news" | "hacker-news" | "arxiv";

/** What kind of answer the question needs; decides which free sources are queried. */
export type ResearchIntent = "general" | "news" | "tutorial" | "technical" | "comparison";

export interface SearchHit {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: ResearchSource;
  publishedAt?: string;
}

export interface SourceSearchResult {
  source: ResearchSource;
  query: string;
  hits: SearchHit[];
  ok: boolean;
  error?: string;
  elapsedMs: number;
}

export interface WebPage {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  fetchedAt: string;
  bytes: number;
  truncated: boolean;
}

export type ResearchStage =
  | "understanding"
  | "planning"
  | "searching"
  | "opening"
  | "extracting"
  | "comparing"
  | "answering"
  | "local";

export interface ResearchActivity {
  id: string;
  stage: ResearchStage;
  status: "running" | "ok" | "error" | "skipped";
  message: string;
  detail?: string;
  at: string;
}

export interface ResearchFinding {
  hit: SearchHit;
  page?: WebPage;
  sentences: string[];
  relevance: number;
  /** True when the linked page could not be read and only the feed headline is available. */
  headlineOnly?: boolean;
}

export interface ResearchCitation {
  index: number;
  title: string;
  url: string;
  source: string;
}

export interface LocalKnowledgeMatch {
  title: string;
  text: string;
}

export interface WebResearchResult {
  usedWeb: boolean;
  question: string;
  queries: string[];
  answer: string;
  citations: ResearchCitation[];
  findings: ResearchFinding[];
  activities: ResearchActivity[];
  localKnowledge: LocalKnowledgeMatch[];
  startedAt: string;
  finishedAt: string;
  errors: string[];
  skippedReason?: string;
}
