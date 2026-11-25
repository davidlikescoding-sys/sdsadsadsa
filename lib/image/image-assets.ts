/**
 * Local image assets for references, img2img sources and masks.
 * Pixel inspection uses the already-installed `sharp` binary. Nothing here
 * contacts a network service or treats an uploaded image as generated output.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { dataRoot } from "../runtime-paths";
import type { ColorSample, ImageAsset } from "./types";

const assetDir = join(dataRoot(), "image-assets");
const MAX_ASSET_BYTES = 12 * 1024 * 1024;

function safeId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return clean || randomUUID();
}

function ensureDir(): void {
  mkdirSync(assetDir, { recursive: true });
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

/** Real low-resolution palette extraction from the uploaded bytes. */
async function analyze(buffer: Buffer): Promise<{ colors: ColorSample[]; brightness: number }> {
  const { data, info } = await sharp(buffer)
    .resize(32, 32, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = Math.max(1, info.channels);
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  let brightness = 0;
  let pixels = 0;
  for (let index = 0; index + channels <= data.length; index += channels) {
    const r = data[index];
    const g = channels >= 3 ? data[index + 1] : r;
    const b = channels >= 3 ? data[index + 2] : r;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count++;
    buckets.set(key, bucket);
    brightness += (r + g + b) / 3;
    pixels++;
  }
  const total = Math.max(1, pixels);
  const colors = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((bucket) => ({
      name: `sampled ${hex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count)}`,
      hex: hex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count),
      share: Math.round((bucket.count / total) * 1000) / 1000,
    }));
  return { colors, brightness: Math.round((brightness / total / 255) * 1000) / 1000 };
}

const KIND_NOTES: Record<ImageAsset["kind"], string> = {
  reference: "Inspiration only: palette and brightness cues may enter the prompt; pixels are not copied.",
  edit: "Used as a real diffusion input for img2img, mask-guided editing or outpainting.",
  mask: "White areas are edited, black areas are preserved by the local mask-guided pass.",
};

export async function saveImageAsset(input: {
  buffer: Buffer;
  name: string;
  kind: ImageAsset["kind"];
}): Promise<ImageAsset> {
  if (input.buffer.length > MAX_ASSET_BYTES) throw new Error("That image is larger than the 12 MB local limit.");
  const isPng = input.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = input.buffer[0] === 0xff && input.buffer[1] === 0xd8;
  const isWebp = input.buffer.subarray(0, 4).toString("ascii") === "RIFF" && input.buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (!isPng && !isJpeg && !isWebp) throw new Error("Upload a PNG, JPEG or WebP image.");
  const metadata = await sharp(input.buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error("The uploaded image has no readable dimensions.");
  const { colors, brightness } = await analyze(input.buffer);
  const id = safeId(randomUUID());
  const png = await sharp(input.buffer).png({ compressionLevel: 6 }).toBuffer();
  ensureDir();
  writeFileSync(join(assetDir, `${id}.png`), png);
  const asset: ImageAsset = {
    id,
    kind: input.kind,
    name: input.name.slice(0, 120) || `${input.kind}.png`,
    url: `/api/image/assets/${id}`,
    width: metadata.width,
    height: metadata.height,
    bytes: png.length,
    colors,
    brightness,
    createdAt: new Date().toISOString(),
    note: KIND_NOTES[input.kind],
  };
  writeFileSync(join(assetDir, `${id}.json`), JSON.stringify(asset, null, 2));
  return asset;
}

export function getImageAsset(id: string): ImageAsset | null {
  try {
    const path = join(assetDir, `${safeId(id)}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as ImageAsset;
  } catch {
    return null;
  }
}

export function listImageAssets(kind?: ImageAsset["kind"]): ImageAsset[] {
  try {
    if (!existsSync(assetDir)) return [];
    return readdirSync(assetDir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        const asset = getImageAsset(name.replace(/\.json$/, ""));
        return asset && (!kind || asset.kind === kind) ? [asset] : [];
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function imageAssetPath(id: string): string | null {
  const path = join(assetDir, `${safeId(id)}.png`);
  return existsSync(path) ? path : null;
}

export function deleteImageAsset(id: string): boolean {
  const safe = safeId(id);
  let removed = false;
  for (const ext of ["png", "json"]) {
    const path = join(assetDir, `${safe}.${ext}`);
    if (existsSync(path)) { rmSync(path, { force: true }); removed = true; }
  }
  return removed;
}

export function assetBytes(id: string): { buffer: Buffer; size: number } | null {
  const path = imageAssetPath(id);
  if (!path) return null;
  return { buffer: readFileSync(path), size: statSync(path).size };
}

/** Local visual cues derived from uploaded reference palettes, never from pixels. */
export function referenceCues(ids: string[] | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  const cues: string[] = [];
  for (const id of ids.slice(0, 6)) {
    const asset = getImageAsset(id);
    if (!asset || asset.kind !== "reference") continue;
    const colors = asset.colors.slice(0, 3).map((color) => color.hex);
    if (colors.length) cues.push(`inspired by a ${colors.join(" and ")} palette`);
    if (asset.brightness > 0.72) cues.push("bright high-key tonality");
    else if (asset.brightness < 0.3) cues.push("dark low-key tonality");
  }
  return [...new Set(cues)].slice(0, 4);
}
