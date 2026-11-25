/**
 * Bundles the TypeScript headless trainer with the project's local esbuild
 * and runs it in Node. No global npm/tsx required (works on this Windows box
 * where only absolute node paths are available to the agent).
 *
 * Usage:
 *   node scripts/run-trainer.mjs --data <export.json> --out <checkpoint.json> [trainer args...]
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "scripts", "train-word-model.ts");
const outFile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "davidai-train-")),
  "train-word-model.mjs",
);

await build({
  entryPoints: [entry],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "info",
});

// btoa/atob are globals in Node 20. esbuild leaves them alone.
await import(pathToFileURL(outFile).href + "?" + Date.now());
