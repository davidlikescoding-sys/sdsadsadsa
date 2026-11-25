"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, formatNumber } from "@/components/ui";

interface LocalLlmDetails {
  modelPath: string | null;
  modelBytes: number | null;
  embeddingModel: string | null;
  embeddingReady: boolean;
  executableReady: boolean;
}

interface ImageModelOption {
  id: string;
  name: string;
  file: string;
  bytes: number;
  available: boolean;
  note: string;
}

interface ImageDetails {
  binary: string | null;
  modelFile: string | null;
  models: ImageModelOption[];
  upscaler: { name: string | null; ready: boolean; file: string | null };
  modelBytes: number | null;
  binaryBytes: number | null;
  limits: { maxWidth: number; maxHeight: number; maxSteps: number; timeoutSeconds: number; maxBatch: number } | null;
  queue: { active: boolean; waiting: number; label: string | null } | null;
}

interface BrainStats {
  conversations: number;
  messages: number;
  knowledgeEntries: number;
  extractedFacts: number;
  corrections: number;
  researchRecords: number;
  documents: number;
  categories: number;
  databaseBytes: number;
  integrity: string;
  schemaVersion: number;
}

interface BrainDetails {
  databasePath: string | null;
  embeddingModel: string | null;
  embeddingReady: boolean;
  embeddingBytes: number | null;
  integrity: string | null;
  schemaVersion: number | null;
}

interface EngineBase {
  id: string;
  name: string;
  family: string;
  version: string | null;
  quantization: string | null;
  parameters: number | null;
  contextWindow: number | null;
  active: boolean;
  ready: boolean;
  purpose: string;
  limitations: string[];
}

interface LocalLlmEngine extends EngineBase {
  id: "local-llm";
  details: LocalLlmDetails;
}

interface ImageEngine extends EngineBase {
  id: "image-diffusion";
  details: ImageDetails;
}

interface BrainEngine extends EngineBase {
  id: "persistent-brain";
  stats: BrainStats | null;
  details: BrainDetails;
}

type Engine = LocalLlmEngine | ImageEngine | BrainEngine;

interface ModelInfoPayload {
  ok: true;
  generatedAt: string;
  runtime: {
    platform: string;
    arch: string;
    cpuCount: number | null;
    totalMemoryGb: number | null;
    gpu: string[];
    online: boolean;
    nodeVersion: string;
    webAccessActive: boolean;
  };
  engines: Engine[];
  webAccess: {
    online: boolean;
    chatWebSearchEnabled: boolean;
    researchApisAvailable: boolean;
  };
  notes: string[];
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  return String(value);
}

function bytesLabel(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown";
  return `${formatNumber(value)} bytes`;
}

function updatedLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "time unavailable" : date.toLocaleString();
}

function ReadyBadge({ ready }: { ready: boolean }) {
  return <Badge tone={ready ? "green" : "amber"}>{ready ? "READY" : "NOT READY"}</Badge>;
}

function InfoLine({ label, value, mono = false }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="rounded border hairline px-3 py-2">
      <div className="mono-label">{label}</div>
      <div className={`mt-1 break-words text-xs text-slate-200 ${mono ? "break-all font-mono text-[10px]" : ""}`}>{display(value)}</div>
    </div>
  );
}

function DetailLine({ label, value, mono = false }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="mono-label">{label}</span>
      <span className={`text-right text-[11px] text-slate-200 ${mono ? "break-all font-mono text-[10px]" : ""}`}>{display(value)}</span>
    </div>
  );
}

function RuntimeSection({ runtime }: { runtime: ModelInfoPayload["runtime"] }) {
  const rows: Array<{ label: string; value: string | number | null }> = [
    { label: "Platform", value: `${display(runtime.platform)} (${display(runtime.arch)})` },
    { label: "CPU", value: runtime.cpuCount === null ? "Unknown" : `${formatNumber(runtime.cpuCount)} logical cores` },
    { label: "Memory", value: runtime.totalMemoryGb === null ? "Unknown" : `${runtime.totalMemoryGb} GB` },
    { label: "Graphics", value: runtime.gpu.length ? runtime.gpu.join(", ") : "None reported" },
    { label: "Node", value: runtime.nodeVersion },
  ];
  return (
    <section>
      <div className="mono-label mb-2">Runtime</div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => <InfoLine key={row.label} label={row.label} value={row.value} />)}
        <div className="rounded border hairline px-3 py-2">
          <div className="mono-label">Connectivity</div>
          <div className="mt-1"><Badge tone={runtime.online ? "green" : "red"}>{runtime.online ? "ONLINE" : "OFFLINE"}</Badge></div>
        </div>
        <div className="rounded border hairline px-3 py-2">
          <div className="mono-label">Web access active</div>
          <div className="mt-1">
            <Badge tone={runtime.webAccessActive ? "cyan" : "neutral"}>
              {runtime.webAccessActive ? "NETWORK + APIS" : "NOT ACTIVE"}
            </Badge>
          </div>
        </div>
      </div>
    </section>
  );
}

