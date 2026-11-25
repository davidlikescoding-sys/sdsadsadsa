/** Wrap a bare trainer snapshot into the checkpoint format accepted by the UI. */
import fs from "node:fs";
import path from "node:path";

const source = path.resolve(process.argv[2] ?? "scripts/word-model-small.json");
const target = path.resolve(process.argv[3] ?? "scripts/word-model-small-import.json");
const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
const snapshot = parsed.snapshot ?? parsed;
// The chat model does not need Adam moments. Dropping them keeps the exported
// file small enough for the browser's file-upload limit; the live session still
// gets a fresh optimizer and can be checkpointed again from the UI.
if (process.argv.includes("--lite")) delete snapshot.optimizer;
const wrapped = {
  app: "DavidAI-checkpoint",
  version: 1,
  meta: {
    name: `Trained word model - step ${snapshot.step}`,
    config: snapshot.config,
    vocabSize: snapshot.vocab.length,
    trainingSteps: snapshot.step,
    sizeBytes: Object.values(snapshot.weights).reduce((n, v) => n + Math.floor(v.length * 3 / 4), 0),
    datasetNames: ["Headless trainer"],
    loss: Number.isFinite(Number(process.argv[4])) && process.argv[4] !== undefined ? Number(process.argv[4]) : null,
    createdAt: snapshot.savedAt,
  },
  snapshot,
};
fs.writeFileSync(target, JSON.stringify(wrapped));
console.log(JSON.stringify({
  bytes: fs.statSync(target).size,
  step: snapshot.step,
  tokenizerMode: snapshot.tokenizerMode,
  vocab: snapshot.vocab.length,
}));
