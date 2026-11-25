/**
 * Prepares real pixel inputs for image-guided generation with the installed
 * SD 1.5 weights. All work is local; no stock or reference pixel is passed off
 * as a generated result.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { dataRoot } from "../runtime-paths";
import { imageAssetPath } from "./image-assets";
import type { ImageEditMode, ImageGenerationSettings, ImageOutpaintDirection } from "./types";

const inputDir = join(dataRoot(), "image-inputs");

export interface PreparedInput {
  initImagePath: string;
  maskImagePath?: string;
  files: string[];
  note: string;
  width: number;
  height: number;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || randomUUID();
}

function assetPathOrThrow(id: string | undefined, label: string): string {
  const path = id ? imageAssetPath(id) : null;
  if (!path) throw new Error(`A locally uploaded ${label} is required for this editing mode.`);
  return path;
}

async function maskPng(width: number, height: number, keepRect?: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const raw = Buffer.alloc(width * height, 255);
  if (keepRect) {
    const x0 = Math.max(0, Math.round(keepRect.x));
    const y0 = Math.max(0, Math.round(keepRect.y));
    const x1 = Math.min(width, x0 + Math.max(1, Math.round(keepRect.w)));
    const y1 = Math.min(height, y0 + Math.max(1, Math.round(keepRect.h)));
    for (let y = y0; y < y1; y++) raw.fill(0, y * width + x0, y * width + x1);
  }
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

function placement(width: number, height: number, innerW: number, innerH: number, direction: ImageOutpaintDirection) {
  const x = direction === "left" ? width - innerW : direction === "right" ? 0 : Math.round((width - innerW) / 2);
  const y = direction === "top" ? height - innerH : direction === "bottom" ? 0 : Math.round((height - innerH) / 2);
  return { x, y, w: innerW, h: innerH };
}

/**
 * Produces the actual files handed to sd-cli. The mask follows the engine's
 * convention: white = regenerate, black = preserve.
 */
export async function prepareEditInput(options: {
  mode: ImageEditMode;
  settings: ImageGenerationSettings;
  sourceId?: string;
  maskId?: string;
  direction?: ImageOutpaintDirection;
}): Promise<PreparedInput | null> {
  if (options.mode === "text") return null;
  const width = Math.max(256, Math.min(512, Math.round(options.settings.width || 256)));
  const height = Math.max(256, Math.min(512, Math.round(options.settings.height || 256)));
  mkdirSync(inputDir, { recursive: true });
  const id = safeId(randomUUID());
  const initPath = join(inputDir, `${id}-init.png`);
  const maskPath = join(inputDir, `${id}-mask.png`);
  const files = [initPath];
  try {

  if (options.mode === "outpaint") {
    const source = assetPathOrThrow(options.sourceId, "source image");
    const meta = await sharp(source).metadata();
    if (!meta.width || !meta.height) throw new Error("The source image has no readable dimensions.");
    const scale = Math.min((width * 0.7) / meta.width, (height * 0.7) / meta.height);
    const innerW = Math.max(64, Math.round(meta.width * scale));
    const innerH = Math.max(64, Math.round(meta.height * scale));
    const rect = placement(width, height, innerW, innerH, options.direction ?? "all");
    const inner = await sharp(source).resize(innerW, innerH, { fit: "fill" }).png().toBuffer();
    const canvas = await sharp({
      create: { width, height, channels: 3, background: { r: 24, g: 24, b: 28 } },
    }).composite([{ input: inner, left: rect.x, top: rect.y }]).png().toBuffer();
    writeFileSync(initPath, canvas);
    writeFileSync(maskPath, await maskPng(width, height, rect));
    files.push(maskPath);
    return {
      initImagePath: initPath,
      maskImagePath: maskPath,
      files,
      width,
      height,
      note: `Canvas extended for ${options.direction ?? "all"}-side outpainting. The original pixels occupy the black mask region; the new border is regenerated locally. No dedicated outpaint model is installed.`,
    };
  }

  const source = assetPathOrThrow(options.sourceId, "source image");
  const resized = await sharp(source).resize(width, height, { fit: "fill" }).png().toBuffer();
  writeFileSync(initPath, resized);

  if (options.mode === "img2img") {
    return {
      initImagePath: initPath,
      files,
      width,
      height,
      note: `Image-to-image: the uploaded image seeds the latent. Strength ${Math.round((options.settings.strength ?? 0.55) * 100)}% controls how far the local model may change it.`,
    };
  }

  const mask = assetPathOrThrow(options.maskId, "mask image");
  const maskPngBuffer = await sharp(mask).resize(width, height, { fit: "fill" }).greyscale().png().toBuffer();
  writeFileSync(maskPath, maskPngBuffer);
  files.push(maskPath);
  const notes: Record<string, string> = {
    mask: "Mask-guided edit: white mask areas are regenerated, black areas preserved. This uses SD 1.5 image guidance because no dedicated inpaint weights are installed.",
    remove: "Object removal: paint the object white in the mask. The local model regenerates only that region from the surrounding context.",
    background: "Background replacement: paint the old background white and keep the subject black. The local model regenerates the masked area; silhouette quality depends on your mask.",
  };
  return {
    initImagePath: initPath,
    maskImagePath: maskPath,
    files,
    width,
    height,
    note: notes[options.mode] ?? notes.mask,
  };
  } catch (error) {
    // A failure after the first write must not leave temp PNGs behind.
    for (const file of files) rmSync(file, { force: true });
    throw error;
  }
}

export function removePreparedInput(prepared: PreparedInput | null): void {
  if (!prepared) return;
  for (const file of prepared.files) rmSync(file, { force: true });
}
