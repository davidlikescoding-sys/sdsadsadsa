import { describe, expect, it } from "vitest";
import { buildVisualDescription } from "./prompt-builder";
import { enhancePrompt } from "./prompt-enhancer";
import type { ImageGenerationSettings, VisualResearchResult } from "./types";
import { deriveCorrection, deriveStructuralCorrection, identifySubjects, mergeConcept, normalizeConcept, seedConcepts, upsertConcept } from "./visual-knowledge";

const settings: ImageGenerationSettings = {
  width: 384,
  height: 384,
  steps: 20,
  guidance: 7,
  seed: null,
  negativePrompt: "blurry, low quality, distorted, watermark, text, extra limbs, deformed anatomy, malformed hands",
  style: "photorealistic",
  strength: 0.55,
};

function buildFor(prompt: string, research: VisualResearchResult | null = null, style = "photorealistic") {
  const concepts = seedConcepts();
  const subjects = identifySubjects(prompt, concepts, 6);
  return {
    subjects,
    concepts,
    built: buildVisualDescription({
      prompt,
      subjects,
      concepts,
      research,
      feedbackNotes: [],
      settings: { ...settings, style },
    }),
  };
}

function researchFor(prompt: string, characteristics: string[]): VisualResearchResult {
  return {
    query: prompt,
    subjects: [],
    searches: [],
    references: [],
    characteristics,
    concepts: seedConcepts(),
    skipped: false,
    completedAt: new Date(0).toISOString(),
  };
}

describe("seed visual knowledge", () => {
  it("carries structural rules into seed concepts", () => {
    const concepts = seedConcepts();
    const airplane = concepts.find((concept) => concept.name === "airplane");
    expect(airplane?.constraints).toContain("two wings of equal size extending left and right");
    expect(airplane?.negativeConstraints).toContain("engine on top of the fuselage");
    expect(concepts.find((concept) => concept.name === "man")?.negativeConstraints).toContain("extra heads");
    expect(concepts.find((concept) => concept.name === "helicopter")?.constraints).toContain("large rotor blades above the fuselage");
    expect(concepts.find((concept) => concept.name === "lion")?.negativeConstraints).toContain("no mane");
  });
});

describe("knowledge persistence", () => {
  it("keeps more than sixteen learned rules and existing feedback notes when merging", () => {
    const base = seedConcepts().find((concept) => concept.name === "airplane")!;
    const notes = [
      { id: "n1", createdAt: new Date(0).toISOString(), kind: "correction" as const, note: "the nose is flat", subject: "airplane" },
      { id: "n2", createdAt: new Date(0).toISOString(), kind: "correction" as const, note: "the shadows are wrong", subject: "airplane" },
    ];
    const merged = mergeConcept({ ...base, feedbackNotes: notes }, {
      constraints: Array.from({ length: 20 }, (_, index) => `learned must ${index}`),
      negativeConstraints: Array.from({ length: 20 }, (_, index) => `learned avoid ${index}`),
      feedbackNotes: [{ id: "n3", createdAt: new Date(0).toISOString(), kind: "visual-fact" as const, note: "clean symmetrical silhouette", subject: "airplane" }],
    });
    expect(merged.constraints?.length).toBe(24);
    expect(merged.negativeConstraints?.length).toBe(24);
    expect(merged.feedbackNotes.map((note) => note.note)).toEqual(
      expect.arrayContaining(["the nose is flat", "the shadows are wrong", "clean symmetrical silhouette"]),
    );
    const next = upsertConcept([merged], { ...merged, attributes: [...merged.attributes, "new attribute"] });
    expect(next[0].attributes).toContain("new attribute");
    expect(next[0].feedbackNotes.length).toBe(3);
    const hydrated = normalizeConcept({
      ...merged,
      constraints: [...(merged.constraints ?? []).slice(0, -1), "hydrated rule"],
      negativeConstraints: [...(merged.negativeConstraints ?? []).slice(0, -1), "hydrated avoid"],
    });
    expect(hydrated?.constraints).toContain("hydrated rule");
    expect(hydrated?.negativeConstraints).toContain("hydrated avoid");
    expect(hydrated?.feedbackNotes.length).toBe(3);
  });
});

