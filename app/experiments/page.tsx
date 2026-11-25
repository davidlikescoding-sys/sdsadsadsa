"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { PageHeader, Card, Button, Badge, Input, Field, Textarea, EmptyState, ErrorBox, ConfirmDialog, timeAgo } from "@/components/ui";
import { LossChart } from "@/components/LossChart";

export default function ExperimentsPage() {
  const { experiments, createExperiment, deleteExperiment, training, config, selectedDatasetIds, datasets } = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = experiments.find((e) => e.id === selectedId) ?? experiments[0] ?? null;
  const datasetNames = (ids: string[]) => ids.map((id) => datasets.find((d) => d.id === id)?.name).filter(Boolean) as string[];

  const create = () => {
    setError(null);
    try {
      if (!name.trim()) throw new Error("Give the experiment a name.");
      const e = createExperiment(name, description);
      setName(""); setDescription(""); setSelectedId(e.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const allSeries = experiments.filter((e) => e.results.length > 1).map((e, i) => ({
    id: e.id, name: e.name, color: ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f87171"][i % 5],
    points: e.results.map((r) => ({ step: r.step, loss: r.loss })),
  }));

  return (
    <>
      <PageHeader eyebrow="Experiment Tracking" title="Experiments" description="Record configurations and actual loss results so different training runs can be compared side by side." actions={<Badge tone="neutral">{experiments.length} recorded</Badge>} />
      <ErrorBox message={error} />

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="New Experiment" subtitle="Snapshot the current run">
            <div className="space-y-3">
              <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2-layer on poetry corpus" /></Field>
              <Field label="Notes"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What are you testing?" className="text-xs" /></Field>
              <div className="rounded border hairline bg-black/20 p-3 font-mono text-[10px] text-[var(--muted)]">
                <div>CONFIG {config.layers}L/{config.heads}H/{config.dModel}d</div>
                <div>CONTEXT {config.blockSize} · VOCAB {config.vocabSize}</div>
                <div>DATASETS {selectedDatasetIds.length}</div>
                <div>LOSS POINTS {training.lossHistory.length}</div>
              </div>
              <Button variant="primary" onClick={create} className="w-full">Record Experiment</Button>
            </div>
          </Card>

          <Card title="Experiment List">
            {experiments.length === 0 ? <p className="text-xs text-[var(--muted)]">No experiments recorded.</p> : (
              <div className="space-y-1.5">
                {experiments.map((e) => (
                  <button key={e.id} onClick={() => setSelectedId(e.id)} className={`focus-ring w-full rounded border px-3 py-2 text-left text-xs ${selected?.id === e.id ? "border-cyan-500/40 bg-cyan-500/[0.06]" : "hairline hover:border-slate-500/50"}`}>
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{e.name}</span><span className="font-mono text-[9px] text-[var(--muted)]">{e.results.length} pts</span></div>
                    <div className="mt-1 font-mono text-[9px] text-[var(--muted)]">{timeAgo(e.createdAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {selected ? (
            <>
              <Card title={selected.name} subtitle={selected.description || "No notes"} action={<Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>}>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div><div className="mono-label">Layers</div><div className="mt-1 font-mono text-sm">{selected.config.layers}</div></div>
                  <div><div className="mono-label">Heads</div><div className="mt-1 font-mono text-sm">{selected.config.heads}</div></div>
                  <div><div className="mono-label">Hidden</div><div className="mt-1 font-mono text-sm">{selected.config.dModel}</div></div>
                  <div><div className="mono-label">Context</div><div className="mt-1 font-mono text-sm">{selected.config.blockSize}</div></div>
                  <div><div className="mono-label">Vocab</div><div className="mt-1 font-mono text-sm">{selected.config.vocabSize}</div></div>
                  <div><div className="mono-label">Results</div><div className="mt-1 font-mono text-sm">{selected.results.length}</div></div>
                  <div><div className="mono-label">First loss</div><div className="mt-1 font-mono text-sm">{selected.results[0]?.loss.toFixed(4) ?? "—"}</div></div>
                  <div><div className="mono-label">Last loss</div><div className="mt-1 font-mono text-sm">{selected.results[selected.results.length - 1]?.loss.toFixed(4) ?? "—"}</div></div>
                </div>
                <div className="mt-4 border-t hairline pt-3">
                  <div className="mono-label mb-2">Datasets</div>
                  <div className="flex flex-wrap gap-1.5">{datasetNames(selected.datasetIds).map((n) => <Badge key={n}>{n}</Badge>)}{datasetNames(selected.datasetIds).length === 0 && <span className="text-xs text-[var(--muted)]">None recorded</span>}</div>
                </div>
              </Card>
              <Card title="Recorded Loss" subtitle="Actual measurements captured at recording time">
                <LossChart history={selected.results.map((r) => ({ step: r.step, loss: r.loss }))} />
              </Card>
            </>
          ) : <EmptyState title="No experiment selected" description="Create an experiment to capture the current configuration and loss history." />}

          <Card title="Comparison" subtitle="Relative loss curves across experiments">
            {allSeries.length === 0 ? <p className="py-4 text-center text-xs text-[var(--muted)]">Record experiments with at least two loss points to compare them.</p> : (
              <div className="space-y-3">
                {allSeries.map((s) => {
                  const min = Math.min(...s.points.map((p) => p.loss));
                  const max = Math.max(...s.points.map((p) => p.loss));
                  const range = max - min || 1;
                  const pts = s.points.map((p, i) => `${(i / Math.max(1, s.points.length - 1)) * 100},${30 - ((p.loss - min) / range) * 26}`).join(" ");
                  return (
                    <div key={s.id}>
                      <div className="mb-1 flex justify-between font-mono text-[10px] text-[var(--muted)]"><span>{s.name}</span><span>{s.points[0].loss.toFixed(3)} → {s.points[s.points.length - 1].loss.toFixed(3)}</span></div>
                      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full"><polyline points={pts} fill="none" stroke={s.color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" /></svg>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete && Boolean(selected)}
        title="Delete experiment?"
        description={`“${selected?.name ?? ""}” and its recorded results will be removed from this machine.`}
        confirmLabel="Delete experiment"
        danger
        onConfirm={() => {
          if (selected) {
            deleteExperiment(selected.id);
            setSelectedId(null);
          }
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
