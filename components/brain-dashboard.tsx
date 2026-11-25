"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, Input, PageHeader,
  Select, Stat, Textarea, formatNumber, timeAgo,
} from "@/components/ui";
import { BRAIN_CATEGORIES } from "@/lib/brain/types";

type Verification = "unverified" | "user-reported" | "sourced" | "disputed" | "outdated";
type ExportKind = "full" | "knowledge" | "conversations" | "training";

interface GrowthPoint {
  date: string;
  conversations: number;
  knowledge: number;
}

interface RecentKnowledge {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: string;
  verification: Verification;
}

interface FrequentKnowledge {
  id: string;
  title: string;
  retrievalCount: number;
}

interface BrainStats {
  conversations: number;
  messages: number;
  knowledgeEntries: number;
  corrections: number;
  researchRecords: number;
  documents: number;
  categories: number;
  databaseBytes: number;
  lastBackupAt?: string | null;
  integrity: string;
  schemaVersion: number;
  recentKnowledge: RecentKnowledge[];
  frequent: FrequentKnowledge[];
  growth: GrowthPoint[];
}

interface LocalModelInfo {
  executable: string;
  model: string;
  embeddingModel: string;
  executableReady: boolean;
  modelReady: boolean;
  embeddingReady: boolean;
  modelBytes: number;
  embeddingBytes: number;
}

interface BrainStatus {
  databasePath: string;
  ready: boolean;
  stats: BrainStats;
  localModel: LocalModelInfo;
}

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  keywords: string[];
  source: string;
  sourceType: string;
  sourceId?: string;
  confidence: number;
  verification: Verification;
  relatedIds: string[];
  createdAt: string;
  updatedAt: string;
  retrievalCount: number;
}

interface KnowledgePatch {
  title?: string;
  content?: string;
  category?: string;
  keywords?: string[];
  confidence?: number;
  verification?: Verification;
}

interface EditDraft {
  title: string;
  content: string;
  category: string;
  keywords: string;
  confidence: string;
  verification: Verification;
}

interface BrainBackup {
  id: string;
  path: string;
  size: number;
  integrity: string;
  createdAt: string;
}

interface BrainDocumentChunk {
  id: string;
  name: string;
  content: string;
  category: string;
  keywords: string[];
  source: string;
  hash: string;
  createdAt: string;
  path?: string;
  section?: string;
  symbol?: string;
  language?: string;
  docVersion?: string;
  docSha256?: string;
  retrievedAt?: string;
}

interface UploadResult {
  name: string;
  chunks: number;
  characters: number;
  category: string;
}

interface UploadOutcome {
  name: string;
  status: "queued" | "done" | "error";
  result?: UploadResult;
  error?: string;
}

const VERIFICATIONS: Verification[] = ["unverified", "user-reported", "sourced", "disputed", "outdated"];
const EXPORT_KINDS: ExportKind[] = ["full", "knowledge", "conversations", "training"];
const DOCUMENT_ACCEPT = [
  ".txt", ".text", ".log", ".md", ".markdown", ".pdf", ".json", ".csv",
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".sh", ".css", ".html", ".xml",
  "text/*", "application/pdf", "application/json",
].join(",");

const BLANK_DRAFT: EditDraft = {
  title: "", content: "", category: "general", keywords: "", confidence: "0.7", verification: "unverified",
};

const VERIFICATION_TONE: Record<Verification, "neutral" | "cyan" | "green" | "amber" | "red"> = {
  unverified: "neutral",
  "user-reported": "amber",
  sourced: "green",
  disputed: "red",
  outdated: "amber",
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorText(text: string, status: number): string {
  const trimmed = text.trim();
  if (!trimmed) return `HTTP ${status}`;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const body = parsed as Record<string, unknown>;
      const value = body.error ?? body.message;
      if (typeof value === "string" && value) return value;
    }
  } catch {
    // Plain-text error body.
  }
  return trimmed.slice(0, 300);
}

function jsonInit(method: "POST" | "PATCH", body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Every request in this component is relative and stays on the local Next.js server. */
async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch (error) {
    throw new Error(`Could not reach the local brain API (${path}): ${messageOf(error)}`);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text) as unknown; } catch { /* handled below */ }
  }
  if (!response.ok) throw new Error(errorText(text, response.status));
  if (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true) {
    throw new Error(`Unexpected response from ${path}: expected an envelope with ok: true.`);
  }
  return body as unknown as T;
}

