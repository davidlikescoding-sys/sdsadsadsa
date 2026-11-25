/**
 * Installs DavidAI's local image engine.
 *
 * Default setup downloads:
 *  - stable-diffusion.cpp CPU build from GitHub releases
 *  - Full-precision SD 1.5 F16 GGUF weights for objects and vehicles
 *  - Realistic Vision V6 Q4_1 GGUF weights (portrait fine-tune) from Hugging Face
 *  - Real-ESRGAN 4x GGUF weights for offline 4x image enhancement
 *
 * Everything runs locally after installation. No API key or paid service is used.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "bin", "sd-cpp");
const modelDir = join(root, "models");
const tempDir = join(root, ".downloads");
const manifestPath = join(modelDir, "image-model.json");

const GITHUB_RELEASE_API = "https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest";
const MODEL_URL = process.env.IMAGE_MODEL_URL
  ?? "https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF/resolve/main/stable-diffusion-v1-5-pruned-emaonly-f16.gguf";
const MODEL_FILE = process.env.IMAGE_MODEL_FILE ?? "stable-diffusion-v1-5-f16.gguf";
const PORTRAIT_MODEL_URL = process.env.IMAGE_PORTRAIT_MODEL_URL
  ?? "https://huggingface.co/second-state/Realistic_Vision_V6.0_B1-GGUF/resolve/main/realisticVisionV60B1_v51HyperVAE-Q4_1.gguf";
const PORTRAIT_MODEL_FILE = process.env.IMAGE_PORTRAIT_MODEL_FILE ?? "realistic-vision-v60-b1-Q4_1.gguf";
const UPSCALER_URL = process.env.IMAGE_UPSCALER_URL
  ?? "https://huggingface.co/Acly/Real-ESRGAN-GGUF/resolve/main/ESRGAN-4x-NMKD-Superscale-SP_178000_G-F16.gguf";
const UPSCALER_FILE = process.env.IMAGE_UPSCALER_FILE ?? "esrgan-4x-nmkd-f16.gguf";
const BACKEND = (process.argv.find((arg) => arg.startsWith("--backend="))?.split("=")[1] ?? "cpu").toLowerCase();

function log(message) { console.log(`[image-setup] ${message}`); }
function fail(message) { throw new Error(message); }

async function download(url, destination, expectedBytes) {
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    const bytes = statSync(destination).size;
    if (!expectedBytes || bytes === expectedBytes) {
      log(`Using cached download: ${destination} (${(bytes / 1e6).toFixed(1)} MB)`);
      return destination;
    }
    rmSync(destination, { force: true });
  }
  log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "DavidAI-image-setup/1.0" } });
  if (!response.ok) fail(`Download failed with HTTP ${response.status}: ${url}`);
  const total = Number(response.headers.get("content-length") ?? expectedBytes ?? 0);
  const out = createWriteStreamSafe(destination);
  let received = 0;
  let lastPercent = -1;
  for await (const chunk of response.body) {
    out.write(chunk);
    received += chunk.length;
    if (total) {
      const percent = Math.floor((received / total) * 100);
      if (percent - lastPercent >= 5) { lastPercent = percent; log(`${percent}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`); }
    }
  }
  await new Promise((resolvePromise, reject) => out.end((error) => error ? reject(error) : resolvePromise()));
  if (expectedBytes && statSync(destination).size !== expectedBytes) fail(`Downloaded file size did not match the release manifest.`);
  return destination;
}

function createWriteStreamSafe(path) {
  return createWriteStream(path);
}

function sha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function powershellQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function extractZip(zip, destination) {
  mkdirSync(destination, { recursive: true });
  const command = `Expand-Archive -LiteralPath ${powershellQuote(zip)} -DestinationPath ${powershellQuote(destination)} -Force`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
  if (result.status !== 0) fail(`Could not extract ${zip}: ${result.stderr || result.stdout}`);
}

function findExecutable(start, name) {
  for (const entry of readdirSync(start, { withFileTypes: true })) {
    const full = join(start, entry.name);
    if (entry.isDirectory()) {
      const found = findExecutable(full, name);
      if (found) return found;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
  }
  return null;
}

function copySupportFiles(start, destination, sourceCli) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(start, { withFileTypes: true })) {
    const full = join(start, entry.name);
    if (entry.isDirectory()) {
      copySupportFiles(full, destination, sourceCli);
      continue;
    }
    if (full === sourceCli || entry.name.toLowerCase() === "sd-cli.exe") continue;
    const target = join(destination, entry.name);
    if (!existsSync(target)) renameSync(full, target);
  }
}

async function installBinary() {
  log(`Finding stable-diffusion.cpp ${BACKEND} release...`);
  const response = await fetch(GITHUB_RELEASE_API, { headers: { "user-agent": "DavidAI-image-setup/1.0", accept: "application/vnd.github+json" } });
  if (!response.ok) fail(`Could not query GitHub releases (${response.status}).`);
  const release = await response.json();
  const pattern = BACKEND === "cpu"
    ? /^sd-.*-bin-win-cpu-x64\.zip$/i
    : BACKEND === "vulkan"
      ? /^sd-.*-bin-win-vulkan-x64\.zip$/i
      : /^sd-.*-bin-win-cuda12-x64\.zip$/i;
  const asset = release.assets?.find((item) => pattern.test(item.name));
  if (!asset) fail(`No Windows ${BACKEND} binary was found in release ${release.tag_name}.`);
  mkdirSync(tempDir, { recursive: true });
  const zip = await download(asset.browser_download_url, join(tempDir, asset.name), asset.size);
  if (asset.digest?.startsWith("sha256:")) {
    const actual = sha256(zip);
    if (actual !== asset.digest.slice(7)) fail("Binary checksum did not match the GitHub release digest.");
    log("Binary checksum verified.");
  }
  const extracted = join(tempDir, `sd-${BACKEND}-${release.tag_name}`);
  extractZip(zip, extracted);
  const cli = findExecutable(extracted, "sd-cli.exe");
  if (!cli) fail("The release zip did not contain sd-cli.exe.");
  mkdirSync(binDir, { recursive: true });
  const target = join(binDir, "sd-cli.exe");
  if (existsSync(target)) rmSync(target, { force: true });
  renameSync(cli, target);
  // Copy DLLs and supporting files from every extracted subfolder.
  copySupportFiles(extracted, binDir, cli);
  log(`Installed image engine: ${target}`);
  return { binary: target, release: release.tag_name, bytes: statSync(target).size };
}

async function installModel(url, fileName) {
  mkdirSync(modelDir, { recursive: true });
  const target = join(modelDir, fileName);
  await download(url, target);
  const bytes = statSync(target).size;
  if (bytes < 500_000_000) fail(`Model file is unexpectedly small (${bytes} bytes).`);
  const magic = readFileSync(target).subarray(0, 4).toString("ascii");
  if (magic !== "GGUF") fail("Downloaded model is not a GGUF file.");
  log(`Installed model: ${target} (${(bytes / 1e9).toFixed(2)} GB)`);
  return { modelFile: target, bytes };
}

async function installUpscaler(url, fileName) {
  const target = join(modelDir, "upscalers", fileName);
  await download(url, target);
  const bytes = statSync(target).size;
  if (bytes < 10_000_000) fail(`Upscaler file is unexpectedly small (${bytes} bytes).`);
  if (readFileSync(target).subarray(0, 4).toString("ascii") !== "GGUF") fail("Downloaded upscaler is not a GGUF file.");
  log(`Installed upscaler: ${target} (${(bytes / 1e6).toFixed(1)} MB)`);
  return { upscalerFile: target, bytes };
}

const binary = await installBinary();
const model = await installModel(MODEL_URL, MODEL_FILE);
const portrait = await installModel(PORTRAIT_MODEL_URL, PORTRAIT_MODEL_FILE);
const upscaler = await installUpscaler(UPSCALER_URL, UPSCALER_FILE);
const manifest = {
  app: "DavidAI-image",
  installedAt: new Date().toISOString(),
  backend: BACKEND,
  modelName: "Stable Diffusion 1.5 F16 GGUF",
  license: "CreativeML OpenRAIL-M / Apache-2.0 GGUF",
  engine: "stable-diffusion.cpp",
  binary: "bin/sd-cpp/sd-cli.exe",
  modelFile: `models/${MODEL_FILE}`,
  modelBytes: model.bytes,
  portraitModelName: "Realistic Vision V6 Q4_1 GGUF",
  portraitModelFile: `models/${PORTRAIT_MODEL_FILE}`,
  portraitModelBytes: portrait.bytes,
  portraitModelUrl: PORTRAIT_MODEL_URL,
  upscalerName: "Real-ESRGAN 4x GGUF",
  upscalerFile: `models/upscalers/${UPSCALER_FILE}`,
  upscalerBytes: upscaler.bytes,
  upscalerUrl: UPSCALER_URL,
  binaryBytes: binary.bytes,
  release: binary.release,
  sourceUrl: "https://github.com/leejet/stable-diffusion.cpp",
  modelUrl: MODEL_URL,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
log(`Setup complete. Manifest written to ${manifestPath}.`);
