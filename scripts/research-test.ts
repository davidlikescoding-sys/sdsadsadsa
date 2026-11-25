/** Temporary end-to-end check of the real research pipeline. */
import { runWebResearch } from "../src/lib/research/engine";
import { readWebPage } from "../src/lib/research/pages";
import { searchSources } from "../src/lib/research/sources";

const questions = [
  "What is the capital of France?",
  "What are the latest developments in artificial intelligence?",
  "Find a tutorial explaining how neural networks learn.",
  "What happened in the world today?",
  "Compare information about the same subject from three different websites.",
];

for (const question of questions) {
  console.log("\n" + "=".repeat(90));
  console.log("QUESTION:", question);
  const started = Date.now();
  try {
    const result = await runWebResearch(question, {
      search: (query, intent, signal) => searchSources([query], intent, signal),
      read: (url, signal) => readWebPage(url, signal),
      historyContext: question.startsWith("Compare") ? "user: What is the capital of France?\nassistant: Paris is the capital of France." : undefined,
      onActivity: (entry) => console.log(`  [${entry.stage}/${entry.status}] ${entry.message}${entry.detail ? " — " + entry.detail.slice(0, 150) : ""}`),
      maxPages: question.startsWith("Compare") ? 5 : 3,
    });
    console.log("QUERIES:", result.queries.join(" | "));
    console.log("ANSWER:\n" + result.answer);
    console.log("CITATIONS:", result.citations.map((c) => `[${c.index}] ${c.source} ${c.url}`).join("\n  "));
    console.log("ERRORS:", result.errors.length ? result.errors.slice(0, 5).join(" | ") : "none");
    console.log(`ELAPSED: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    console.log("FAILED:", error instanceof Error ? error.message : String(error));
  }
}