function ago(iso?: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : timeAgo(iso);
}

function dateLabel(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function downloadText(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function GrowthBar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const width = max > 0 && Number.isFinite(value) ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800">
        <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-[10px] text-slate-300">{formatNumber(value)}</span>
    </div>
  );
}

export default function BrainDashboard() {
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [backups, setBackups] = useState<BrainBackup[]>([]);
  const [backupFiles, setBackupFiles] = useState<string[]>([]);
  const [documents, setDocuments] = useState<BrainDocumentChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>(BLANK_DRAFT);
  const [pendingKnowledgeDelete, setPendingKnowledgeDelete] = useState<string | null>(null);
  const [pendingDocumentDelete, setPendingDocumentDelete] = useState<string | null>(null);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoredStatus, setRestoredStatus] = useState<BrainStatus | null>(null);
  const [exportKind, setExportKind] = useState<ExportKind>("full");
  const [uploadResults, setUploadResults] = useState<UploadOutcome[]>([]);
  const [documentVersion, setDocumentVersion] = useState("");

  const importRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  const stats = status?.stats ?? null;
  const localModel = status?.localModel ?? null;

  const categories = useMemo(
    () => Array.from(new Set<string>([...BRAIN_CATEGORIES, ...entries.map((entry) => entry.category || "uncategorized")])).sort(),
    [entries],
  );
  const filterCategories = useMemo(
    () => (category !== "all" && !categories.includes(category) ? [category, ...categories] : categories),
    [categories, category],
  );
  const filteredEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter((entry) => category === "all" || entry.category === category)
      .filter((entry) => !needle || `${entry.title} ${entry.content} ${entry.keywords.join(" ")} ${entry.source}`.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [entries, search, category]);
  const growthMax = useMemo(
    () => Math.max(1, ...(stats?.growth ?? []).flatMap((point) => [point.conversations ?? 0, point.knowledge ?? 0])),
    [stats],
  );

  const refreshAll = async () => {
    const [statusResult, knowledgeResult, backupResult, documentResult] = await Promise.all([
      apiRequest<{ status: BrainStatus }>("/api/brain/status?fresh=1"),
      apiRequest<{ entries: KnowledgeEntry[] }>("/api/brain/knowledge?limit=200"),
      apiRequest<{ backups: BrainBackup[]; files: string[] }>("/api/brain/backup"),
      apiRequest<{ documents: BrainDocumentChunk[] }>("/api/brain/documents"),
    ]);
    if (!mountedRef.current) return;
    setStatus(statusResult.status);
    setEntries(Array.isArray(knowledgeResult.entries) ? knowledgeResult.entries : []);
    setBackups(Array.isArray(backupResult.backups) ? backupResult.backups : []);
    setBackupFiles(Array.isArray(backupResult.files) ? backupResult.files : []);
    setDocuments(Array.isArray(documentResult.documents) ? documentResult.documents : []);
  };

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    void (async () => {
      try {
        await refreshAll();
      } catch (cause) {
        if (mountedRef.current) setError(messageOf(cause));
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
    return () => { mountedRef.current = false; };
    // Initial local load only; refreshes are triggered explicitly after mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, action: () => Promise<string | void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (mountedRef.current && message) setNotice(message);
    } catch (cause) {
      if (mountedRef.current) setError(`${label} failed: ${messageOf(cause)}`);
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const startEdit = (entry: KnowledgeEntry) => {
    setError(null);
    setNotice(null);
    setEditingId(entry.id);
    setDraft({
      title: entry.title,
      content: entry.content,
      category: entry.category || "general",
      keywords: (entry.keywords ?? []).join(", "),
      confidence: Number.isFinite(entry.confidence) ? String(entry.confidence) : "0",
      verification: entry.verification ?? "unverified",
    });
  };

  const saveEdit = () => {
    const id = editingId;
    if (!id) return;
    const confidence = Number(draft.confidence);
    void run("Update knowledge", async () => {
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Confidence must be a number between 0 and 1.");
      const patch: KnowledgePatch = {
        title: draft.title.trim(),
        content: draft.content,
        category: draft.category.trim() || "general",
        keywords: draft.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
        confidence,
        verification: draft.verification,
      };
      await apiRequest<{ entry: KnowledgeEntry }>("/api/brain/knowledge", jsonInit("PATCH", { id, patch }));
      setEditingId(null);
      await refreshAll();
      return `Updated knowledge entry "${patch.title ?? id}".`;
    });
  };

  const deleteKnowledge = () => {
    const id = pendingKnowledgeDelete;
    if (!id) return;
    setPendingKnowledgeDelete(null);
    void run("Delete knowledge", async () => {
      await apiRequest<{ ok: true }>(`/api/brain/knowledge?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshAll();
      return `Deleted knowledge entry ${id}.`;
    });
  };

  const deleteDocument = () => {
    const id = pendingDocumentDelete;
    if (!id) return;
    setPendingDocumentDelete(null);
    void run("Delete document chunk", async () => {
      await apiRequest<{ ok: true }>(`/api/brain/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshAll();
      return `Deleted document chunk ${id}.`;
    });
  };

  const createBackup = () => {
    void run("Create backup", async () => {
      const result = await apiRequest<{ backup: unknown }>("/api/brain/backup", { method: "POST" });
      await refreshAll();
      return `Backup created: ${JSON.stringify(result.backup)}`;
    });
  };

  const restoreBackup = () => {
    const path = restorePath;
    if (!path) return;
    setRestoreOpen(false);
    void run("Restore", async () => {
      const result = await apiRequest<{ status: BrainStatus }>("/api/brain/restore", jsonInit("POST", { path }));
      setRestoredStatus(result.status);
      setRestorePath(null);
      await refreshAll();
      return `Restored from ${path}. The returned status is shown below.`;
    });
  };

  const downloadExport = (kind: ExportKind) => {
    void run(`Export ${kind}`, async () => {
      let response: Response;
      try {
        response = await fetch(`/api/brain/export?kind=${encodeURIComponent(kind)}`, { cache: "no-store" });
      } catch (cause) {
        throw new Error(`Could not reach the local export endpoint: ${messageOf(cause)}`);
      }
      const text = await response.text();
      if (!response.ok) throw new Error(errorText(text, response.status));
      const contentType = response.headers.get("content-type") ?? "";
      const extension = kind === "training" && !contentType.includes("application/json") ? "jsonl" : "json";
      const mime = extension === "jsonl" ? "application/x-ndjson" : "application/json";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadText(text, `davidai-brain-${kind}-${stamp}.${extension}`, mime);
      return `Downloaded the local ${kind} export (${formatNumber(text.length)} characters).`;
    });
  };

  const importFile = (file: File | undefined) => {
    if (!file) return;
    if (importRef.current) importRef.current.value = "";
    if (file.size > 50 * 1024 * 1024) {
      setNotice(null);
      setError("Import file is too large (50 MB limit).");
      return;
    }
    void run("Import brain data", async () => {
      const raw = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(raw) as unknown;
      } catch {
        throw new Error("The selected file is not valid JSON. Choose a brain export envelope.");
      }
      const result = await apiRequest<{ stats: unknown }>("/api/brain/import", jsonInit("POST", { data }));
      await refreshAll();
      return `Import complete. Stats: ${JSON.stringify(result.stats)}`;
    });
  };

  const uploadDocuments = (files: File[]) => {
    if (!files.length) return;
    const outcomes: UploadOutcome[] = files.map((file) => ({ name: file.name, status: "queued" }));
    setUploadResults(outcomes.map((item) => ({ ...item })));
    void run("Learn documents", async () => {
      const publish = () => {
        if (mountedRef.current) setUploadResults(outcomes.map((item) => ({ ...item })));
      };
      let cursor = 0;
      // Three parallel POSTs keep the local importer busy without saturating
      // the browser or the database. Results stay in the user's input order.
      const worker = async () => {
        while (true) {
          const index = cursor++;
          if (index >= files.length) return;
          const file = files[index];
          const form = new FormData();
          form.append("file", file);
          if (documentVersion.trim()) form.append("docVersion", documentVersion.trim());
          try {
            const response = await apiRequest<{ result: UploadResult }>("/api/brain/documents", { method: "POST", body: form });
            outcomes[index] = { name: file.name, status: "done", result: response.result };
          } catch (cause) {
            outcomes[index] = { name: file.name, status: "error", error: messageOf(cause) };
          }
          publish();
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
      } finally {
        await refreshAll();
      }
      const completed = outcomes.filter((item) => item.status === "done");
      const failed = outcomes.filter((item) => item.status === "error");
      const chunkTotal = completed.reduce((sum, item) => sum + (Number(item.result?.chunks) || 0), 0);
      if (!completed.length && failed.length) {
        throw new Error(`No files were stored. ${failed.map((item) => `${item.name}: ${item.error ?? "failed"}`).join("; ")}`);
      }
      const failureNote = failed.length ? ` Failed: ${failed.map((item) => item.name).join(", ")}.` : "";
      return `Stored ${completed.length} of ${files.length} file(s) as ${formatNumber(chunkTotal)} local document chunk(s). No network research was performed.${failureNote}`;
    });
  };

  const pendingKnowledge = entries.find((entry) => entry.id === pendingKnowledgeDelete) ?? null;
  const pendingDocument = documents.find((chunk) => chunk.id === pendingDocumentDelete) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Persistent SQLite Brain"
        title="Brain Dashboard"
        description="Transparent status of the local brain database. Every value below comes from local /api/brain route handlers; this dashboard makes no external network calls and performs no web research."
        actions={<Badge tone={status?.ready ? "green" : "amber"}>{status?.ready ? "database ready" : "database not ready"}</Badge>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" loading={busy === "Refresh"} onClick={() => void run("Refresh", async () => {
          await refreshAll();
          return "Local brain state refreshed.";
        })}>Refresh all</Button>
        {loading && <span className="font-mono text-[11px] text-cyan-400">Reading local database…</span>}
        {!loading && status && <span className="font-mono text-[10px] text-[var(--muted)]">{formatNumber(entries.length)} of {formatNumber(stats?.knowledgeEntries ?? 0)} knowledge entries loaded (limit 200)</span>}
      </div>

      <ErrorBox message={error} />
      {notice && <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300" role="status">{notice}</div>}

      {loading ? (
        <Card title="Local brain status" subtitle="Waiting for the local status endpoint">
          <div className="h-24 animate-pulse rounded border hairline bg-black/20" />
        </Card>
      ) : !status || !stats || !localModel ? (
        <EmptyState
          title="Local brain unavailable"
          description="The status endpoint did not return a brain status object. Check that the local /api/brain route handlers are installed, then retry."
          action={<Button size="sm" variant="outline" onClick={() => void run("Refresh", async () => {
            await refreshAll();
            return "Local brain state refreshed.";
          })}>Retry</Button>}
        />
      ) : (
        <>
          <Card title="Storage and integrity" subtitle="Exact counters reported by the local SQLite database">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              <Stat label="Conversations" value={formatNumber(stats.conversations)} />
              <Stat label="Messages" value={formatNumber(stats.messages)} />
              <Stat label="Knowledge entries" value={formatNumber(stats.knowledgeEntries)} />
              <Stat label="Corrections" value={formatNumber(stats.corrections)} />
              <Stat label="Research records" value={formatNumber(stats.researchRecords)} />
              <Stat label="Documents" value={formatNumber(stats.documents)} />
              <Stat label="Categories" value={formatNumber(stats.categories)} />
              <Stat label="Database size" value={formatNumber(stats.databaseBytes)} suffix="B" />
              <Stat label="Schema version" value={stats.schemaVersion} />
              <Stat
                label="Integrity"
                value={stats.integrity || "unknown"}
                tone={stats.integrity === "ok" ? "text-emerald-300" : "text-amber-300"}
              />
            </div>

            <div className="mt-4 grid gap-4 border-t hairline pt-4 lg:grid-cols-2">
              <div className="space-y-2 text-xs">
                <div className="mono-label">Database file</div>
                <div className="break-all font-mono text-[11px] text-slate-300">{status.databasePath || "—"}</div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={status.ready ? "green" : "red"}>{status.ready ? "ready" : "not ready"}</Badge>
                  <Badge tone="cyan">schema v{stats.schemaVersion}</Badge>
                  <Badge tone={stats.integrity === "ok" ? "green" : "amber"}>integrity: {stats.integrity || "unknown"}</Badge>
                </div>
                <p className="text-[11px] text-[var(--muted)]">
                  Last backup: {stats.lastBackupAt ? `${ago(stats.lastBackupAt)} · ${dateLabel(stats.lastBackupAt)}` : "never"}
                </p>
              </div>
              <div className="space-y-2 text-xs">
                <div className="mono-label">Local model and embeddings</div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={localModel.executableReady ? "green" : "red"}>executable {localModel.executableReady ? "ready" : "missing"}</Badge>
                  <Badge tone={localModel.modelReady ? "green" : "red"}>model {localModel.modelReady ? "ready" : "missing"}</Badge>
                  <Badge tone={localModel.embeddingReady ? "green" : "red"}>embedding {localModel.embeddingReady ? "ready" : "missing"}</Badge>
                </div>
                <dl className="grid gap-1 font-mono text-[10px] text-[var(--muted)] sm:grid-cols-2">
                  <div>executable: <span className="break-all text-slate-300">{localModel.executable || "—"}</span></div>
                  <div>model: <span className="break-all text-slate-300">{localModel.model || "—"}</span></div>
                  <div>embedding: <span className="break-all text-slate-300">{localModel.embeddingModel || "—"}</span></div>
                  <div>model bytes: <span className="text-slate-300">{formatNumber(localModel.modelBytes)}</span></div>
                  <div>embedding bytes: <span className="text-slate-300">{formatNumber(localModel.embeddingBytes)}</span></div>
                </dl>
                <p className="text-[11px] text-amber-300">Readiness reflects local files only. Nothing here fetches a model or performs web research.</p>
              </div>
            </div>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <Card title="Growth by date" subtitle="Daily counts from the local database; bar length is relative to the busiest day shown">
              {stats.growth.length ? (
                <div className="max-h-[300px] overflow-auto">
                  <div className="grid grid-cols-[105px_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b hairline pb-2">
                    <span className="mono-label">Date</span>
                    <span className="mono-label">Conversations</span>
                    <span className="mono-label">Knowledge</span>
                  </div>
                  {stats.growth.map((point) => (
                    <div key={point.date} className="grid grid-cols-[105px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 border-b hairline py-1.5" title={`${point.date}: ${point.conversations} conversations, ${point.knowledge} knowledge entries`}>
                      <span className="font-mono text-[10px] text-slate-400">{point.date}</span>
                      <GrowthBar value={point.conversations} max={growthMax} tone="bg-cyan-400" />
                      <GrowthBar value={point.knowledge} max={growthMax} tone="bg-emerald-400" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No growth data yet" description="Daily conversation and knowledge counts appear here once the brain records activity." />
              )}
            </Card>

            <div className="space-y-4">
              <Card title="Frequent knowledge" subtitle="Most retrieved stored entries">
                {stats.frequent.length ? (
                  <div className="max-h-40 space-y-1.5 overflow-auto">
                    {stats.frequent.slice(0, 10).map((item) => (
                      <div key={item.id} className="flex items-center gap-2 rounded border hairline bg-black/15 px-2.5 py-1.5 text-[11px]">
                        <span className="min-w-0 flex-1 truncate text-slate-200" title={item.title}>{item.title || item.id}</span>
                        <Badge tone="cyan">{formatNumber(item.retrievalCount)}×</Badge>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title="No retrievals yet" description="Entries will be ranked here after they are retrieved by the local brain." />}
              </Card>

              <Card title="Recent knowledge" subtitle="Newest stored entries with their verification state">
                {stats.recentKnowledge.length ? (
                  <div className="max-h-52 space-y-1.5 overflow-auto">
                    {stats.recentKnowledge.slice(0, 10).map((item) => (
                      <div key={item.id} className="rounded border hairline bg-black/15 px-2.5 py-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200" title={item.title}>{item.title || item.id}</span>
                          <Badge tone={VERIFICATION_TONE[item.verification] ?? "neutral"}>{item.verification}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[var(--muted)]">{item.content}</p>
                        <p className="mt-1 font-mono text-[10px] text-slate-500">{item.category} · {ago(item.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title="No knowledge yet" description="Stored knowledge appears here as soon as the local brain records it." />}
              </Card>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
            <Card
              title="Knowledge browser"
              subtitle={`${filteredEntries.length} shown · ${entries.length} loaded · search and filter run on the locally returned entries`}
              action={<Button size="sm" variant="ghost" loading={busy === "Refresh knowledge"} onClick={() => void run("Refresh knowledge", async () => {
                await refreshAll();
                return "Knowledge list refreshed.";
              })}>Refresh</Button>}
            >
              <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, content, keywords or source…" className="text-xs" aria-label="Search brain knowledge" />
                <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
                  <option value="all">All categories</option>
                  {filterCategories.map((item) => <option key={item} value={item}>{item}</option>)}
                </Select>
                {(search || category !== "all") && <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setCategory("all"); }}>Clear</Button>}
              </div>

              {filteredEntries.length === 0 ? (
                <EmptyState title="No knowledge entries found" description="Try a different search or category, or add knowledge through the local brain." />
              ) : (
                <div className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
                  {filteredEntries.map((entry) => (
                    <div key={entry.id} className="rounded border hairline bg-black/15 p-3">
                      {editingId === entry.id ? (
                        <div className="space-y-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field label="Title">
                              <Input value={draft.title} onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))} />
                            </Field>
                            <Field label="Category" hint="Existing categories are suggested; a new one is allowed.">
                              <Select value={categories.includes(draft.category) ? draft.category : "general"} onChange={(event) => setDraft((prev) => ({ ...prev, category: event.target.value }))}>
                                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                              </Select>
                            </Field>
                          </div>
                          <Field label="Content">
                            <Textarea rows={4} value={draft.content} onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))} className="text-xs" />
                          </Field>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <Field label="Keywords" hint="Comma-separated">
                              <Input value={draft.keywords} onChange={(event) => setDraft((prev) => ({ ...prev, keywords: event.target.value }))} />
                            </Field>
                            <Field label="Confidence" hint="0 to 1">
                              <Input type="number" step="0.01" min={0} max={1} value={draft.confidence} onChange={(event) => setDraft((prev) => ({ ...prev, confidence: event.target.value }))} />
                            </Field>
                            <Field label="Verification">
                              <Select value={draft.verification} onChange={(event) => setDraft((prev) => ({ ...prev, verification: event.target.value as Verification }))}>
                                {VERIFICATIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                              </Select>
                            </Field>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="primary" loading={busy === "Update knowledge"} onClick={saveEdit} disabled={!draft.title.trim() || !draft.content.trim()}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 max-w-[75%]">
                              <h3 className="truncate text-[13px] font-medium text-slate-100" title={entry.title}>{entry.title || "(untitled)"}</h3>
                              <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300">
                                {entry.content.length > 420 ? `${entry.content.slice(0, 420)}…` : entry.content}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge tone={VERIFICATION_TONE[entry.verification] ?? "neutral"}>{entry.verification}</Badge>
                              <Badge tone="cyan">{entry.category}</Badge>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--muted)]">
                            <span>retrieved {formatNumber(entry.retrievalCount)}×</span>
                            <span>confidence {Number.isFinite(entry.confidence) ? entry.confidence.toFixed(2) : "—"}</span>
                            <span>recorded source: {entry.sourceType}{entry.source ? ` · ${entry.source}` : ""}</span>
                            {entry.sourceId && <span>source id {entry.sourceId}</span>}
                            <span>created {ago(entry.createdAt)}</span>
                            <span>updated {ago(entry.updatedAt)}</span>
                            {entry.relatedIds?.length > 0 && <span>{entry.relatedIds.length} related</span>}
                          </div>
                          {entry.keywords?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {entry.keywords.slice(0, 8).map((keyword) => <Badge key={keyword}>{keyword}</Badge>)}
                            </div>
                          )}
                          <div className="mt-2 flex gap-2">
                            <button type="button" onClick={() => startEdit(entry)} className="focus-ring rounded px-1 font-mono text-[10px] text-slate-400 hover:text-cyan-300">Edit</button>
                            <button type="button" onClick={() => setPendingKnowledgeDelete(entry.id)} className="focus-ring rounded px-1 font-mono text-[10px] text-slate-400 hover:text-red-300">Delete</button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <Card title="Export and import" subtitle="Portable copies of the local brain data">
                <div className="space-y-3">
                  <Field label="Export kind" hint="Training exports may be JSONL; all other kinds are JSON.">
                    <Select value={exportKind} onChange={(event) => setExportKind(event.target.value as ExportKind)}>
                      {EXPORT_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                    </Select>
                  </Field>
                  <Button size="sm" variant="primary" className="w-full" loading={busy === `Export ${exportKind}`} onClick={() => downloadExport(exportKind)}>Download {exportKind} export</Button>
                  <div className="border-t hairline pt-3">
                    <Field label="Import export envelope" hint="Select a JSON export produced by this brain. The parsed envelope is POSTed to /api/brain/import.">
                      <input
                        ref={importRef}
                        type="file"
                        accept=".json,application/json"
                        className="focus-ring w-full rounded border border-dashed hairline bg-black/20 p-2.5 text-[11px] text-slate-400 file:mr-2 file:rounded file:border file:border-cyan-500/40 file:bg-cyan-500/10 file:px-2 file:py-1 file:text-cyan-300"
                        onChange={(event) => importFile(event.target.files?.[0])}
                      />
                    </Field>
                    <Button size="sm" variant="outline" className="mt-2" disabled={busy !== null} onClick={() => importRef.current?.click()}>Choose JSON file</Button>
                    <p className="mt-2 text-[10px] text-[var(--muted)]">Import merges the parsed envelope into the local database. Returned statistics are shown in the status line above.</p>
                  </div>
                </div>
              </Card>

              <Card title="Backups and restore" subtitle="Local snapshot files. Restore replaces the live database, so it requires confirmation.">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" loading={busy === "Create backup"} onClick={createBackup}>Create backup</Button>
                  <Button size="sm" variant="ghost" loading={busy === "Refresh backups"} onClick={() => void run("Refresh backups", async () => {
                    const result = await apiRequest<{ backups: BrainBackup[]; files: string[] }>("/api/brain/backup");
                    setBackups(Array.isArray(result.backups) ? result.backups : []);
                    setBackupFiles(Array.isArray(result.files) ? result.files : []);
                    return "Backup list refreshed.";
                  })}>Refresh</Button>
                </div>
                {backups.length ? (
                  <div className="mt-3 max-h-64 space-y-1.5 overflow-auto">
                    {backups.map((backup) => (
                      <label key={backup.id} className="flex cursor-pointer items-start gap-2 rounded border hairline bg-black/15 px-2.5 py-2">
                        <input
                          type="radio"
                          name="brain-backup"
                          checked={restorePath === backup.path}
                          onChange={() => setRestorePath(backup.path)}
                          className="mt-0.5 accent-cyan-500"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-all font-mono text-[10px] text-slate-200" title={backup.path}>{backup.path}</span>
                          <span className="block font-mono text-[10px] text-[var(--muted)]">
                            {formatNumber(backup.size)} B · integrity {backup.integrity} · {ago(backup.createdAt)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : <p className="mt-3 text-[11px] text-[var(--muted)]">No backups recorded yet.</p>}
                {backupFiles.length > 0 && (
                  <details className="mt-2 text-[10px] text-[var(--muted)]">
                    <summary className="cursor-pointer">{formatNumber(backupFiles.length)} backup file(s) reported on disk</summary>
                    <ul className="mt-1 space-y-0.5 break-all font-mono">{backupFiles.map((file) => <li key={file}>{file}</li>)}</ul>
                  </details>
                )}
                <Button size="sm" variant="danger" className="mt-3" disabled={!restorePath} loading={busy === "Restore"} onClick={() => setRestoreOpen(true)}>Restore selected</Button>
                <p className="mt-2 text-[10px] text-amber-300">Restoring overwrites the current SQLite database with the selected snapshot.</p>
              </Card>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card
              title="Offline document learning"
              subtitle="Files are sent only to the local /api/brain/documents route, chunked locally and stored in SQLite."
              action={<Badge tone="cyan">{formatNumber(documents.length)} chunks</Badge>}
            >
              <div className="mb-3">
                <Input
                  value={documentVersion}
                  onChange={(event) => setDocumentVersion(event.target.value)}
                  placeholder="Optional version label, e.g. v18 or 2026-01"
                  maxLength={120}
                  aria-label="Document version label"
                  className="text-xs"
                />
                <p className="mt-1 text-[10px] text-[var(--muted)]">Different version labels create separate retrievable versions instead of replacing older chunks.</p>
              </div>
              <input
                ref={documentRef}
                type="file"
                multiple
                accept={DOCUMENT_ACCEPT}
                className="focus-ring w-full rounded border border-dashed hairline bg-black/20 p-3 text-xs text-slate-400 file:mr-3 file:rounded file:border file:border-cyan-500/40 file:bg-cyan-500/10 file:px-3 file:py-1.5 file:text-cyan-300"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length) {
                    if (documentRef.current) documentRef.current.value = "";
                    uploadDocuments(files);
                  }
                }}
              />
              <p className="mt-2 text-[10px] text-[var(--muted)]">Text, PDF, Markdown, JSON, CSV and source-code files are supported by the local importer.</p>
              {uploadResults.length > 0 && (
                <ul className="mt-3 space-y-1 rounded border hairline bg-black/15 p-2 font-mono text-[10px]">
                  {uploadResults.map((item, index) => {
                    const tone = item.status === "error" ? "text-red-300"
                      : item.status === "queued" ? "text-amber-300" : "text-emerald-300";
                    return (
                      <li key={`${item.name}-${index}`} className={tone} title={item.error}>
                        {item.status === "queued" && `${item.name}: queued`}
                        {item.status === "error" && `${item.name}: ${item.error ?? "upload failed"}`}
                        {item.status === "done" && item.result
                          && `${item.name}: ${formatNumber(item.result.chunks)} chunk(s) · ${formatNumber(item.result.characters)} characters · ${item.result.category}`}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mono-label mb-1.5 mt-4">Stored document chunks</div>
              {documents.length === 0 ? (
                <EmptyState title="No documents learned yet" description="Upload a local file to store searchable chunks in the brain." />
              ) : (
                <div className="max-h-72 space-y-1.5 overflow-auto pr-1">
                  {documents.map((chunk) => (
                    <div key={chunk.id} className="rounded border hairline bg-black/15 p-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="truncate text-[11px] font-medium text-slate-200" title={chunk.name}>{chunk.name}</span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge tone="cyan">{chunk.category}</Badge>
                            {chunk.keywords.slice(0, 4).map((keyword) => <Badge key={keyword}>{keyword}</Badge>)}
                          </div>
                        </div>
                        <button type="button" onClick={() => setPendingDocumentDelete(chunk.id)} className="focus-ring rounded px-1 font-mono text-[10px] text-slate-400 hover:text-red-300">Delete</button>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[var(--muted)]">
                        {chunk.content.length > 240 ? `${chunk.content.slice(0, 240)}…` : chunk.content}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-500">
                        {chunk.id} · {chunk.source} · {ago(chunk.createdAt)}
                      </p>
                      {(chunk.docVersion || chunk.section || chunk.symbol || chunk.language) && (
                        <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                          {[chunk.language, chunk.docVersion && `version ${chunk.docVersion}`, chunk.section && `section ${chunk.section}`, chunk.symbol && `symbol ${chunk.symbol}`].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {restoredStatus ? (
              <Card title="Last restore status" subtitle="Exact status object returned by the local restore endpoint">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={restoredStatus.ready ? "green" : "red"}>{restoredStatus.ready ? "ready" : "not ready"}</Badge>
                  <Badge>{formatNumber(restoredStatus.stats.conversations)} conversations</Badge>
                  <Badge>{formatNumber(restoredStatus.stats.knowledgeEntries)} knowledge entries</Badge>
                  <Badge>schema v{restoredStatus.stats.schemaVersion}</Badge>
                  <Badge tone={restoredStatus.stats.integrity === "ok" ? "green" : "amber"}>{restoredStatus.stats.integrity}</Badge>
                </div>
                <p className="mt-2 break-all font-mono text-[10px] text-[var(--muted)]">{restoredStatus.databasePath}</p>
                <pre className="mt-3 max-h-64 overflow-auto rounded border hairline bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-slate-300">{JSON.stringify(restoredStatus, null, 2)}</pre>
              </Card>
            ) : (
              <Card title="Local-only operation" subtitle="What this dashboard does and does not do">
                <ul className="space-y-2 text-[11px] leading-relaxed text-[var(--muted)]">
                  <li>· All requests go to relative /api/brain routes on this machine. No external URLs are contacted.</li>
                  <li>· No web research is started from this dashboard. Stored research-record counts are read from SQLite only.</li>
                  <li>· Backups, exports and document learning are written locally by the route handlers.</li>
                  <li>· Restore and delete actions require confirmation before any database change.</li>
                </ul>
              </Card>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!pendingKnowledge}
        title="Delete this knowledge entry?"
        description={`"${pendingKnowledge?.title ?? ""}" will be removed from the local brain database. Exports and backups are unaffected.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingKnowledgeDelete(null)}
        onConfirm={deleteKnowledge}
      />
      <ConfirmDialog
        open={!!pendingDocument}
        title="Delete this document chunk?"
        description={`Chunk "${pendingDocument?.name ?? ""}" (${pendingDocument?.id ?? ""}) will be removed from the local brain database.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDocumentDelete(null)}
        onConfirm={deleteDocument}
      />
      <ConfirmDialog
        open={restoreOpen && !!restorePath}
        title="Restore this backup?"
        description={`Restoring "${restorePath ?? ""}" replaces the current SQLite database. The returned status will be displayed after the operation.`}
        confirmLabel="Restore"
        danger
        onCancel={() => setRestoreOpen(false)}
        onConfirm={restoreBackup}
      />
    </>
  );
}
