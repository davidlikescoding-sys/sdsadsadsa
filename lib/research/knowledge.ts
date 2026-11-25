/** Helpers for saving retrieved web facts into the existing local knowledge base. */
import type { KnowledgeEntry } from "../types";
import { cleanWebEvidence, isUntrustedWebText } from "./evidence";
import type { ResearchFinding } from "./types";

export const WEB_CATEGORY = "Web Research";

export function cleanFindingSentences(finding: ResearchFinding): string[] {
  return Array.from(new Set(
    finding.sentences
      .map(cleanWebEvidence)
      .filter((text) => text.length >= 24 && !isUntrustedWebText(text)),
  )).slice(0, 6);
}

export function webKnowledgeContent(finding: ResearchFinding): string {
  const retrievedAt = finding.page?.fetchedAt ?? new Date().toISOString();
  const pageTitle = cleanWebEvidence(finding.page?.title ?? "");
  return [
    `Source: ${finding.hit.url}`,
    `Retrieved: ${retrievedAt}`,
    `Service: ${finding.hit.source}`,
    ...(pageTitle ? [`Page: ${pageTitle}`] : []),
    "",
    ...cleanFindingSentences(finding).map((text) => `- ${text}`),
  ].join("\n");
}

/** Prevent duplicate entries; a same-title entry from another URL is treated as an update. */
export function findWebEntry(knowledge: KnowledgeEntry[], finding: ResearchFinding): KnowledgeEntry | undefined {
  const url = finding.hit.url.toLowerCase();
  const title = finding.hit.title.toLowerCase().replace(/\W+/g, "");
  return knowledge.find((entry) => {
    if (entry.category !== WEB_CATEGORY) return false;
    if (entry.sourceUrl && entry.sourceUrl.toLowerCase() === url) return true;
    return entry.title.toLowerCase().replace(/\W+/g, "") === title;
  });
}

export function webKnowledgeFields(finding: ResearchFinding) {
  const sentences = cleanFindingSentences(finding);
  if (!sentences.length) return null;
  const retrievedAt = finding.page?.fetchedAt ?? new Date().toISOString();
  const pageTitle = cleanWebEvidence(finding.page?.title ?? "");
  return {
    category: WEB_CATEGORY,
    title: finding.hit.title,
    content: webKnowledgeContent(finding),
    sourceUrl: finding.hit.url,
    sourceTitle: pageTitle || finding.hit.title,
    retrievedAt,
  };
}

/** True when a newer retrieval should replace an older saved passage. */
export function isNewerFinding(existing: KnowledgeEntry, finding: ResearchFinding): boolean {
  const next = finding.page?.fetchedAt ?? new Date().toISOString();
  const previous = existing.retrievedAt ?? existing.updatedAt;
  return Date.parse(next) > Date.parse(previous) && webKnowledgeContent(finding) !== existing.content;
}
