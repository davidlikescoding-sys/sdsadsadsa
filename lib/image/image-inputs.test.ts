import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { deleteImageAsset, referenceCues, saveImageAsset } from "./image-assets";
import { prepareEditInput, removePreparedInput, type PreparedInput } from "./image-inputs";
import type { ImageGenerationSettings } from "./types";

const settings: ImageGenerationSettings = {
  width: 256,
  height: 256,
  steps: 16,
  guidance: 7,
  seed: null,
  negativePrompt: "blurry, low quality",
  style: "auto",
  strength: 0.55,
};

const createdAssets: string[] = [];
const prepared: PreparedInput[] = [];

async function makePng(width: number, height: number, pixel: [number, number, number]): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < width * height; index++) {
    raw[index * 3] = pixel[0];
    raw[index * 3 + 1] = pixel[1];
    raw[index * 3 + 2] = pixel[2];
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function store(kind: "reference" | "edit" | "mask", pixel: [number, number, number]): Promise<string> {
  const asset = await saveImageAsset({ buffer: await makePng(64, 64, pixel), name: `${kind}-test.png`, kind });
  createdAssets.push(asset.id);
  return asset.id;
}

afterAll(async () => {
  for (const input of prepared.splice(0)) removePreparedInput(input);
  for (const id of createdAssets.splice(0)) deleteImageAsset(id);
});

describe("local image assets and edit inputs", () => {
  it("extracts real palette and brightness cues from uploaded bytes", async () => {
    const bright = await saveImageAsset({
      buffer: await makePng(48, 48, [245, 240, 225]),
      name: "bright-reference.png",
      kind: "reference",
    });
    createdAssets.push(bright.id);
    expect(bright.width).toBe(48);
    expect(bright.colors.length).toBeGreaterThan(0);
    expect(bright.brightness).toBeGreaterThan(0.8);
    expect(referenceCues([bright.id])).toContain("bright high-key tonality");
    expect(referenceCues([bright.id])[0]).toMatch(/inspired by a #[0-9a-f]{6}/);

    const dark = await saveImageAsset({
      buffer: await makePng(48, 48, [12, 10, 8]),
      name: "dark-reference.png",
      kind: "reference",
    });
    createdAssets.push(dark.id);
    expect(referenceCues([dark.id])).toContain("dark low-key tonality");
    expect(referenceCues(undefined)).toEqual([]);
    expect(referenceCues(["missing-id"])).toEqual([]);
  });

  it("rejects files that are not real supported images", async () => {
    await expect(saveImageAsset({
      buffer: Buffer.from("not an image"),
      name: "bad.txt",
      kind: "reference",
    })).rejects.toThrow(/PNG, JPEG or WebP/);
  });

  it("returns no prepared input for plain text generation", async () => {
    await expect(prepareEditInput({ mode: "text", settings })).resolves.toBeNull();
  });

  it("prepares a real img2img input without a mask", async () => {
    const sourceId = await store("edit", [40, 80, 160]);
    const result = await prepareEditInput({ mode: "img2img", settings, sourceId });
    expect(result).not.toBeNull();
    if (!result) return;
    prepared.push(result);
    expect(result.maskImagePath).toBeUndefined();
    expect(result.note).toContain("Strength 55%");
    const meta = await sharp(result.initImagePath).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it("prepares a mask-guided input with the engine's white-edit convention", async () => {
    const sourceId = await store("edit", [70, 120, 180]);
    const maskId = await store("mask", [255, 255, 255]);
    const result = await prepareEditInput({ mode: "remove", settings, sourceId, maskId });
    expect(result).not.toBeNull();
    if (!result) return;
    prepared.push(result);
    expect(result.maskImagePath).toBeDefined();
    expect(result.note).toMatch(/regenerates only that region/i);
    const meta = await sharp(result.maskImagePath!).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it("builds a real outpaint canvas and preserve mask", async () => {
    const sourceId = await store("edit", [120, 60, 180]);
    const result = await prepareEditInput({
      mode: "outpaint",
      settings,
      sourceId,
      direction: "all",
    });
    expect(result).not.toBeNull();
    if (!result) return;
    prepared.push(result);
    expect(result.maskImagePath).toBeDefined();
    expect(result.note).toMatch(/No dedicated outpaint model/i);
    const meta = await sharp(result.maskImagePath!).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    const { data } = await sharp(result.maskImagePath!).greyscale().raw().toBuffer({ resolveWithObject: true });
    const corner = data[0];
    const center = data[128 * 256 + 128];
    expect(corner).toBe(255);
    expect(center).toBe(0);
  });

  it("reports missing local inputs instead of silently generating", async () => {
    await expect(prepareEditInput({ mode: "img2img", settings, sourceId: undefined }))
      .rejects.toThrow(/locally uploaded source image/);
    const sourceId = await store("edit", [30, 30, 30]);
    await expect(prepareEditInput({ mode: "mask", settings, sourceId }))
      .rejects.toThrow(/locally uploaded mask image/);
  });
});
