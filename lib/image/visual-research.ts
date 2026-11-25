/**
 * Bounded visual research using Wikimedia Commons metadata.
 *
 * Web text is untrusted data. Descriptions are cleaned, capped and mined for
 * appearance phrases; reference images are never copied into generated results.
 */
import { cleanText, htmlToText, keywords } from "../research/text";
import { safeFetchText } from "../research/http";
import { makeId } from "../storage";
import type {
  ImageActivity,
  ReferenceImage,
  VisualConcept,
  VisualResearchResult,
  VisualSource,
  VisualSourceLicense,
  VisualSubject,
} from "./types";
import { conceptNeedsResearch, extractAttributes, mergeConcept, upsertConcept } from "./visual-knowledge";

const API = "https://commons.wikimedia.org/w/api.php";
const MAX_DESCRIPTION = 600;

export interface VisualResearchInput {
  prompt: string;
  subjects: VisualSubject[];
  concepts: VisualConcept[];
  force: boolean;
  maxReferences: number;
  signal?: AbortSignal;
  onActivity?: (event: Omit<ImageActivity, "id" | "at">) => void;
}

interface CommonsImageInfo {
  thumburl?: string;
  url?: string;
  descriptionurl?: string;
  width?: number;
  height?: number;
  extmetadata?: Record<string, { value?: string }>;
}

interface CommonsPage {
  pageid?: number;
  title?: string;
  imageinfo?: CommonsImageInfo[];
}

function emit(input: VisualResearchInput, stage: ImageActivity["stage"], status: ImageActivity["status"], message: string, detail?: string): void {
  input.onActivity?.({ stage, status, message, detail });
}

function licenseFrom(value: string | undefined): VisualSourceLicense {
  const text = (value ?? "").toLowerCase();
  if (!text) return "Unknown";
  if (/public domain|pdm|pd-old|pd-self|cc-pdm/.test(text)) return "Public domain";
  if (/cc0/.test(text)) return "CC0";
  if (/cc.by.sa|cc-by-sa/.test(text)) return "CC BY-SA";
  if (/cc.by.nc|cc-by-nc/.test(text)) return "CC BY-NC";
  if (/cc.by|cc-by/.test(text)) return "CC BY";
  if (/creativecommons|cc /.test(text)) return "Other free license";
  return "Unknown";
}

function freeLicense(license: VisualSourceLicense): boolean {
  return license === "Public domain" || license === "CC0" || license === "CC BY" || license === "CC BY-SA";
}

function metadataText(value: string | undefined): string {
  if (!value) return "";
  const plain = htmlToText(value, 9000).text;
  return cleanText(plain).replace(/\s+/g, " ").slice(0, MAX_DESCRIPTION);
}

function subjectQuery(name: string): string {
  return `${name} filetype:bitmap`.replace(/\s+/g, " ").trim();
}

/**
 * Wikimedia's full-text search returns very few results when several nouns and
 * scene words are combined. Research each visual subject separately, then add
 * one broader scene query as a final fallback for mixed-subject requests.
 */
function buildQueries(input: VisualResearchInput): string[] {
  const researchable = input.subjects.filter((subject) => subject.category !== "style" && subject.category !== "lighting");
  const names = researchable.slice(0, 3).map((subject) => subject.name);
  const queries = names.map(subjectQuery);
  const combinedNames = names.slice(0, 2).join(" ");
  const sceneTerms = keywords(input.prompt, 8).filter((term) =>
    !combinedNames.toLowerCase().includes(term) && !/generate|image|picture|photo|make|create|draw/.test(term)).slice(0, 2).join(" ");
  if (combinedNames && sceneTerms) queries.push(`${combinedNames} ${sceneTerms} filetype:bitmap`.replace(/\s+/g, " ").trim());
  return [...new Set(queries)].slice(0, 4);
}

async function searchCommons(query: string, limit: number, signal?: AbortSignal): Promise<CommonsPage[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(14, Math.max(6, limit + 4))),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "360",
  });
  const result = await safeFetchText(`${API}?${params.toString()}`, { timeoutMs: 9000, maxBytes: 2_000_000, signal });
  if (!result.ok) throw new Error(`Reference search failed (${result.status}).`);
  const parsed = JSON.parse(result.text) as { query?: { pages?: Record<string, CommonsPage> } };
  return Object.values(parsed.query?.pages ?? {});
}

function toReference(page: CommonsPage, sourceName: string, query = ""): ReferenceImage | null {
  const info = page.imageinfo?.[0];
  if (!info?.thumburl || !info.descriptionurl || !info.url) return null;
  const meta = info.extmetadata ?? {};
  const title = metadataText(meta.ObjectName?.value) || cleanText(page.title ?? "Reference").replace(/^File:/i, "").slice(0, 160);
  const description = metadataText(meta.ImageDescription?.value) || metadataText(meta.ObjectName?.value) || "";
  const license = licenseFrom(meta.LicenseShortName?.value);
  if (!freeLicense(license)) return null;
  const characteristics = extractAttributes(`${query} ${title} ${description} ${Object.values(meta).map((item) => item.value ?? "").join(" ")}`, 8);
  const sourceUrl = info.descriptionurl.startsWith("https://") ? info.descriptionurl : info.url;
  const thumb = info.thumburl.startsWith("https://") ? info.thumburl : "";
  if (!thumb || !sourceUrl) return null;
  return {
    id: String(page.pageid ?? makeId()),
    title: title || "Untitled reference",
    description: description.slice(0, MAX_DESCRIPTION),
    thumbnailUrl: `/api/image/reference?url=${encodeURIComponent(thumb)}`,
    pageUrl: sourceUrl,
    source: sourceName,
    license,
    width: info.width,
    height: info.height,
    colors: [],
    brightness: 0,
    characteristics,
  };
}

