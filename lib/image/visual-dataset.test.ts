import { describe, expect, it } from "vitest";
import { buildVisualDescription } from "./prompt-builder";
import type { GeneratedImage, ImageGenerationSettings, VisualConcept } from "./types";
import { DATASET_CONCEPTS, VISUAL_DATASET_PACKS, visualDatasetStats } from "./visual-dataset";
import { identifySubjects, learnFromGallery, seedConcepts, structuralRules } from "./visual-knowledge";

const settings: ImageGenerationSettings = {
  width: 256,
  height: 256,
  steps: 16,
  guidance: 7,
  seed: null,
  negativePrompt: "blurry, low quality, distorted, watermark, text",
  style: "photorealistic",
  strength: 0.55,
  speed: "balanced",
  autoEnhance: true,
};

describe("bundled visual dataset", () => {
  it("ships structured packs with positive and negative rules", () => {
    expect(VISUAL_DATASET_PACKS.length).toBeGreaterThanOrEqual(4);
    expect(DATASET_CONCEPTS.length).toBeGreaterThan(60);
    const stats = visualDatasetStats();
    expect(stats.positiveRules).toBeGreaterThan(80);
    expect(stats.negativeRules).toBeGreaterThan(100);
    const tiger = DATASET_CONCEPTS.find((concept) => concept.name === "tiger");
    expect(tiger?.constraints).toContain("four legs");
    expect(tiger?.negativeConstraints).toEqual(expect.arrayContaining(["spots instead of stripes"]));
  });

  it("merges dataset concepts into seed knowledge without duplicates", () => {
    const concepts = seedConcepts();
    expect(concepts.length).toBeGreaterThan(140);
    expect(new Set(concepts.map((concept) => concept.id)).size).toBe(concepts.length);
    expect(concepts.find((concept) => concept.name === "tiger")?.category).toBe("animal");
    expect(concepts.find((concept) => concept.name === "black and white")?.category).toBe("style");
  });

  it("recognises dataset aliases, including on records saved before aliases existed", () => {
    const concepts = seedConcepts().map(({ aliases: _aliases, ...concept }) => concept as VisualConcept);
    const subjects = identifySubjects("a jetliner above the clouds", concepts, 6);
    expect(subjects.map((subject) => subject.name)).toContain("airplane");
    const macro = identifySubjects("a macro shot of a watch", seedConcepts(), 6);
    expect(macro.map((subject) => subject.name)).toEqual(expect.arrayContaining(["macro", "watch"]));
  });

  it("applies camera and material knowledge to concise object prompts", () => {
    const concepts = seedConcepts();
    const prompt = "a macro shot of a chrome watch";
    const subjects = identifySubjects(prompt, concepts, 6);
    const built = buildVisualDescription({ prompt, subjects, concepts, research: null, feedbackNotes: [], settings });
    const lower = built.finalPrompt.toLowerCase();
    expect(lower).toContain("extreme close framing");
    expect(lower).toContain("mirror-like metal");
    expect(lower).toContain("highly detailed");
    expect(lower).toContain("dial face on the front");
    expect(lower).not.toContain("Original request");
  });
});

describe("gallery learning", () => {
  it("promotes subject-scoped structural corrections into durable rules", () => {
    const concepts = seedConcepts();
    const tiger = concepts.find((concept) => concept.name === "tiger")!;
    const history = (subject: string, correction: string) => [{
      ...({} as GeneratedImage),
      id: "gallery-1",
      researchSummary: { skipped: true, subjects: [subject], references: 0, characteristics: [], queries: [] },
      feedback: [{
        id: "fb-1",
        rating: "dislike" as const,
        correction,
        kinds: ["visual-fact", "correction"],
        createdAt: new Date(0).toISOString(),
      }],
    }] as GeneratedImage[];

    // A wheel complaint belongs to the animal whose legs were replaced.
    const animalResult = learnFromGallery(history("tiger", "it has wheels instead of legs"), [
      { ...tiger, constraints: [], negativeConstraints: [] },
    ]);
    expect(animalResult.added).toBe(1);
    expect(animalResult.subjects).toContain("tiger");
    expect(structuralRules(animalResult.concepts).positive).toContain("four legs with natural animal anatomy");
    expect(structuralRules(animalResult.concepts).negative).toContain("wheels");

    // The same complaint must never become an airplane rule, and an aircraft
    // nose complaint must never become a tiger rule.
    expect(learnFromGallery(history("tiger", "the nose is flat"), concepts).added).toBe(0);
    const airplane = concepts.find((concept) => concept.name === "airplane")!;
    const planeWithoutNoseRule = {
      ...airplane,
      constraints: airplane.constraints?.filter((rule) => rule !== "pointed streamlined nose cone"),
      negativeConstraints: airplane.negativeConstraints?.filter((rule) => rule !== "flat nose"),
    };
    const planeResult = learnFromGallery(history("airplane", "the nose is flat"), [planeWithoutNoseRule]);
    expect(planeResult.added).toBe(1);
    expect(planeResult.subjects).toContain("airplane");
    expect(structuralRules(planeResult.concepts).positive).toContain("pointed streamlined nose cone");
    expect(structuralRules(planeResult.concepts).negative).toContain("flat nose");
  });
});
