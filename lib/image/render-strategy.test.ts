import { describe, expect, it } from "vitest";
import { resolveAutoSampler, resolveCacheMode, resolveSampler, resolveScheduler } from "./render-strategy";
import { detectAnatomy } from "./visual-anatomy";
import type { ImageGenerationSettings } from "./types";
import { identifySubjects, seedConcepts } from "./visual-knowledge";

const base: ImageGenerationSettings = {
  width: 384,
  height: 384,
  steps: 20,
  guidance: 7,
  seed: null,
  negativePrompt: "",
  style: "photorealistic",
  strength: 0.55,
  sampler: "auto",
  scheduler: "auto",
  speed: "balanced",
  quality: "high",
};

function anatomyFor(prompt: string) {
  const concepts = seedConcepts();
  return detectAnatomy(prompt, identifySubjects(prompt, concepts, 6));
}

describe("real render strategy", () => {
  it("uses one colour-stable deterministic sampler for every subject", () => {
    expect(resolveAutoSampler(anatomyFor("a portrait of an elderly woman"), "high")).toBe("euler");
    expect(resolveAutoSampler(anatomyFor("a golden retriever in a meadow"), "ultra")).toBe("euler");
    expect(resolveAutoSampler(anatomyFor("a hand-carved ocarina"), "high")).toBe("euler");
    expect(resolveAutoSampler(anatomyFor("a grey airplane in a hangar"), "draft")).toBe("euler");
  });

  it("uses the matching LCM sampler and scheduler for the fused LCM checkpoint", () => {
    expect(resolveAutoSampler(undefined, "high", "dreamshaper-lcm")).toBe("lcm");
    expect(resolveSampler(base, undefined, "dreamshaper-lcm")).toBe("lcm");
    expect(resolveScheduler(base, "dreamshaper-lcm")).toBe("lcm");
    // A manual override still wins for either model.
    expect(resolveSampler({ ...base, sampler: "euler" }, undefined, "dreamshaper-lcm")).toBe("euler");
    expect(resolveScheduler({ ...base, scheduler: "karras" }, "dreamshaper-lcm")).toBe("karras");
  });

  it("honours manual pro controls over Auto", () => {
    expect(resolveSampler({ ...base, sampler: "dpm++2m_sde" }, anatomyFor("a portrait of a man"))).toBe("dpm++2m_sde");
    expect(resolveScheduler({ ...base, scheduler: "exponential" })).toBe("exponential");
    expect(resolveScheduler(base)).toBe("karras");
  });

  it("maps speed to the measured cache strategy", () => {
    expect(resolveCacheMode(base)).toBe("balanced");
    expect(resolveCacheMode({ ...base, speed: "turbo" })).toBe("turbo");
    expect(resolveCacheMode({ ...base, speed: "quality" })).toBe("quality");
  });
});
