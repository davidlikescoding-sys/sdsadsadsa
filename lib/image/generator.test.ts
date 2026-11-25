import { describe, expect, it, vi } from "vitest";
import {
  UPSCALER_NAME, UPSCALER_SCALE, buildGenerationArgs,
  resolveLocalModel, type GenerationArgsInput,
} from "./generator";
import { LOCAL_UPSCALER_NAME } from "./types";

// Model weights are intentionally excluded from the GitHub/Vercel bundle.
// This check is about provenance logic, so make the installed weights explicit
// instead of depending on the machine running the test.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) => {
      const normalized = String(path).replace(/\\/g, "/");
      if (/models\/(realistic-vision-v60-b1-Q4_1|stable-diffusion-v1-5-f16)\.gguf$/.test(normalized)) {
        return true;
      }
      return actual.existsSync(path);
    },
  };
});

const base: GenerationArgsInput = {
  modelFile: "models/stable-diffusion-v1-5-f16.gguf",
  prompt: "a grey airplane flying in a clear blue sky",
  negativePrompt: "blurry, watermark",
  width: 384,
  height: 256,
  steps: 16,
  cfg: 7,
  sampler: "dpm++2mv2",
  scheduler: "karras",
  cacheMode: "balanced",
  threads: 4,
  strength: 0.55,
  outputPattern: "data/images/render.png",
  hasInput: false,
  vaeTiling: false,
  hires: false,
  hiresSteps: 0,
  batchCount: 1,
  actualSeed: 90210,
};

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("local engine argv", () => {
  it("passes dimensions, sampler, seed and cache settings to sd-cli", () => {
    const args = buildGenerationArgs(base);
    expect(value(args, "-W")).toBe("384");
    expect(value(args, "-H")).toBe("256");
    expect(value(args, "--steps")).toBe("16");
    expect(value(args, "--cfg-scale")).toBe("7");
    expect(value(args, "--sampling-method")).toBe("dpm++2mv2");
    expect(value(args, "--scheduler")).toBe("karras");
    expect(value(args, "-s")).toBe("90210");
    expect(value(args, "--cache-mode")).toBe("ucache");
    expect(value(args, "--cache-option")).toBe("threshold=0.40");
    expect(args).toContain("--conv-direct");
    expect(value(args, "--conv-direct")).toBe("on");
    expect(args).toContain("--mmap");
    expect(value(args, "--rng")).toBe("cpu");
    expect(value(args, "-o")).toBe("data/images/render.png");
  });

  it("uses the exact cache strategy selected in settings", () => {
    const quality = buildGenerationArgs({ ...base, cacheMode: "quality" });
    // Full fidelity means no cache approximation at all on this engine.
    expect(quality).not.toContain("--cache-mode");
    expect(quality).not.toContain("--cache-option");
    const turbo = buildGenerationArgs({ ...base, cacheMode: "turbo" });
    expect(value(turbo, "--cache-mode")).toBe("spectrum");
    expect(turbo).not.toContain("--cache-option");
  });

  it("adds real hires, VAE tiling, batch and image-guided edit arguments", () => {
    const args = buildGenerationArgs({
      ...base,
      vaeTiling: true,
      hires: true,
      hiresSteps: 10,
      batchCount: 3,
      hasInput: true,
      initImagePath: "data/images/source.png",
      maskImagePath: "data/images/mask.png",
      strength: 0.42,
      actualSeed: 123,
    });
    expect(args).toContain("--vae-tiling");
    expect(args).toContain("--hires");
    expect(value(args, "--hires-scale")).toBe("2");
    expect(value(args, "--hires-steps")).toBe("10");
    expect(value(args, "-b")).toBe("3");
    expect(value(args, "-i")).toBe("data/images/source.png");
    expect(value(args, "--strength")).toBe("0.42");
    expect(value(args, "--mask")).toBe("data/images/mask.png");
    expect(value(args, "-s")).toBe("123");
  });

  it("uses split CFG only for low-memory keyframe renders", () => {
    expect(buildGenerationArgs(base)).not.toContain("--batched-cfg");
    const low = buildGenerationArgs({ ...base, lowMemory: true });
    expect(value(low, "--batched-cfg")).toBe("off");
  });

  it("caps the negative prompt at the engine limit", () => {
    const args = buildGenerationArgs({ ...base, negativePrompt: "bad".repeat(500) });
    expect((value(args, "-n") ?? "").length).toBe(800);
  });
});

describe("local asset provenance", () => {
  it("selects the installed model family explicitly", () => {
    expect(resolveLocalModel("sd15-f16", false).file).toBe("stable-diffusion-v1-5-f16.gguf");
    expect(resolveLocalModel("sd15-q4", false).file).toBe("stable-diffusion-v1-5-Q4_1.gguf");
    expect(resolveLocalModel("realistic-v6", true).file).toBe("realistic-vision-v60-b1-Q4_1.gguf");
    expect(resolveLocalModel("dreamshaper-lcm", false).file).toBe("dreamshaper-7-lcm-q4_0.gguf");
    expect(resolveLocalModel("auto", false).file).toBe("stable-diffusion-v1-5-f16.gguf");
    expect(resolveLocalModel("auto", true).file).toBe("realistic-vision-v60-b1-Q4_1.gguf");
  });

  it("names the installed restorer honestly", () => {
    expect(UPSCALER_NAME).toBe(LOCAL_UPSCALER_NAME);
    expect(UPSCALER_NAME).toContain("NMKD Superscale-SP");
    expect(UPSCALER_NAME.toLowerCase()).not.toContain("real-esrgan");
    expect(UPSCALER_SCALE).toBe(4);
  });
});
