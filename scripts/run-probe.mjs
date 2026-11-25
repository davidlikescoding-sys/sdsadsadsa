/** Bundle and run the raw generation probe. */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "davidai-probe-")), "probe.mjs");
await build({
  entryPoints: [path.join(root, "scripts", "probe-generation.ts")],
  outfile: outFile, bundle: true, platform: "node", format: "esm", target: "node20",
  alias: { "@": path.join(root, "src") }, logLevel: "silent",
});
await import(pathToFileURL(outFile).href + "?" + Date.now());
