import { describe, expect, it } from "vitest";
import {
  classifyUtterance, correctSpelling, detectAmbiguities, enrichUnderstanding,
  resolveContext, understandMessage,
} from "./language";
import type { DictionaryWord } from "./types";
import type { DictionaryMatch } from "./dictionary";
import { buildConceptGraph } from "./concept-graph";

function word(name: string, synonyms: string[] = [], related: string[] = [], topics: string[] = []): DictionaryWord {
  return {
    id: name.toLowerCase(), word: name, definition: `the meaning of ${name}`, partOfSpeech: "noun",
    example: `A ${name} example.`, related, synonyms, topics,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", useCount: 0,
  };
}

describe("correctSpelling", () => {
  it("expands informal wording using a fixed local map", () => {
    const result = correctSpelling("plz explain ur idea", new Set(["please", "your", "explain", "idea"]));
    expect(result.text).toBe("please explain your idea");
    expect(result.corrections.map((c) => c.reason)).toEqual(["informal", "informal"]);
  });

  it("fixes a clear single-character typo against the user's dictionary", () => {
    const result = correctSpelling("captial city", new Set(["capital", "city"]));
    expect(result.text).toBe("capital city");
    expect(result.corrections[0]).toMatchObject({ from: "captial", to: "capital", reason: "spelling" });
  });

  it("leaves ambiguous or unknown words untouched instead of guessing", () => {
    const result = correctSpelling("qwerty zxcvb", new Set(["capital", "city"]));
    expect(result.text).toBe("qwerty zxcvb");
    expect(result.corrections).toEqual([]);
  });

  it("preserves capitalization of the original token", () => {
    const result = correctSpelling("Captial city", new Set(["capital", "city"]));
    expect(result.text).toBe("Capital city");
  });
});

describe("classifyUtterance", () => {
  it("recognizes questions, greetings, commands and follow-ups", () => {
    expect(classifyUtterance("What is photosynthesis?", false).intent).toBe("question");
    expect(classifyUtterance("What is photosynthesis?", false).questionKind).toBe("definition");
    expect(classifyUtterance("Hello there", false).intent).toBe("greeting");
    expect(classifyUtterance("Calculate 15% of 80", false).questionKind).toBe("calculation");
    expect(classifyUtterance("Define photosynthesis", false).questionKind).toBe("definition");
    expect(classifyUtterance("Why did it happen?", true).intent).toBe("followup");
    expect(classifyUtterance("And what about that?", true).isFollowup).toBe(true);
  });

  it("does not treat a short first message as a follow-up", () => {
    expect(classifyUtterance("why?", false).intent).toBe("question");
  });
});

describe("resolveContext", () => {
  it("recovers the subject of a short follow-up from recent turns", () => {
    const terms = resolveContext("why?", [
      { role: "user", content: "Photosynthesis needs sunlight because plants convert light." },
      { role: "assistant", content: "Plants use light to make sugar." },
    ]);
    expect(terms).toContain("photosynthesis");
  });

  it("returns nothing when the message is already self-contained", () => {
    expect(resolveContext("What is the capital of France?", [
      { role: "user", content: "Photosynthesis needs sunlight." },
    ])).toEqual([]);
  });
});

describe("understandMessage", () => {
  const dictionary = [
    word("enormous", ["huge", "immense"], ["large"], ["size"]),
    word("dog", ["canine"], ["animal"], ["pets"]),
  ];

  it("normalizes, classifies and expands with the local concept network", () => {
    const graph = buildConceptGraph({ dictionary, knowledge: [] });
    const result = understandMessage({
      text: "What does huge mean?",
      history: [],
      dictionary,
      conceptGraph: graph,
    });
    expect(result.normalized).toBe("what does huge mean?");
    expect(result.intent).toBe("question");
    expect(result.terms).toContain("huge");
    expect(result.expandedTerms).toEqual(expect.arrayContaining(["huge", "enormous", "immense"]));
  });

  it("does not rewrite a valid subject found in local knowledge into a typo target", () => {
    const withMouse = [...dictionary, word("mouse", [], [], [])];
    expect(understandMessage({ text: "What is a moose?", history: [], dictionary: withMouse }).corrected)
      .toBe("What is a mouse?");

    const withCorpus = understandMessage({
      text: "What is a moose?",
      history: [],
      dictionary: withMouse,
      knownWords: ["moose", "large", "antlers"],
    });
    expect(withCorpus.corrected).toBe("What is a moose?");
    expect(withCorpus.corrections).toEqual([]);
  });

  it("records ambiguity from unresolvable pronouns and alternatives", () => {
    const result = understandMessage({ text: "Why did it happen or not?", history: [], dictionary });
    expect(result.ambiguities.some((note) => note.includes("pronoun"))).toBe(true);
    expect(result.ambiguities.some((note) => note.includes("alternatives"))).toBe(true);
  });

  it("enrichUnderstanding adds dictionary metadata after retrieval", () => {
    const base = understandMessage({ text: "Tell me about canine", history: [], dictionary });
    const matches: DictionaryMatch[] = [{
      word: dictionary[1],
      definition: "a domesticated animal",
      score: 1,
    } as DictionaryMatch];
    const enriched = enrichUnderstanding(base, matches);
    expect(enriched.expandedTerms).toEqual(expect.arrayContaining(["canine", "animal", "pets"]));
  });

  it("detectAmbiguities reports spelling and tied dictionary matches", () => {
    const notes = detectAmbiguities(
      "captial",
      [{ from: "captial", to: "capital", reason: "spelling" }],
      [
        { word: word("capital"), definition: "", score: 1 } as DictionaryMatch,
        { word: word("capitol"), definition: "", score: 1 } as DictionaryMatch,
      ],
      [],
    );
    expect(notes.some((note) => note.includes("capital"))).toBe(true);
    expect(notes.some((note) => note.includes("Several dictionary entries"))).toBe(true);
  });
});
