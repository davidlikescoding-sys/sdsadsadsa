/**
 * Server-only search adapters. Every hit comes from a real HTTP response from a
 * free public service. No keys, no accounts, no mocked or hard-coded results.
 */
import { safeFetchText } from "./http";
import { cleanText, decodeEntities, htmlToText, stripTags, xmlAttribute, xmlBlocks, xmlText } from "./text";
import type { ResearchIntent, ResearchSource, SearchHit, SourceSearchResult } from "./types";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const DDG_API = "https://api.duckduckgo.com/";
const HN_API = "https://hn.algolia.com/api/v1/search_by_date";
const ARXIV_API = "https://export.arxiv.org/api/query";
const NEWS_RSS = "https://news.google.com/rss/search";

function hit(source: ResearchSource, title: string, url: string, snippet: string, publishedAt?: string): SearchHit | null {
  const cleanTitle = cleanText(decodeEntities(stripTags(title))).slice(0, 180);
  const cleanUrl = cleanText(url);
  if (!cleanTitle || !/^https?:\/\//i.test(cleanUrl)) return null;
  return {
    id: `${source}:${cleanUrl}`,
    title: cleanTitle,
    url: cleanUrl,
    snippet: cleanText(decodeEntities(stripTags(snippet))).slice(0, 420),
    source,
    ...(publishedAt ? { publishedAt } : {}),
  };
}

async function searchWikipedia(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const url = `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&utf8=1`;
  const response = await safeFetchText(url, { signal });
  if (!response.ok) throw new Error(response.error ?? "Wikipedia search failed.");
  const data = JSON.parse(response.text) as { query?: { search?: Array<{ title: string; snippet: string }> } };
  return (data.query?.search ?? [])
    .map((row) => hit("wikipedia", row.title, `https://en.wikipedia.org/wiki/${encodeURIComponent(row.title.replace(/ /g, "_"))}`, row.snippet ?? ""))
    .filter((value): value is SearchHit => value !== null);
}

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const url = `${DDG_API}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const response = await safeFetchText(url, { signal });
  if (!response.ok) throw new Error(response.error ?? "DuckDuckGo search failed.");
  const data = JSON.parse(response.text) as {
    Heading?: string; AbstractText?: string; AbstractURL?: string; DefinitionText?: string; DefinitionURL?: string;
    RelatedTopics?: Array<{ FirstURL?: string; Result?: string; Text?: string }>;
  };
  const results: Array<SearchHit | null> = [];
  if (data.AbstractText && data.AbstractURL) results.push(hit("duckduckgo", data.Heading || query, data.AbstractURL, data.AbstractText));
  if (data.DefinitionText && data.DefinitionURL) results.push(hit("duckduckgo", data.Heading || query, data.DefinitionURL, data.DefinitionText));
  for (const topic of (data.RelatedTopics ?? []).slice(0, 4)) {
    if (!topic.FirstURL) continue;
    const text = topic.Text || htmlToText(topic.Result ?? "").text;
    results.push(hit("duckduckgo", text.split(/[—-]/)[0] || query, topic.FirstURL, text));
  }
  return results.filter((value): value is SearchHit => value !== null);
}

async function searchGoogleNews(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const url = `${NEWS_RSS}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const response = await safeFetchText(url, { signal, maxBytes: 1_500_000 });
  if (!response.ok) throw new Error(response.error ?? "News search failed.");
  return xmlBlocks(response.text, "item").slice(0, 6).map((block) => {
    const title = xmlText(block, "title");
    const link = xmlText(block, "link");
    const date = xmlText(block, "pubDate");
    const publisher = xmlText(block, "source");
    const publishedAt = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : undefined;
    const snippet = [title, publisher, publishedAt ? new Date(publishedAt).toLocaleDateString("en-US") : ""].filter(Boolean).join(" — ");
    return hit("google-news", title, link, snippet, publishedAt);
  }).filter((value): value is SearchHit => value !== null);
}

async function searchHackerNews(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const url = `${HN_API}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=6`;
  const response = await safeFetchText(url, { signal });
  if (!response.ok) throw new Error(response.error ?? "Hacker News search failed.");
  const data = JSON.parse(response.text) as { hits?: Array<{ objectID?: string; title?: string; url?: string; story_text?: string; created_at?: string }> };
  return (data.hits ?? []).map((row) => {
    const link = row.url || (row.objectID ? `https://news.ycombinator.com/item?id=${row.objectID}` : "");
    const publishedAt = row.created_at && !Number.isNaN(Date.parse(row.created_at)) ? new Date(row.created_at).toISOString() : undefined;
    return hit("hacker-news", row.title ?? "", link, row.story_text || row.title || "", publishedAt);
  }).filter((value): value is SearchHit => value !== null);
}

async function searchArxiv(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 8).join("+AND+");
  const url = `${ARXIV_API}?search_query=all:${terms}&start=0&max_results=4&sortBy=relevance`;
  const response = await safeFetchText(url, { signal });
  if (!response.ok) throw new Error(response.error ?? "arXiv search failed.");
  return xmlBlocks(response.text, "entry").map((block) => {
    const link = xmlAttribute(block, "link", "href") || xmlText(block, "id");
    const date = xmlText(block, "published");
    const publishedAt = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : undefined;
    return hit("arxiv", xmlText(block, "title"), link, xmlText(block, "summary"), publishedAt);
  }).filter((value): value is SearchHit => value !== null);
}

const ADAPTERS: Record<ResearchSource, (query: string, signal?: AbortSignal) => Promise<SearchHit[]>> = {
  wikipedia: searchWikipedia,
  duckduckgo: searchDuckDuckGo,
  "google-news": searchGoogleNews,
  "hacker-news": searchHackerNews,
  arxiv: searchArxiv,
};

/** Which free services to query for this kind of question. */
export function sourcesForIntent(intent: ResearchIntent): ResearchSource[] {
  if (intent === "comparison") return ["wikipedia", "duckduckgo", "google-news", "hacker-news", "arxiv"];
  if (intent === "news") return ["google-news", "hacker-news", "wikipedia"];
  if (intent === "tutorial") return ["wikipedia", "arxiv", "duckduckgo"];
  if (intent === "technical") return ["wikipedia", "arxiv", "hacker-news"];
  return ["wikipedia", "duckduckgo", "google-news"];
}

/** Run each source independently so one blocked service never fails the research. */
export async function searchSources(queries: string[], intent: ResearchIntent, signal?: AbortSignal): Promise<SourceSearchResult[]> {
  const sources = sourcesForIntent(intent);
  const query = queries[0] ?? "";
  const tasks = sources.map(async (source): Promise<SourceSearchResult> => {
    const started = Date.now();
    try {
      const hits = await ADAPTERS[source](query, signal);
      return { source, query, hits, ok: true, elapsedMs: Date.now() - started };
    } catch (error) {
      return { source, query, hits: [], ok: false, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started };
    }
  });
  return Promise.all(tasks);
}
