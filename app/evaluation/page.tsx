"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { runEvaluation, type EvaluationReport } from "@/lib/evaluation";
import { runLmEvaluation, type LmEvaluationReport } from "@/lib/lm-evaluation";
import { readLocal } from "@/lib/storage";
import { sessionFromSnapshot } from "@/engine/session";
import type { ModelSnapshot } from "@/engine/serialization";
import { PageHeader, Card, Button, Badge, EmptyState } from "@/components/ui";

const CATEGORY_LABELS: Record<string, string> = {
  language: "Language understanding",
  reasoning: "Reasoning",
  memory: "Memory & learning",
  generalization: "Generalization",
};

export default function EvaluationPage() {
  const {
    dictionary, knowledge, memories, corrections, conceptEdges,
    training, learningSessions,
  } = useStore();
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [lmReport, setLmReport] = useState<LmEvaluationReport | null>(null);
  const [lmBusy, setLmBusy] = useState(false);

  const context = useMemo(() => ({
    dictionary, knowledge, memories, corrections, conceptEdges,
    trainingLoss: training.loss,
    validationLoss: training.validationLoss,
    learningSessions,
  }), [dictionary, knowledge, memories, corrections, conceptEdges, training.loss, training.validationLoss, learningSessions]);

  const run = () => setReport(runEvaluation(context));

  const runLm = async () => {
    setLmBusy(true);
    // Let React paint the busy state before the synchronous forward passes.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const snapshot = readLocal<ModelSnapshot | null>("wordModel", null);
      let session = null;
      if (snapshot) {
        try { session = sessionFromSnapshot(snapshot, 0.01); }
        catch { /* an incompatible snapshot is reported as no model */ }
      }
      setLmReport(runLmEvaluation(session, session?.step ?? 0));
    } finally {
      setLmBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Measurement" title="Intelligence Evaluation Lab"
        description="A deterministic, repeatable benchmark of the real local components: typo handling, intent, context, calculation, contradiction checks, memory retrieval and learned concept links. It measures capabilities, not the fluency of the tiny trained Transformer."
        actions={<Button variant="primary" onClick={run}>Run benchmark</Button>} />

      <Card className="mb-5" title="What this benchmark does and does not measure">
        <ul className="space-y-1.5 text-xs leading-relaxed text-slate-400">
          <li>• <span className="text-emerald-300">Measured:</span> pure local functions that run on this device with no network or paid service.</li>
          <li>• <span className="text-emerald-300">Reusable:</span> every case is checked by deterministic code, so results do not depend on a random sample.</li>
          <li>• <span className="text-amber-300">Not measured:</span> the small from-scratch language model's grammar or creativity. Its output quality is checked separately in AI Chat and the Activity Monitor.</li>
          <li>• Honest ceiling: passing this benchmark does not claim general intelligence; it shows the named mechanisms actually work on their defined cases.</li>
        </ul>
      </Card>

      {!report ? (
        <Card><EmptyState title="No benchmark result yet" description="Press Run benchmark to evaluate the current local components with your present data." /></Card>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            <Card className="!p-3"><div className="mono-label">Overall</div><div className="mt-1 font-mono text-lg text-slate-100">{report.correct}/{report.total}</div><div className="font-mono text-[10px] text-cyan-400">{report.accuracy}% passed</div></Card>
            {Object.entries(report.categories).map(([key, score]) => (
              <Card key={key} className="!p-3"><div className="mono-label">{CATEGORY_LABELS[key] ?? key}</div><div className="mt-1 font-mono text-lg text-slate-100">{score.correct}/{score.total}</div><div className="font-mono text-[10px] text-cyan-400">{score.accuracy}% passed</div></Card>
            ))}
          </div>

          <Card className="mb-5" title="Model training signals" subtitle="Reported from the current local training state; not inferred from answers">
            <div className="grid gap-3 sm:grid-cols-4">
              <div><div className="mono-label mb-1">Training loss</div><div className="font-mono text-sm text-slate-200">{report.losses.training ?? "not trained"}</div></div>
              <div><div className="mono-label mb-1">Validation loss</div><div className="font-mono text-sm text-slate-200">{report.losses.validation ?? "not trained"}</div></div>
              <div><div className="mono-label mb-1">Latest session loss</div><div className="font-mono text-sm text-slate-200">{report.losses.latestSessionTraining ?? "none"}</div></div>
              <div><div className="mono-label mb-1">Recorded sessions</div><div className="font-mono text-sm text-slate-200">{report.losses.sessions}</div></div>
            </div>
          </Card>

          <Card title="Case-by-case results" subtitle={`Generated ${new Date(report.generatedAt).toLocaleString()}`}>
            <div className="space-y-2">
              {report.results.map((item) => (
                <div key={item.id} className="rounded border hairline bg-black/20 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={item.passed ? "green" : "red"}>{item.passed ? "pass" : "fail"}</Badge>
                    <span className="text-xs font-medium text-slate-200">{item.name}</span>
                    <span className="font-mono text-[10px] text-slate-600">{item.category}</span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div><div className="mono-label mb-1">Prompt</div><p className="text-[11px] text-slate-400">{item.prompt}</p></div>
                    <div><div className="mono-label mb-1">Expected</div><p className="text-[11px] text-slate-400">{item.expected}</p></div>
                  </div>
                  <div className="mt-2"><div className="mono-label mb-1">Actual (recorded)</div><p className="break-words font-mono text-[10px] leading-relaxed text-slate-400">{item.actual}</p></div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Card className="mt-6" title="Language Model Evaluation"
        subtitle="Multiple-choice probes scored by the loaded Transformer's own log probabilities — not by keywords or the component benchmark."
        action={<Button variant="outline" onClick={() => void runLm()} disabled={lmBusy}>{lmBusy ? "Scoring…" : "Evaluate language model"}</Button>}>
        {!lmReport ? (
          <p className="text-xs leading-relaxed text-slate-400">Twelve independently authored prompts across completion, grammar, vocabulary, concepts, reading comprehension and conversation. They are never used as training examples. Run this after training the generative word model to measure whether its predictions actually improve.</p>
        ) : !lmReport.modelReady ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-200">
            Not evaluated — no compatible word model is loaded. Initialize or import a generative word-model checkpoint first; a 0/12 score here would be meaningless.
          </div>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <div><div className="mono-label mb-1">Accuracy</div><div className="font-mono text-lg text-slate-100">{lmReport.correct}/{lmReport.total}</div><div className="font-mono text-[10px] text-cyan-400">{lmReport.accuracy}% passed</div></div>
              <div><div className="mono-label mb-1">Model step</div><div className="font-mono text-sm text-slate-200">{lmReport.step}</div></div>
              <div><div className="mono-label mb-1">Vocabulary</div><div className="font-mono text-sm text-slate-200">{lmReport.vocabSize || "no model"}</div></div>
              <div><div className="mono-label mb-1">Status</div><div className="font-mono text-sm text-slate-200">{lmReport.modelReady ? "loaded" : "not loaded"}</div></div>
            </div>
            <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(lmReport.categories).map(([key, score]) => (
                <div key={key} className="rounded border hairline bg-black/20 p-2">
                  <div className="mono-label">{key}</div>
                  <div className="mt-1 font-mono text-sm text-slate-200">{score.correct}/{score.total}</div>
                </div>
              ))}
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-400">{lmReport.note}</p>
            <div className="space-y-2">
              {lmReport.results.map((item) => (
                <div key={item.id} className="rounded border hairline bg-black/20 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={item.passed ? "green" : "red"}>{item.passed ? "pass" : "fail"}</Badge>
                    <span className="text-xs font-medium text-slate-200">{item.id}</span>
                    <span className="font-mono text-[10px] text-slate-600">{item.category}</span>
                  </div>
                  <div className="mt-2"><div className="mono-label mb-1">Model's choice vs expected</div>
                    <p className="break-words font-mono text-[10px] leading-relaxed text-slate-400">
                      {item.chosen < 0 ? "no model" : `chose [${item.chosen}] ${item.scores.map((s, i) => `${i}:${Number.isFinite(s) ? s.toFixed(2) : "-inf"}`).join("  ")}`} · expected [{item.correct}]
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
