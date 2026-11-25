import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { DatabaseSync } from "node:sqlite";
import { hashBrainText, upsertDocumentChunk } from "./db";
import { classifyBrainCategory, tokenizeBrainText } from "./extract";

const SUPPORTED = new Set(["txt", "md", "markdown", "json", "csv", "log", "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "java", "c", "cpp", "h", "rs", "go", "php", "rb", "sh", "sql", "html", "css", "pdf"]);

export interface ImportedDocumentResult {
  name: string;
  chunks: number;
  characters: number;
  category: string;
}

export interface ImportDocumentOptions {
  /** Version label supplied by the caller, e.g. a framework major version or git tag. */
  docVersion?: string;
  sourceUrl?: string;
  retrievedAt?: string;
}

interface DocumentDraft {
  content: string;
  section?: string;
  symbol?: string;
}

function extension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

const CODE_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "java", "c", "cpp", "h", "rs", "go", "php", "rb", "sh", "sql", "css", "html", "cs"]);
const DECLARATION = /(?:^|\n)[ \t]*(?:(?:export|default|async|pub|static|final|override|abstract)\s+)*(function|class|const|let|var|interface|type|enum|struct|impl|def|fn|func|method|component)\s+([A-Za-z_$][\w$]*)/g;

function decodePdfString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/^\(|\)$/g, "");
}

function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const streams: string[] = [];
  const regex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) {
    let content = match[1];
    try {
      const bytes = Buffer.from(content, "latin1");
      if (bytes[0] === 0x78) content = inflateSync(bytes).toString("latin1");
    } catch {
      // Some PDF streams are uncompressed; keep the original bytes.
    }
    streams.push(content);
    if (streams.length > 400) break;
  }
  const pieces: string[] = [];
  for (const content of streams) {
    const literal = content.match(/\((?:\\.|[^\\)])*\)/g) ?? [];
    for (const token of literal.slice(0, 4000)) {
      const decoded = decodePdfString(token).trim();
      if (decoded.length > 1) pieces.push(decoded);
    }
  }
  return pieces.join(" ").replace(/\s+/g, " ").slice(0, 1_500_000);
}

export function extractDocumentText(name: string, buffer: Buffer): string {
  const ext = extension(name);
  if (!SUPPORTED.has(ext)) throw new Error(`Unsupported file type .${ext}. Use TXT, PDF, Markdown, JSON, CSV, or a programming source file.`);
  if (ext === "pdf") {
    const text = extractPdfText(buffer);
    if (text.length < 20) throw new Error("No readable text could be extracted from this PDF. Scanned/image-only PDFs are not supported offline.");
    return text;
  }
  return buffer.toString("utf8").replace(/\u0000/g, "").slice(0, 1_500_000);
}

function chunkText(text: string, size = 1100, overlap = 120): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(". ", end);
      if (boundary > start + size * 0.5) end = boundary + 1;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk.length >= 40) chunks.push(chunk);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks.slice(0, 2000);
}

/** Preserve headings and code symbols so documentation can be cited structurally. */
function structuredChunks(text: string, ext: string): DocumentDraft[] {
  const drafts: DocumentDraft[] = [];
  if (ext === "md" || ext === "markdown") {
    let section: string | undefined;
    let buffer: string[] = [];
    const flush = () => {
      if (!buffer.length) return;
      for (const content of chunkText(buffer.join("\n"))) drafts.push({ content, section });
      buffer = [];
    };
    for (const line of text.split(/\r?\n/)) {
      const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        flush();
        section = heading[1].slice(0, 200);
        continue;
      }
      buffer.push(line);
    }
    flush();
    return drafts.length ? drafts.slice(0, 2000) : chunkText(text).map((content) => ({ content }));
  }

  if (CODE_EXTENSIONS.has(ext)) {
    const matches = Array.from(text.matchAll(DECLARATION));
    if (matches.length >= 2) {
      if (matches[0].index && matches[0].index > 0) {
        for (const content of chunkText(text.slice(0, matches[0].index))) drafts.push({ content });
      }
      matches.forEach((match, index) => {
        const from = match.index ?? 0;
        const to = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
        const symbol = match[2]?.slice(0, 160);
        for (const content of chunkText(text.slice(from, to))) drafts.push({ content, symbol });
      });
      return drafts.slice(0, 2000);
    }
  }
  return chunkText(text).map((content) => ({ content }));
}

export function importDocument(db: DatabaseSync, name: string, buffer: Buffer, options: ImportDocumentOptions = {}): ImportedDocumentResult {
  const text = extractDocumentText(name, buffer);
  const ext = extension(name);
  const drafts = structuredChunks(text, ext);
  if (!drafts.length) throw new Error("The file did not contain enough readable text to learn from.");
  const category = classifyBrainCategory(`${name} ${text.slice(0, 2000)}`);
  const docSha256 = createHash("sha256").update(text).digest("hex");
  const docVersion = options.docVersion?.trim().slice(0, 120) || undefined;
  const suppliedUrl = options.sourceUrl?.trim();
  const source = suppliedUrl && /^https?:\/\//i.test(suppliedUrl) ? suppliedUrl : `file:${name}`;
  for (const [index, draft] of drafts.entries()) {
    const chunk = draft.content;
    upsertDocumentChunk(db, {
      name: `${name}#${index + 1}`,
      content: chunk,
      category,
      keywords: tokenizeBrainText(`${name} ${draft.section ?? ""} ${draft.symbol ?? ""} ${chunk}`).slice(0, 60),
      source,
      hash: hashBrainText(`document:${name}:${docVersion ?? ""}:${docSha256}:${draft.section ?? ""}:${draft.symbol ?? ""}:${chunk}`),
      path: name,
      section: draft.section,
      symbol: draft.symbol,
      language: ext,
      docVersion,
      docSha256,
      retrievedAt: options.retrievedAt,
    });
  }
  return { name, chunks: drafts.length, characters: text.length, category };
}

export function deleteDocument(db: DatabaseSync, id: string): boolean {
  const result = db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  if (!result.changes) return false;
  db.prepare("DELETE FROM document_fts WHERE id = ?").run(id);
  db.prepare("DELETE FROM embeddings WHERE id = ?").run(id);
  db.prepare("DELETE FROM embeddings_v2 WHERE id = ?").run(id);
  return true;
}

export function exportTrainingDataset(db: DatabaseSync): string {
  // Training export is deliberately limited to reviewed/sourced knowledge.
  // Unverified conversation extraction and disputed/outdated items are never
  // treated as training examples.
  const rows = db.prepare("SELECT title, content, category, keywords, source_type, confidence, verification FROM knowledge WHERE verification IN ('sourced', 'user-reported') ORDER BY created_at ASC").all() as Array<Record<string, unknown>>;
  const lines: string[] = [];
  for (const row of rows) {
    const content = String(row.content);
    const match = /^Q:\s*([\s\S]*?)\s*A:\s*([\s\S]*)$/.exec(content);
    const item = match
      ? { instruction: match[1].trim(), output: match[2].trim() }
      : { instruction: `Explain ${String(row.title)}`, output: content };
    lines.push(JSON.stringify({
      ...item,
      category: String(row.category),
      keywords: JSON.parse(String(row.keywords)) as string[],
      source: String(row.source_type),
      confidence: Number(row.confidence),
      verification: String(row.verification),
    }));
  }
  return lines.join("\n");
}
