/** Server-only webpage reader: validates the URL, fetches text, and never runs page code. */
import { validatePublicUrl, safeFetchText } from "./http";
import { cleanText, htmlToText } from "./text";
import type { WebPage } from "./types";

function pageFromText(url: string, finalUrl: string, title: string, text: string, bytes: number, truncated: boolean): WebPage {
  const capped = text.length > 16000 ? `${text.slice(0, 16000).trimEnd()} …` : text;
  return { url, finalUrl, title: title.slice(0, 200), text: capped, fetchedAt: new Date().toISOString(), bytes, truncated: truncated || capped.length !== text.length };
}

async function readWikipedia(url: URL, signal?: AbortSignal): Promise<WebPage | null> {
  if (url.hostname !== "en.wikipedia.org" || !url.pathname.startsWith("/wiki/")) return null;
  const title = decodeURIComponent(url.pathname.slice("/wiki/".length)).replace(/_/g, " ").replace(/#.*$/, "");
  const api = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=1&redirects=1&titles=${encodeURIComponent(title)}&format=json&utf8=1`;
  const response = await safeFetchText(api, { signal });
  if (!response.ok) throw new Error(response.error ?? "Wikipedia article could not be read.");
  const data = JSON.parse(response.text) as { query?: { pages?: Record<string, { title?: string; extract?: string }> } };
  const page = Object.values(data.query?.pages ?? {})[0];
  const text = cleanText(page?.extract ?? "");
  if (!text) return null;
  return pageFromText(url.toString(), url.toString(), page?.title || title, text, response.bytes, response.truncated);
}

export async function readWebPage(rawUrl: string, signal?: AbortSignal): Promise<WebPage> {
  const url = await validatePublicUrl(rawUrl);
  const wiki = await readWikipedia(url, signal);
  if (wiki) return wiki;

  const response = await safeFetchText(url.toString(), { signal });
  if (!response.ok) throw new Error(response.error ?? "Webpage could not be read.");
  const isXml = /xml/i.test(response.contentType);
  const extracted = isXml
    ? { title: "", text: cleanText(response.text) }
    : htmlToText(response.text);
  const text = extracted.text || cleanText(response.text);
  if (text.length < 40) throw new Error("No readable text was found on that page.");
  return pageFromText(rawUrl, response.url, extracted.title || url.hostname, text, response.bytes, response.truncated);
}