function EngineDetails({ engine }: { engine: Engine }) {
  if (engine.id === "local-llm") {
    const details = engine.details;
    return (
      <>
        <DetailLine label="Model file" value={details.modelPath} mono />
        <DetailLine label="Model size" value={bytesLabel(details.modelBytes)} />
        <DetailLine label="Executable" value={details.executableReady ? "Present" : "Missing"} />
        <DetailLine label="Embedding model" value={details.embeddingModel} mono />
        <DetailLine label="Embedding status" value={details.embeddingReady ? "Ready" : "Not ready"} />
      </>
    );
  }
  if (engine.id === "image-diffusion") {
    const details = engine.details;
    const available = details.models.map((model) => model.name);
    return (
      <>
        <DetailLine label="Selected model" value={engine.name} />
        <DetailLine label="Checkpoint" value={details.modelFile} mono />
        <DetailLine label="Checkpoint size" value={bytesLabel(details.modelBytes)} />
        <DetailLine label="Binary" value={details.binary} mono />
        <DetailLine label="Binary size" value={bytesLabel(details.binaryBytes)} />
        <DetailLine
          label="Upscaler"
          value={details.upscaler.name ? `${details.upscaler.name} (${details.upscaler.ready ? "ready" : "not ready"})` : "Unknown"}
        />
        <DetailLine label="Available models" value={available.length ? available.join(", ") : "None reported"} />
        {details.limits && (
          <DetailLine label="Limits" value={`${details.limits.maxWidth}×${details.limits.maxHeight} px · ${details.limits.maxSteps} steps · batch ${details.limits.maxBatch}`} />
        )}
        {details.queue && (
          <DetailLine
            label="Queue"
            value={details.queue.active ? `Rendering${details.queue.waiting ? ` · ${formatNumber(details.queue.waiting)} waiting` : ""}` : "Idle"}
          />
        )}
      </>
    );
  }
  const details = engine.details;
  return (
    <>
      <DetailLine label="Database" value={details.databasePath} mono />
      {engine.stats ? (
        <>
          <DetailLine label="Conversations" value={formatNumber(engine.stats.conversations)} />
          <DetailLine label="Messages" value={formatNumber(engine.stats.messages)} />
          <DetailLine label="Knowledge entries" value={formatNumber(engine.stats.knowledgeEntries)} />
          <DetailLine label="Extracted facts" value={formatNumber(engine.stats.extractedFacts)} />
          <DetailLine label="Corrections" value={formatNumber(engine.stats.corrections)} />
          <DetailLine label="Documents" value={formatNumber(engine.stats.documents)} />
          <DetailLine label="Database size" value={bytesLabel(engine.stats.databaseBytes)} />
          <DetailLine label="Integrity" value={display(engine.stats.integrity)} />
          <DetailLine label="Schema version" value={formatNumber(engine.stats.schemaVersion)} />
        </>
      ) : (
        <DetailLine label="Statistics" value="Unavailable" />
      )}
      <DetailLine label="Embedding model" value={details.embeddingModel} mono />
      <DetailLine label="Embedding size" value={bytesLabel(details.embeddingBytes)} />
      <DetailLine label="Embedding status" value={details.embeddingReady ? "Ready" : "Not ready"} />
    </>
  );
}