/**
 * Runs only when known concepts are insufficient or the user forces research.
 * Always returns a result; network failure is reported honestly as skipped.
 */
export async function runVisualResearch(input: VisualResearchInput): Promise<VisualResearchResult> {
  const completedAt = new Date().toISOString();
  const researchable = input.subjects.filter((subject) => subject.category !== "style" && subject.category !== "lighting");
  const needsResearch = researchable.some((subject) => conceptNeedsResearch(subject, input.force));
  if (!needsResearch) {
    emit(input, "researching", "ok", "Used existing visual knowledge", "Familiar subjects do not need another web lookup.");
    return {
      query: input.prompt, subjects: input.subjects, searches: [], references: [], characteristics: [],
      concepts: input.concepts, skipped: true, reason: "Existing visual knowledge covers these subjects.", completedAt,
    };
  }

  interface SearchBatch {
    query: string;
    pages: CommonsPage[];
    error?: string;
  }

  const queries = buildQueries(input);
  emit(input, "researching", "running", "Searching openly licensed references",
    `${queries.length} bounded query${queries.length === 1 ? "" : "ies"}: ${queries.join(" | ").slice(0, 220)}`);
  if (input.signal?.aborted) throw new Error("Visual research was stopped.");
  // Queries are independent and each has its own timeout. Running them together
  // keeps a four-subject lookup bound by the slowest single request instead of
  // their sum. Promise.all preserves query order, so round-robin evidence stays
  // deterministic. Failures are captured per query, never swallowed globally.
  const batches: SearchBatch[] = await Promise.all(queries.map(async (query) => {
    try {
      return { query, pages: await searchCommons(query, input.maxReferences, input.signal) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reference search failed.";
      emit(input, "researching", "error", "Reference search failed", `Query “${query.slice(0, 120)}”: ${message}`);
      return { query, pages: [], error: message };
    }
  }));
  if (input.signal?.aborted) throw new Error("Visual research was stopped.");

  const failures = batches.flatMap((batch) => batch.error ? [batch.error] : []);
  const successful = batches.filter((batch) => !batch.error);
  if (!successful.length) {
    const message = failures[0] ?? "Reference search failed.";
    emit(input, "researching", "error", "Reference search failed", message);
    return {
      query: queries.join(" · "), subjects: input.subjects, searches: queries, references: [], characteristics: [],
      concepts: input.concepts, skipped: true, reason: message, completedAt,
    };
  }

  const referencesByQuery = new Map<string, ReferenceImage[]>();
  for (const batch of successful) {
    referencesByQuery.set(batch.query, batch.pages
      .map((page) => toReference(page, "Wikimedia Commons", batch.query))
      .filter((item): item is ReferenceImage => Boolean(item))
      .slice(0, input.maxReferences));
  }
  // Round-robin so a multi-subject request shows evidence for each subject
  // instead of spending the whole budget on whichever query returned first.
  const queues = [...referencesByQuery.values()].map((found) => [...found]);
  const seenReferences = new Set<string>();
  const references: ReferenceImage[] = [];
  while (references.length < input.maxReferences && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const reference = queue.shift();
      if (!reference || seenReferences.has(reference.id)) continue;
      seenReferences.add(reference.id);
      references.push(reference);
      if (references.length >= input.maxReferences) break;
    }
  }
  emit(input, "analyzing", references.length ? "ok" : "error", `Analyzed ${references.length} reference description(s)`,
    references.length
      ? `Appearance phrases were extracted from captions and license metadata.${failures.length ? ` ${failures.length} query failed.` : ""}`
      : "No suitable openly licensed image metadata was returned.");

  const characteristics = [...new Set(references.flatMap((reference) => reference.characteristics))].slice(0, 18);
  let concepts = input.concepts;
  const now = new Date().toISOString();
  for (const subject of researchable) {
    if (!conceptNeedsResearch(subject, input.force)) continue;
    const ownReferences = referencesByQuery.get(subjectQuery(subject.name)) ?? references;
    const ownCharacteristics = [...new Set(ownReferences.flatMap((reference) => reference.characteristics))].slice(0, 12);
    const attributes = extractAttributes(`${input.prompt} ${ownCharacteristics.join(" ")}`, 16);
    if (!attributes.length && !ownReferences.length) continue;
    const sources: VisualSource[] = ownReferences.slice(0, 6).map((reference) => ({
      url: reference.pageUrl,
      pageUrl: reference.pageUrl,
      title: reference.title,
      license: reference.license,
      retrievedAt: now,
    }));
    const existing = concepts.find((concept) => concept.name.toLowerCase() === subject.name.toLowerCase());
    const base: VisualConcept = existing ?? {
      id: `visual:${subject.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: subject.name,
      category: subject.category,
      attributes: [],
      confidence: subject.confidence,
      sources: [],
      feedbackNotes: [],
      lastResearchedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const enhanced = mergeConcept(base, {
      attributes,
      sources,
      confidence: Math.max(0.62, subject.confidence),
      lastResearchedAt: now,
    });
    concepts = upsertConcept(concepts, enhanced);
  }

  return {
    query: queries.join(" · "),
    subjects: input.subjects,
    searches: queries,
    references,
    characteristics,
    concepts,
    skipped: false,
    reason: references.length
      ? (failures.length ? `${failures.length} of ${queries.length} queries failed; results shown are from successful queries.` : undefined)
      : "No suitable openly licensed references matched these subjects.",
    completedAt: now,
  };
}

/** Same-origin proxy URL for a Wikimedia thumbnail; validates the host. */
export function referenceProxyUrl(url: string): string {
  return `/api/image/reference?url=${encodeURIComponent(url)}`;
}
