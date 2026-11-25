/**
 * Headless evaluation of a trained checkpoint on the independent LM test set.
 * Uses the exact same evaluation code as the browser Evaluation Lab.
 */
import fs from "node:fs";
import path from "node:path";
import { sessionFromSnapshot } from "../src/engine/session";
import { runLmEvaluation } from "../src/lib/lm-evaluation";
import type { ModelSnapshot } from "../src/engine/serialization";

function unwrap(json: string): ModelSnapshot {
  const parsed = JSON.parse(json) as { snapshot?: ModelSnapshot } & ModelSnapshot;
  return (parsed.snapshot ?? parsed) as ModelSnapshot;
}

const target = process.argv[2];
if (!target) throw new Error("Usage: eval-word-model <checkpoint.json>");
const file = path.resolve(process.cwd(), target);
const snapshot = unwrap(fs.readFileSync(file, "utf8"));
const session = sessionFromSnapshot(snapshot, 0.01);
const report = runLmEvaluation(session, session.step);

console.log("=== LANGUAGE MODEL EVALUATION ===");
console.log(`checkpoint: ${target}`);
console.log(`step ${report.step} · ${report.vocabSize} tokens · ${report.correct}/${report.total} correct (${report.accuracy}%)`);
for (const [category, score] of Object.entries(report.categories)) {
  console.log(`  ${category.padEnd(14)} ${score.correct}/${score.total}`);
}
console.log("\nPer case (chosen -> expected):");
for (const result of report.results) {
  const best = result.scores.indexOf(Math.max(...result.scores.filter(Number.isFinite)));
  console.log(`  ${result.passed ? "PASS" : "FAIL"}  ${result.id.padEnd(16)} chose ${best} -> expected ${result.correct}`);
}