describe("structural feedback", () => {
  it("converts the reported plane mistakes into reusable rules", () => {
    const wings = deriveStructuralCorrection("one wing is much smaller than the other");
    const engine = deriveStructuralCorrection("the engine is on top of the plane");
    expect(wings?.positive).toBe("two symmetrical wings of equal size");
    expect(wings?.negative).toContain("one wing larger than the other");
    expect(engine?.positive).toBe("engines mounted beneath the wings");
    expect(engine?.negative).toContain("engine on top of the fuselage");
    expect(deriveCorrection("the engine is on top of the plane")).toBe("engines mounted beneath the wings");
    const wrongSubject = deriveStructuralCorrection("i asked for a plane not the interior of a car");
    expect(wrongSubject?.positive).toBe("full exterior view of the requested subject");
    expect(wrongSubject?.negative).toContain("car interior");
  });
});

describe("buildVisualDescription", () => {
  it("describes a person and suit concretely, without wasting tokens on headers", () => {
    const prompt = "a man in a suit";
    const { subjects, built } = buildFor(prompt);
    expect(subjects.map((subject) => subject.name)).toEqual(expect.arrayContaining(["man", "suit"]));
    expect(built.finalPrompt).toMatch(/^a man in a suit,/);
    expect(built.finalPrompt.toLowerCase()).toContain("tailored jacket");
    expect(built.finalPrompt.toLowerCase()).toContain("adult male face");
    expect(built.finalPrompt.toLowerCase()).toContain("photograph");
    expect(built.finalPrompt).not.toContain("Original request");
    expect(built.negativePrompt.toLowerCase()).toContain("deformed anatomy");
    expect(built.finalPrompt.length).toBeLessThan(900);
  });

  it("enforces aircraft structure and excludes the reported failures", () => {
    const prompt = "A cool grey plane with guns";
    const research = researchFor(prompt, [
      "bright high-key tones",
      "dark tonal range",
      "night-time lighting",
      "photorealistic rendering",
      "coastal water detail",
    ]);
    const { subjects, built } = buildFor(prompt, research);
    expect(subjects.map((subject) => subject.name)).toEqual(expect.arrayContaining(["airplane", "aircraft guns"]));
    expect(built.finalPrompt.toLowerCase()).toContain("grey airplane");
    expect(built.finalPrompt.toLowerCase()).toContain("wing-mounted cannons");
    expect(built.finalPrompt.toLowerCase()).toContain("flying in a clear blue sky");
    expect(built.finalPrompt.toLowerCase()).toContain("two wings of equal size");
    expect(built.finalPrompt.toLowerCase()).toContain("tail assembly with vertical fin");
    expect(built.finalPrompt.toLowerCase()).toContain("engines mounted under the wings");
    expect(built.finalPrompt.toLowerCase()).toContain("landing gear below the fuselage");
    expect(built.finalPrompt.toLowerCase()).toContain("clean uncluttered background");
    expect(built.negativePrompt.toLowerCase()).toContain("busy background");
    expect(built.negativePrompt.toLowerCase()).toContain("car interior");
    expect(built.negativePrompt.toLowerCase()).toContain("one wing larger than the other");
    expect(built.negativePrompt.toLowerCase()).toContain("engine on top of the fuselage");
    expect(built.finalPrompt).not.toContain("bright high-key tones");
    expect(built.finalPrompt).not.toContain("night-time lighting");
    expect(built.finalPrompt).not.toContain("coastal water detail");
    // Vehicles use a short canonical prompt: long rule lists made SD 1.5 drift
    // into interiors and unrelated machinery.
    expect(built.finalPrompt.split(/[\s,]+/).filter(Boolean).length).toBeLessThan(60);
    expect(built.finalPrompt).not.toContain("long cylindrical fuselage");
    expect(built.adjustments.some((item) => item.includes("structural rule"))).toBe(true);
  });

  it("applies the reported plane corrections to the next prompt", () => {
    const notes = [
      "the nose is flat",
      "you can barely even see the landing gear",
      "the shadows are wrong",
      "theres a weird bus in the backround and dense forest or smoke",
    ].map((note, index) => ({ id: `note-${index}`, createdAt: new Date(0).toISOString(), kind: "correction" as const, note, subject: "airplane" }));
    const concepts = seedConcepts();
    const subjects = identifySubjects("A cool grey plane with guns", concepts, 6);
    const built = buildVisualDescription({
      prompt: "A cool grey plane with guns",
      subjects,
      concepts,
      research: null,
      feedbackNotes: notes,
      settings,
    });
    const prompt = built.finalPrompt.toLowerCase();
    const negative = built.negativePrompt.toLowerCase();
    expect(prompt).toContain("pointed streamlined nose cone");
    expect(prompt).toContain("extended landing gear clearly visible beneath the fuselage");
    expect(prompt).toContain("clean empty sky background with no other objects");
    expect(negative).toContain("flat nose");
    expect(negative).toContain("missing landing gear");
    expect(negative).toContain("bus");
    expect(negative).toContain("forest");
    expect(negative).toContain("smoke");
    expect(negative).toContain("harsh inconsistent shadows");
  });

  it("deduplicates overlapping negative phrases instead of spending CLIP tokens twice", () => {
    const notes = [
      "the nose is flat",
      "you can barely even see the landing gear",
      "theres a weird bus in the backround and dense forest or smoke",
    ].map((note, index) => ({ id: `note-${index}`, createdAt: new Date(0).toISOString(), kind: "correction" as const, note, subject: "airplane" }));
    const concepts = seedConcepts();
    const subjects = identifySubjects("A cool grey plane with guns", concepts, 6);
    const built = buildVisualDescription({
      prompt: "A cool grey plane with guns",
      subjects,
      concepts,
      research: null,
      feedbackNotes: notes,
      settings,
    });
    const terms = built.negativePrompt.toLowerCase().split(",").map((term) => term.trim());
    const duplicates = terms.filter((term, index) => terms.indexOf(term) !== index);
    expect(duplicates).toEqual([]);
    expect(terms.filter((term) => term === "flat nose").length).toBe(1);
    expect(terms.filter((term) => term === "bus").length).toBe(1);
    expect(built.negativePrompt.length).toBeLessThanOrEqual(700);
  });

  it("withholds caption guesses when structured rules already cover the subject", () => {
    const { built } = buildFor(
      "a man in a suit",
      researchFor("a man in a suit", ["red color accents", "dark tonal range", "natural fabric folds"]),
    );
    expect(built.finalPrompt).not.toContain("red color accents");
    expect(built.finalPrompt).not.toContain("dark tonal range");
    expect(built.adjustments.some((item) => item.includes("research captions withheld"))).toBe(true);
  });

  it("keeps reliable research characteristics for unfamiliar subjects", () => {
    const { built } = buildFor(
      "a rare hand-carved ocarina",
      researchFor("a rare hand-carved ocarina", ["red color accents", "dark tonal range", "hand-carved wooden surface"]),
    );
    expect(built.finalPrompt).toContain("hand-carved wooden surface");
    expect(built.finalPrompt).not.toContain("red color accents");
    expect(built.finalPrompt).not.toContain("dark tonal range");
  });

  it("does not add photographic terms to a painting style", () => {
    const { built } = buildFor("a man in a suit", null, "watercolor");
    expect(built.finalPrompt.toLowerCase()).not.toContain("photograph");
    expect(built.finalPrompt.toLowerCase()).toContain("soft pigment edges");
  });

  it("collapses a shorter material cue into its richer form", () => {
    const prompt = "a macro shot of a chrome watch";
    const concepts = seedConcepts();
    const subjects = identifySubjects(prompt, concepts, 6);
    const built = buildVisualDescription({
      prompt,
      subjects,
      concepts,
      research: null,
      feedbackNotes: [],
      settings,
      enhancement: enhancePrompt(prompt, settings),
    });
    const occurrences = built.finalPrompt.toLowerCase().match(/mirror-like metal/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(built.finalPrompt.toLowerCase()).toContain("mirror-like metal surfaces");
  });
});
