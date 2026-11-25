import { describe, expect, it } from "vitest";
import {
  controlTerms, cueConflictsWithRequest, enhancePrompt, filterReferenceCues,
  parsePromptIntent, promptWeaknesses,
} from "./prompt-enhancer";
import type { ImageGenerationSettings } from "./types";
import { conceptNeedsResearch, identifySubjects, seedConcepts } from "./visual-knowledge";

const settings: ImageGenerationSettings = {
  width: 256,
  height: 256,
  steps: 16,
  guidance: 7,
  seed: null,
  negativePrompt: "blurry, low quality",
  style: "photorealistic",
  strength: 0.55,
};

describe("prompt enhancement engine", () => {
  it("keeps the user's request first and adds only detected visual cues", () => {
    const result = enhancePrompt(
      "A macro shot of a chrome wristwatch on a dark wooden desk, highly detailed",
      settings,
    );
    expect(result.intent.request.startsWith("A macro shot of a chrome wristwatch")).toBe(true);
    expect(result.text.startsWith(result.intent.request)).toBe(true);
    expect(result.additions).toEqual(expect.arrayContaining([
      "extreme close framing",
      "mirror-like metal surfaces",
      "visible natural wood grain",
    ]));
    expect(result.text).toContain("highly detailed");
    expect(result.additions).not.toContain("highly detailed");
    expect(result.additions.length).toBeLessThanOrEqual(12);
  });

  it("moves explicit negations out of the positive prompt", () => {
    const result = enhancePrompt("A silver airplane, no visible brand text, without contrails", settings);
    expect(result.intent.negations).toEqual(expect.arrayContaining(["visible brand text", "contrails"]));
    expect(result.intent.request).not.toMatch(/no visible brand text|without contrails/i);
    expect(result.negativeSuggestions).toEqual(expect.arrayContaining(["no visible brand text", "no contrails"]));
  });

  it("compiles UI controls into readable prompt phrases without duplicating labels", () => {
    const terms = controlTerms({
      ...settings,
      lighting: "warm rim light",
      camera: "macro close-up",
      colorPalette: "teal and amber",
      depthOfField: "shallow bokeh",
      detailLevel: "highly detailed",
    });
    expect(terms).toContain("warm rim light");
    expect(terms).not.toContain("warm rim light lighting");
    expect(terms).toContain("teal and amber color palette");
    expect(terms).toContain("shallow bokeh");
    expect(terms).toContain("highly detailed");
  });

  it("reports real prompt weaknesses instead of inventing praise", () => {
    const short = promptWeaknesses("a cat", settings);
    expect(short.join(" ")).toMatch(/very short|setting|lighting|framing|surface/i);
    const detailed = promptWeaknesses(
      "A golden retriever in a snowy forest at golden hour, close-up, visible fur texture, highly detailed",
      { ...settings, negativePrompt: "blurry" },
    );
    expect(detailed.length).toBeLessThan(short.length);
  });

  it("recognises intent across the requested prompt categories", () => {
    const samples = [
      "A golden retriever in a snowy forest at golden hour, close-up",
      "Portrait of an elderly ship captain on a foggy deck, soft lighting",
      "A vintage silver sports car on a wet city street at night, three quarter view",
      "A modern glass skyscraper viewed from below against a cloudy sky",
      "A wide alpine valley at dawn, mist over a mountain lake",
      "Overhead macro shot of steaming ramen on a dark wooden table",
      "A chrome wristwatch on a dark wooden desk, extreme close-up",
      "An astronaut crossing a red desert plain beneath two moons, cinematic",
      "An ancient stone bridge with glowing runes in a misty canyon at twilight",
      "Candid street photograph in the rain, rule of thirds, natural light",
      "A busy railway station at evening with travelers, deep focus, highly detailed",
      "Abstract watercolor of teal and amber shapes on textured paper, negative space",
    ];
    for (const sample of samples) {
      expect(parsePromptIntent(sample).categories.length, sample).toBeGreaterThan(0);
    }
  });

  it("does not treat camera and furniture words as research subjects", () => {
    const prompt = "A macro shot of a chrome wristwatch on a dark wooden desk";
    const subjects = identifySubjects(prompt, seedConcepts(), 6);
    expect(subjects.map((subject) => subject.name)).not.toContain("shot");
    expect(subjects.map((subject) => subject.name)).not.toContain("desk");
    const weak = identifySubjects("An unfamiliar axolotl-like creature", seedConcepts(), 6)
      .find((subject) => subject.name.includes("axolotl"));
    if (weak) expect(conceptNeedsResearch(weak, false)).toBe(true);
  });
});

describe("reference cue honesty", () => {
  it("keeps compatible palette cues and rejects explicit contradictions", () => {
    const cues = [
      "inspired by a #ffcc66 and #cc6633 palette",
      "bright high-key tonality",
      "inspired by a #112233 and #224466 palette",
      "dark low-key tonality",
    ];
    const request = "a moonlit night city in cool blue rain";
    const applied = filterReferenceCues(cues, request);
    expect(applied).toContain(cues[2]);
    expect(applied).toContain(cues[3]);
    expect(applied).not.toContain(cues[0]);
    expect(applied).not.toContain(cues[1]);
  });

  it("reports conflicts without mutating the user's own wording", () => {
    expect(cueConflictsWithRequest("warm golden highlights", "a moonlit night scene")).toBe(true);
    expect(cueConflictsWithRequest("cool moonlit tonality", "a warm sunset portrait")).toBe(true);
    const intent = parsePromptIntent("A vintage car in a hangar, no logo, without watermark");
    expect(intent.request).toBe("A vintage car in a hangar");
    expect(intent.negations).toEqual(["logo", "watermark"]);
    expect(enhancePrompt("A vintage car in a hangar, no logo").negativeSuggestions).toContain("no logo");
  });
});
