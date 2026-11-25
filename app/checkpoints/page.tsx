"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { estimateParams } from "@/engine/transformer";
import { PageHeader, Card, Button, Badge, Input, Field, Select, EmptyState, ErrorBox, ConfirmDialog, formatNumber, timeAgo } from "@/components/ui";

export default function CheckpointsPage() {
  const { checkpoints, activeCheckpointId, loadCheckpoint, deleteCheckpoint, saveCheckpoint, exportCheckpoint, importCheckpoint, modelReady, wordModelReady, training } = useStore();
  const [name, setName] = useState("");
  const [saveTarget, setSaveTarget] = useState<"word" | "char">("word");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const target = checkpoints.find((c) => c.id === pendingDelete) ?? null;
  const targetMode: "word" | "char" | null = saveTarget === "word" && wordModelReady ? "word"
    : saveTarget === "char" && modelReady ? "char"
    : wordModelReady ? "word" : modelReady ? "char" : null;

  const doSave = () => {
    setError(null); setNotice(null);
    try {
      if (!targetMode) throw new Error("No model is currently loaded.");
      const meta = saveCheckpoint(name || `Step ${training.step} — ${new Date().toLocaleString()}`, targetMode);
      setName("");
      setNotice(`Saved "${meta.name}" (${formatNumber(meta.sizeBytes)} snapshot bytes including optimizer state).`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const download = (id: string, checkpointName: string) => {
    try {
      const url = URL.createObjectURL(new Blob([exportCheckpoint(id)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = `davidai-checkpoint-${checkpointName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(`Checkpoint "${checkpointName}" exported.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setNotice(null);
    if (file.size > 50 * 1024 * 1024) {
      setError("Checkpoint file is too large (50 MB limit).");
      if (importRef.current) importRef.current.value = "";
      return;
    }
    try {
      const meta = importCheckpoint(await file.text());
      setNotice(`Imported "${meta.name}". Compatibility checks passed.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    if (importRef.current) importRef.current.value = "";
  };

  return (
    <>
      <PageHeader eyebrow="Model Persistence" title="Checkpoints" description="Immutable, validated snapshots of real configuration, vocabulary, Float32 weights and Adam state. Incompatible checkpoints are rejected, never silently loaded." actions={<Badge tone={modelReady || wordModelReady ? "green" : "neutral"}>{checkpoints.length} saved</Badge>} />
      <ErrorBox message={error} />
      {notice && <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Save Current Model" subtitle="Captures weights, config, vocabulary and optimizer state">
            <div className="space-y-3">
              <Field label="Checkpoint name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Step ${training.step}`} /></Field>
              <Field label="Model to save">
                <Select value={saveTarget} onChange={(e) => setSaveTarget(e.target.value as "word" | "char")}>
                  <option value="word" disabled={!wordModelReady}>Chat model (word) — {wordModelReady ? "loaded" : "not loaded"}</option>
                  <option value="char" disabled={!modelReady}>Legacy character model — {modelReady ? "loaded" : "not loaded"}</option>
                </Select>
              </Field>
              <Button variant="primary" onClick={doSave} disabled={!targetMode} className="w-full">Save Checkpoint</Button>
              {!targetMode && <p className="text-[11px] text-amber-300">No model is currently loaded.</p>}
            </div>
          </Card>
          <Card title="Import Checkpoint" subtitle="Validate and restore a JSON checkpoint">
            <input ref={importRef} type="file" accept=".json,application/json" className="focus-ring w-full rounded border border-dashed hairline bg-black/20 p-3 text-xs text-slate-400 file:mr-3 file:rounded file:border file:border-cyan-500/40 file:bg-cyan-500/10 file:px-3 file:py-1.5 file:text-cyan-300" onChange={(e) => void handleImport(e.target.files?.[0])} />
            <p className="mt-2 text-[11px] text-[var(--muted)]">Architecture, vocabulary and every weight tensor are checked before anything is stored.</p>
          </Card>
          <Card title="Storage">
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-[var(--muted)]">Total checkpoints</span><span className="font-mono">{checkpoints.length}</span></div>
              <div className="flex justify-between"><span className="text-[var(--muted)]">Total snapshot data</span><span className="font-mono">{formatNumber(checkpoints.reduce((n, c) => n + c.sizeBytes, 0))} B</span></div>
              <div className="flex justify-between"><span className="text-[var(--muted)]">Backend</span><span className="font-mono">localStorage</span></div>
            </div>
          </Card>
        </div>

        <Card title="Saved Checkpoints" subtitle="Load, export or delete snapshots">
          {checkpoints.length === 0 ? (
            <EmptyState title="No checkpoints yet" description="Train a model, then save a checkpoint to preserve its learned weights." />
          ) : (
            <div className="space-y-3">
              {checkpoints.map((c) => (
                <div key={c.id} className={`rounded border p-4 ${activeCheckpointId === c.id ? "border-cyan-500/40 bg-cyan-500/[0.04]" : "hairline bg-black/10"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{c.name}</h3>
                        {c.mode === "word" && <Badge tone="cyan">chat model</Badge>}
                        {c.mode === "char" && <Badge tone="neutral">legacy</Badge>}
                        {activeCheckpointId === c.id && <Badge tone="green">active</Badge>}
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{timeAgo(c.createdAt)} · {new Date(c.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="primary" title={c.mode === "word" ? "Restore these weights into the generative chat model" : "Restore these weights into the legacy character model"} onClick={() => { try { loadCheckpoint(c.id); setNotice(`Loaded "${c.name}".`); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>Load</Button>
                      <Button size="sm" variant="outline" title="Download a portable JSON backup" onClick={() => download(c.id, c.name)}>Export</Button>
                      <Button size="sm" variant="danger" onClick={() => setPendingDelete(c.id)}>Delete</Button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1.5 border-t hairline pt-3 font-mono text-[10px] sm:grid-cols-4">
                    <div><span className="text-[var(--muted)]">STEPS </span>{c.trainingSteps}</div>
                    <div><span className="text-[var(--muted)]">LOSS </span>{c.loss === null ? "—" : c.loss.toFixed(4)}</div>
                    <div><span className="text-[var(--muted)]">PARAMS </span>{formatNumber(estimateParams(c.config))}</div>
                    <div><span className="text-[var(--muted)]">SIZE </span>{formatNumber(c.sizeBytes)} B</div>
                    <div className="col-span-2 sm:col-span-4"><span className="text-[var(--muted)]">ARCH </span>{c.config.layers}L · {c.config.heads}H · d{c.config.dModel} · ctx{c.config.blockSize} · vocab {c.vocabSize}</div>
                    {c.datasetNames.length > 0 && <div className="col-span-2 sm:col-span-4"><span className="text-[var(--muted)]">DATA </span>{c.datasetNames.join(", ")}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!target}
        title="Delete checkpoint?"
        description={`"${target?.name ?? ""}" and its weight data will be permanently removed from this browser. Export it first if you may need it.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) deleteCheckpoint(pendingDelete); setPendingDelete(null); }}
      />
    </>
  );
}