function EngineCard({ engine }: { engine: Engine }) {
  const specs: Array<{ label: string; value: string }> = [
    { label: "Architecture", value: display(engine.family) },
    { label: "Version", value: display(engine.version) },
    { label: "Quantization", value: display(engine.quantization) },
    { label: "Parameters", value: engine.parameters === null ? "Unknown" : formatNumber(engine.parameters) },
    { label: "Context window", value: engine.contextWindow === null ? "Unknown" : `${formatNumber(engine.contextWindow)} tokens` },
  ];
  return (
    <article className="rounded border hairline bg-black/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold" title={engine.name}>{engine.name}</h3>
          <p className="mono-label mt-1">{engine.id}</p>
        </div>
        <ReadyBadge ready={engine.ready} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        <Badge tone={engine.active ? "cyan" : "neutral"}>{engine.active ? "ACTIVE" : "INACTIVE"}</Badge>
        {engine.quantization && <Badge>{engine.quantization}</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t hairline pt-3">
        {specs.map((spec) => (
          <div key={spec.label}>
            <dt className="mono-label">{spec.label}</dt>
            <dd className="mt-0.5 break-words text-xs text-slate-200">{spec.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 border-t hairline pt-3">
        <div className="mono-label">Capability</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-200">{engine.purpose}</p>
      </div>
      <div className="mt-3">
        <div className="mono-label">Limitations</div>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-[var(--muted)]">
          {engine.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
      </div>
      <div className="mt-3 border-t hairline pt-3">
        <div className="mono-label mb-1.5">Live details</div>
        <div className="space-y-1.5"><EngineDetails engine={engine} /></div>
      </div>
    </article>
  );
}

function WebAccessSection({ webAccess }: { webAccess: ModelInfoPayload["webAccess"] }) {
  return (
    <section>
      <div className="mono-label mb-2">Web access</div>
      <div className="rounded border hairline px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <Badge tone={webAccess.online ? "green" : "red"}>{webAccess.online ? "SERVER ONLINE" : "SERVER OFFLINE"}</Badge>
          <Badge tone={webAccess.researchApisAvailable ? "cyan" : "neutral"}>
            {webAccess.researchApisAvailable ? "RESEARCH API PRESENT" : "RESEARCH API MISSING"}
          </Badge>
          <Badge tone={webAccess.chatWebSearchEnabled ? "green" : "neutral"}>
            {webAccess.chatWebSearchEnabled ? "CHAT WEB SEARCH ON" : "CHAT WEB SEARCH NOT ASSERTED"}
          </Badge>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
          This reports server connectivity and the presence of local research endpoints only; it does not mean a research task is running.
          The server cannot read browser chat settings, so chat web search is never asserted here.
        </p>
      </div>
    </section>
  );
}

function NotesSection({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <section>
      <div className="mono-label mb-2">Notes</div>
      <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-[var(--muted)]">
        {notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </section>
  );
}

export function ModelInfoPanel({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<ModelInfoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/system/model-info", { cache: "no-store", signal: controller.signal });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try { payload = JSON.parse(text) as unknown; } catch { /* handled below */ }
      }
      if (!response.ok) {
        const body = payload as { error?: { message?: string }; message?: string } | null;
        throw new Error(body?.error?.message ?? body?.message ?? `Request failed (${response.status}).`);
      }
      if (!payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true || !Array.isArray((payload as { engines?: unknown }).engines)) {
        throw new Error("Unexpected response from /api/system/model-info.");
      }
      setData(payload as ModelInfoPayload);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(messageOf(caught));
      setData(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const refresh = (
    <Button size="sm" variant="ghost" loading={loading} onClick={() => void load()} aria-label="Refresh model information">
      Refresh
    </Button>
  );

  if (compact) {
    return (
      <Card title="Models" subtitle="Local engines" action={refresh}>
        {error ? (
          <div className="space-y-2">
            <p className="text-xs text-red-300" role="alert">Could not load model information: {error}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
          </div>
        ) : loading && !data ? (
          <p className="text-xs text-[var(--muted)]" role="status">Loading model information…</p>
        ) : data ? (
          <div className="space-y-2">
            <ul className="space-y-1.5">
              {data.engines.map((engine) => (
                <li key={engine.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-slate-200" title={engine.name}>{engine.name}</span>
                  <ReadyBadge ready={engine.ready} />
                </li>
              ))}
            </ul>
            <p className="border-t hairline pt-2 text-[11px] text-[var(--muted)]">
              Web access: server {data.webAccess.online ? "online" : "offline"}; chat web search not asserted (browser setting is not visible here).
            </p>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <Card
      title="Model & system information"
      subtitle={data ? `Live status · updated ${updatedLabel(data.generatedAt)}` : "Local engines and runtime"}
      action={refresh}
    >
      {error ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-red-300" role="alert">Could not load model information: {error}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
        </div>
      ) : loading && !data ? (
        <p className="text-sm text-[var(--muted)]" role="status">Loading model information…</p>
      ) : data ? (
        <div className="space-y-5">
          <RuntimeSection runtime={data.runtime} />
          <section>
            <div className="mono-label mb-2">Engines</div>
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {data.engines.map((engine) => <EngineCard key={engine.id} engine={engine} />)}
            </div>
          </section>
          <WebAccessSection webAccess={data.webAccess} />
          <NotesSection notes={data.notes} />
        </div>
      ) : null}
    </Card>
  );
}
