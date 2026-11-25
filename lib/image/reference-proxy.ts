import { validatePublicUrl } from "../research/http";

const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org", "commons.wikimedia.org"]);
const MAX_BYTES = 2_500_000;
const TIMEOUT_MS = 12_000;
const ALLOWED_TYPES = /^image\/(png|jpeg|webp|gif)$/i;

export interface SafeImageResult {
  bytes: Uint8Array;
  contentType: string;
}

/** Fetches a reference thumbnail through a strict allowlist for local analysis only. */
export async function fetchReferenceImage(rawUrl: string, signal?: AbortSignal): Promise<SafeImageResult> {
  let url: URL;
  try { url = await validatePublicUrl(rawUrl); }
  catch { throw new Error("Only public Wikimedia image URLs are allowed."); }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw new Error("That image host is not allowed.");

  let current = url.toString();
  for (let redirect = 0; redirect <= 2; redirect++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let response: Response;
    try {
      response = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "DavidAI-visual-research/1.0" } });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect did not include a destination.");
      const next = new URL(location, current).toString();
      const validated = await validatePublicUrl(next);
      if (!ALLOWED_HOSTS.has(validated.hostname.toLowerCase())) throw new Error("Redirected image host is not allowed.");
      current = validated.toString();
      continue;
    }
    if (!response.ok) throw new Error(`Reference image request failed (${response.status}).`);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!ALLOWED_TYPES.test(contentType)) throw new Error("Only PNG, JPEG, WebP and GIF references are allowed.");
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new Error("Reference image is too large.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Reference image had no readable body.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); throw new Error("Reference image exceeded the size limit."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, contentType };
  }
  throw new Error("Too many redirects while loading the reference image.");
}
