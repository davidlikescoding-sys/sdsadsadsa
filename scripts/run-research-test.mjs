/** Bundle and run the temporary research test with the project's esbuild. */
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "davidai-research-")), "test.mjs");
await build({
  entryPoints: [path.join(root, "scripts", "research-test.ts")],
  outfile: outFile, bundle: true, platform: "node", format: "esm", target: "node20",
  alias: { "@": path.join(root, "src") }, logLevel: "silent",
});
await import(pathToFileURL(outFile).href);
