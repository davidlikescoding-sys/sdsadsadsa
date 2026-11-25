"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { estimateParams, validateConfig, type ModelConfig } from "@/engine/transformer";
import { PageHeader, Card, Button, Field, Input, Badge, formatNumber, ErrorBox } from "@/components/ui";

function NumberField({ label, value, onChange, min, max, step = 1, hint }: {
  label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="focus-ring h-1 flex-1 accent-cyan-500" />
        <Input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-20 text-center font-mono" />
      </div>
    </Field>
  );
}

export default function ArchitecturePage() {
  const {
    config, setConfigLocal, initModel, modelReady, settings, updateSettings,
    selectedDatasetIds, datasets, training,
    wordModelReady, wordVocabSize, wordSteps, wordLoss,
  } = useStore();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft: ModelConfig = useMemo(() => ({ ...config }), [config]);
  const validation = validateConfig(draft);
  const params = validation ? 0 : estimateParams(draft);
  const selectedCount = selectedDatasetIds.filter((id) => datasets.some((d) => d.id === id)).length;

  const change = (patch: Partial<ModelConfig>) => {
    setError(null); setMessage(null);
    setConfigLocal({ ...draft, ...patch });
  };

  const initialize = () => {
    setError(null); setMessage(null);
    try {
      if (validation) throw new Error(validation);
      if (!selectedCount) throw new Error("Select at least one dataset in Datasets before initializing.");
      initModel(draft, selectedDatasetIds);
      setMessage("Model initialized with the new architecture. Weights are randomly initialized — start training to learn from your data.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <>
      <PageHeader eyebrow="Model Design" title="Architecture" description="Configure the legacy character-level decoder-only Transformer. AI Chat uses a separate word-level model initialized and trained in the Training Lab; retrieval, memory and feedback are shared between both." actions={<Badge tone={modelReady ? "green" : "neutral"}>{modelReady ? "Char model loaded" : "No char model"}</Badge>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <Card title="Transformer Configuration" subtitle="Architecture hyperparameters">
          <div className="grid gap-5 sm:grid-cols-2">
            <NumberField label="Transformer Layers" value={draft.layers} min={1} max={4} onChange={(n) => change({ layers: n })} hint="Stacked decoder blocks (1–4)" />
            <NumberField label="Attention Heads" value={draft.heads} min={1} max={8} onChange={(n) => change({ heads: n })} hint="Must divide hidden dimension" />
            <NumberField label="Hidden Dimension" value={draft.dModel} min={4} max={256} step={4} onChange={(n) => change({ dModel: n, dFF: Math.max(n * 4, draft.dFF) })} hint="Embedding and model width" />
            <NumberField label="Context Length" value={draft.blockSize} min={4} max={256} step={4} onChange={(n) => change({ blockSize: n })} hint="Tokens visible to each prediction" />
            <NumberField label="Feed-Forward Dimension" value={draft.dFF} min={4} max={1024} step={4} onChange={(n) => change({ dFF: n })} hint="Usually 4× hidden dimension" />
            <Field label="Vocabulary Size" hint="Derived automatically from selected datasets">
              <Input value={draft.vocabSize || "Not built yet"} readOnly className="font-mono" />
            </Field>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Model Summary">
            <div className="space-y-2 font-mono text-xs">
              {[
                ["PARAMETERS", formatNumber(params)],
                ["ATTENTION HEAD SIZE", draft.heads ? draft.dModel / draft.heads : 0],
                ["PER-LAYER FF SCALE", (draft.dFF / draft.dModel).toFixed(1) + "×"],
                ["MAX CONTEXT", draft.blockSize + " tokens"],
                ["TRAINING WINDOWS", selectedCount ? "~" + formatNumber(Math.max(0, Math.floor(selectedTotalChars() / Math.max(1, Math.floor(draft.blockSize / 2))))) : "0"],
              ].map(([k, v]) => <div key={String(k)} className="flex justify-between border-b hairline pb-1.5 last:border-0"><span className="text-[var(--muted)]">{k}</span><span className="text-slate-200">{v}</span></div>)}
            </div>
            {validation && <div className="mt-3 text-xs text-amber-300">⚠ {validation}</div>}
          </Card>

          <Card title="Generative Word Model" subtitle="Separate engine used by AI Chat">
            <div className="space-y-2 font-mono text-xs">
              {[
                ["STATUS", wordModelReady ? "ready" : "not initialized"],
                ["WORD VOCABULARY", formatNumber(wordVocabSize)],
                ["TRAINING STEPS", formatNumber(wordSteps)],
                ["LAST TRAINING LOSS", wordLoss === null ? "—" : wordLoss.toFixed(4)],
                ["CHECKPOINT", "davidai:wordModel"],
              ].map(([k, v]) => <div key={String(k)} className="flex justify-between border-b hairline pb-1.5 last:border-0"><span className="text-[var(--muted)]">{k}</span><span className="text-slate-200">{v}</span></div>)}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">This model is trained from local data in the Training Lab. Until it produces coherent text, Chat quotes retrieved evidence and says why in the Activity Monitor.</p>
          </Card>

          <Card title="Training Defaults" subtitle="Applied to the training laboratory">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Learning rate"><Input type="number" step="0.0001" min="0.00001" max="1" value={settings.learningRate} onChange={(e) => updateSettings({ learningRate: Number(e.target.value) })} className="font-mono text-xs" /></Field>
              <Field label="Batch size"><Input type="number" min="1" max="64" value={settings.batchSize} onChange={(e) => updateSettings({ batchSize: Number(e.target.value) })} className="font-mono text-xs" /></Field>
              <Field label="Training steps"><Input type="number" min="1" max="100000" value={settings.trainingSteps} onChange={(e) => updateSettings({ trainingSteps: Number(e.target.value) })} className="font-mono text-xs" /></Field>
              <Field label="Gradient clip"><Input type="number" min="0" max="100" step="0.5" value={settings.gradientClip} onChange={(e) => updateSettings({ gradientClip: Number(e.target.value) })} className="font-mono text-xs" /></Field>
            </div>
          </Card>

          <Card title="Initialize">
            <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">This creates a new model with random weights using the configuration on the left. Any untrained weights in memory will be replaced.</p>
            <ErrorBox message={error} />
            {message && <p className="mb-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{message}</p>}
            <Button variant="primary" onClick={initialize} className="w-full">Initialize Model</Button>
            {training.status !== "idle" && <p className="mt-2 text-[11px] text-amber-300">Training is currently {training.status}. Stop it before reinitializing.</p>}
          </Card>
        </div>
      </div>
    </>
  );

  function selectedTotalChars() {
    return datasets.filter((d) => selectedDatasetIds.includes(d.id)).reduce((n, d) => n + d.content.length, 0);
  }
}
