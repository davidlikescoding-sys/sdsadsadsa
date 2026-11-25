/**
 * Server-only HTTP helper for web research.
 * Enforces: http(s) only, public addresses only, fixed ports, redirect revalidation,
 * request timeouts, response-size caps, and text-only content types.
 * Downloads are treated strictly as data; no JavaScript is ever executed.
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const MAX_BYTES = 1_200_000;
const TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 3;
// DuckDuckGo's free JSON API unfortunately labels JSON as application/x-javascript.
const ALLOWED_TYPES = /^(text\/|application\/(json|xml|javascript|x-javascript|xhtml\+xml|rss\+xml|atom\+xml))/i;
const BLOCKED_HOSTS = new Set([
  "localhost", "localhost.localdomain", "metadata.google.internal", "instance-data",
]);

function privateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateIp(mapped[1]) : false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Validate a URL against SSRF rules and return a normalised URL object. */
export async function validatePublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Only ports 80 and 443 are allowed.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("Local or internal addresses are not allowed.");
  }
  const version = isIP(host);
  if (version) {
    if (privateIp(host)) throw new Error("Local or internal addresses are not allowed.");
    return url;
  }
  let addresses: Array<{ address: string }>;
  try { addresses = await lookup(host, { all: true }); } catch { throw new Error("Could not resolve that website."); }
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) {
    throw new Error("That website resolves to a local or internal address.");
  }
  return url;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
  bytes: number;
  truncated: boolean;
  error?: string;
}

interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

/** Fetch a URL as text with hard timeout, size and redirect limits. */
export async function safeFetchText(rawUrl: string, options: FetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = Math.min(30000, Math.max(1000, options.timeoutMs ?? TIMEOUT_MS));
  const maxBytes = Math.min(3_000_000, Math.max(1000, options.maxBytes ?? MAX_BYTES));
  let url = await validatePublicUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; DavidAI-LocalResearch/1.0; +https://example.org/davidai)",
          accept: "text/html,text/plain,application/xhtml+xml,application/json,application/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Redirect without a location (${response.status}).`);
        url = await validatePublicUrl(new URL(location, url).toString());
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok) return { ok: false, status: response.status, url: url.toString(), contentType, text: "", bytes: 0, truncated: false, error: `Website returned HTTP ${response.status}.` };
      if (!ALLOWED_TYPES.test(contentType)) return { ok: false, status: response.status, url: url.toString(), contentType, text: "", bytes: 0, truncated: false, error: `Unsupported content type: ${contentType.split(";")[0] || "unknown"}.` };
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: response.status, url: url.toString(), contentType, text: "", bytes: declared, truncated: true, error: "Page is too large to read safely." };
      if (!response.body) return { ok: false, status: response.status, url: url.toString(), contentType, text: "", bytes: 0, truncated: false, error: "Empty response." };

      const decoder = new TextDecoder("utf-8");
      let text = "";
      let bytes = 0;
      let truncated = false;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        if (bytes + chunk.byteLength > maxBytes) {
          const room = Math.max(0, maxBytes - bytes);
          text += decoder.decode(chunk.subarray(0, room), { stream: false });
          bytes += room;
          truncated = true;
          controller.abort();
          break;
        }
        text += decoder.decode(chunk, { stream: true });
        bytes += chunk.byteLength;
      }
      if (!truncated) text += decoder.decode();
      return { ok: true, status: response.status, url: url.toString(), contentType, text, bytes, truncated, error: truncated ? "Page was truncated at the size limit." : undefined };
    }
    throw new Error("Too many redirects.");
  } catch (error) {
    const aborted = controller.signal.aborted;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, url: url.toString(), contentType: "", text: "", bytes: 0, truncated: false, error: aborted && /timeout|abort/i.test(message) ? "Request timed out." : message };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", onAbort);
  }
}
