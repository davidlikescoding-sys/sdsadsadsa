import { describe, expect, it } from "vitest";
import { buildSmartDescription } from "./smart-prompt";
import { enhancePrompt } from "./prompt-enhancer";
import type { ImageGenerationSettings } from "./types";
import { identifySubjects, seedConcepts } from "./visual-knowledge";

const settings: ImageGenerationSettings = {
  width: 512,
  height: 512,
  steps: 8,
  guidance: 7,
  seed: null,
  negativePrompt: "blurry, low quality, watermark, text",
  style: "photorealistic",
  strength: 0.55,
  speed: "turbo",
};

function build(prompt: string, extra: Partial<Parameters<typeof buildSmartDescription>[0]> = {}) {
  const concepts = seedConcepts();
  return buildSmartDescription({
    prompt,
    subjects: identifySubjects(prompt, concepts, 6),
    concepts,
    feedbackNotes: [],
    settings,
    ...extra,
  });
}

describe("compact subject-first prompt compiler", () => {
  it("keeps the user request dominant and discards long anatomy lists", () => {
    const result = build("A golden retriever sitting in a snowy pine forest at golden hour, close-up, photorealistic");
    expect(result.finalPrompt).toContain("golden retriever sitting in a snowy pine forest");
    expect(result.finalPrompt.length).toBeLessThanOrEqual(300);
    expect(result.finalPrompt).not.toContain("five separate fingers");
    expect(result.finalPrompt).not.toContain("one head with two eyes");
    expect(result.finalPrompt).toContain("natural animal anatomy");
    expect(result.negativePrompt).toContain("unnatural colors");
    expect(result.negativePrompt).toContain("color cast");
  });

  it("moves explicit negations into the negative prompt", () => {
    const result = build("a grey airplane in a hangar, no people, without text");
    expect(result.finalPrompt).not.toMatch(/\bno people\b|\bwithout text\b/i);
    expect(result.negativePrompt).toMatch(/people/);
    expect(result.negativePrompt).toMatch(/text/);
  });

  it("applies only corrections scoped to the current subject", () => {
    const result = build("a golden retriever in a meadow", {
      recentCorrections: [
        { note: "the plane nose is flat", subject: "airplane", kind: "correction" },
        { note: "the dog has extra legs", subject: "golden retriever", kind: "correction" },
      ],
    });
    expect(result.finalPrompt).not.toContain("pointed streamlined nose cone");
    expect(result.negativePrompt).not.toContain("flat nose");
  });

  it("caps enhancement cues and withholds conflicting ones", () => {
    const prompt = "a black sports car at night, photorealistic";
    const result = build(prompt, { enhancement: enhancePrompt(prompt, settings) });
    expect(result.finalPrompt.length).toBeLessThanOrEqual(300);
    expect(result.finalPrompt).not.toContain("bright high-key");
  });

  it("prioritises lighting, colour and snow cues over generic environment cues", () => {
    const prompt = "a golden retriever in a snowy pine forest at golden hour, photorealistic";
    const result = build(prompt, { enhancement: enhancePrompt(prompt, settings) });
    expect(result.finalPrompt).toMatch(/golden hour light|gold and amber tones/);
    expect(result.finalPrompt).toContain("bright white snow with cool blue shadows");
    expect(result.finalPrompt).not.toContain("forest environment");
    expect(result.finalPrompt.length).toBeLessThanOrEqual(300);
  });

  it("does not add cool snow shadows to a non-snowy scene", () => {
    const prompt = "a golden retriever in a meadow at golden hour, photorealistic";
    const result = build(prompt, { enhancement: enhancePrompt(prompt, settings) });
    expect(result.finalPrompt).not.toContain("cool blue shadows");
  });
});
