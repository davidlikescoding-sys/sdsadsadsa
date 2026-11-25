import { describe, expect, it } from "vitest";
import {
  analyzeSentence, missingGrammarLessons, normalizeWord, retrieveDictionary,
  searchDictionary, SEED_WORDS, seedDictionary,
} from "./dictionary";
import type { DictionaryWord } from "./types";

function word(name: string, part: DictionaryWord["partOfSpeech"], definition: string, example = `I use ${name}.`): DictionaryWord {
  return {
    id: name.toLowerCase(), word: name, definition, partOfSpeech: part, example, related: [],
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", useCount: 0,
  };
}

const words: DictionaryWord[] = SEED_WORDS.map((seed) => ({
  id: seed.word.toLowerCase(), word: seed.word, definition: seed.definition,
  partOfSpeech: seed.partOfSpeech, example: seed.example, related: seed.related ?? [],
  createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", useCount: 0,
}));

describe("dictionary seeding", () => {
  it("defines the initial everyday, math and coding words with definitions, parts of speech and examples", () => {
    expect(SEED_WORDS).toHaveLength(97);
    expect(SEED_WORDS.map((seed) => seed.word)).toEqual([
      "Hello", "World", "I", "You", "Am", "Is", "Are", "The", "Have", "Learn",
      "Plus", "Minus", "Multiplied by", "Divided by", "Addition", "Subtraction",
      "Multiplication", "Division", "Add", "Subtract", "Multiply", "Divide",
      "Equals", "Times", "Sum", "Difference", "Product", "Quotient",
      "JavaScript", "Python", "Variable", "Constant", "Function", "Parameter", "Return",
      "Loop", "Array", "String", "Boolean", "Integer", "Condition", "Class", "Object",
      "Method", "Comment", "Syntax", "Bug", "Debug", "Compiler", "Interpreter", "Library",
      "Module", "Import", "Export", "Operator", "Algorithm", "Print", "Console",
      "Data type", "If statement", "For loop", "While loop",
      "Game", "Sprite", "Collision", "Score", "Level", "Player", "Enemy", "Animation",
      "Physics", "Game loop", "Input", "Hitbox", "Coordinate", "Frame", "Restart",
      "HTML", "CSS", "DOM", "Element", "Tag", "Attribute", "Selector", "Style", "Layout",
      "Responsive", "Event", "Listener", "Form", "Fetch", "API", "JSON", "Route",
      "Component", "Browser", "Server",
    ]);
    for (const seed of SEED_WORDS) {
      expect(seed.definition.length).toBeGreaterThan(10);
      expect(seed.partOfSpeech).toBeTruthy();
      expect(seed.example.length).toBeGreaterThan(5);
    }
    expect(SEED_WORDS.some((seed) => seed.word === "Plus" && seed.definition.includes("sign"))).toBe(true);
    expect(SEED_WORDS.some((seed) => seed.word === "JavaScript" && seed.definition.includes("web pages"))).toBe(true);
    expect(SEED_WORDS.some((seed) => seed.word === "Python" && seed.definition.includes("readable"))).toBe(true);
    expect(SEED_WORDS.some((seed) => seed.word === "Game loop" && seed.definition.includes("frame"))).toBe(true);
    expect(SEED_WORDS.some((seed) => seed.word === "HTML" && seed.definition.includes("structure"))).toBe(true);
    expect(SEED_WORDS.some((seed) => seed.word === "CSS" && seed.definition.includes("stylesheet"))).toBe(true);
  });

  it("only seeds words that are missing", () => {
    expect(seedDictionary([])).toHaveLength(97);
    expect(seedDictionary(words)).toHaveLength(0);
    expect(seedDictionary(words.slice(0, 9)).map((seed) => seed.word)).toEqual(SEED_WORDS.slice(9).map((seed) => seed.word));
    expect(normalizeWord("  WORLD! ")).toBe("world");
  });

  it("seeds grammar lessons into knowledge without duplicating existing ones", () => {
    const all = missingGrammarLessons([]);
    expect(all.length).toBeGreaterThanOrEqual(11);
    expect(all.some((lesson) => lesson.content.includes("I read books."))).toBe(true);
    expect(all.some((lesson) => lesson.content.includes("The sky is blue."))).toBe(true);
    expect(missingGrammarLessons([{ id: all[0].id, category: "Grammar", title: all[0].title, content: all[0].content, createdAt: "", updatedAt: "" }])).toHaveLength(all.length - 1);
  });

  it("keeps all bundled lessons unique and includes the expanded subject range", () => {
    const all = missingGrammarLessons([]);
    expect(all).toHaveLength(263);
    expect(new Set(all.map((lesson) => lesson.id)).size).toBe(all.length);
    expect(all.some((lesson) => lesson.title.includes("Math vocabulary and symbols"))).toBe(true);
    expect(all.some((lesson) => lesson.title.includes("JavaScript programming"))).toBe(true);
    expect(all.some((lesson) => lesson.title.includes("Python programming"))).toBe(true);
    expect(all.some((lesson) => lesson.title.includes("How to make a game"))).toBe(true);
    expect(all.some((lesson) => lesson.title.includes("How to build a website"))).toBe(true);
    const titles = all.map((lesson) => lesson.title);
    expect(titles.filter((title) => title.startsWith("Grammar:")).length).toBeGreaterThan(60);
    expect(titles.filter((title) => title.startsWith("Knowledge:")).length).toBeGreaterThan(190);
    expect(titles.some((title) => title.includes("Quadratic equations"))).toBe(true);
    expect(titles.some((title) => title.includes("Ancient civilizations"))).toBe(true);
    expect(titles.some((title) => title.includes("Music theory"))).toBe(true);
    expect(titles.some((title) => title.includes("First aid"))).toBe(true);
    expect(titles.some((title) => title.includes("Compound-complex sentences"))).toBe(true);
    expect(titles.some((title) => title.includes("Bayes theorem"))).toBe(true);
    expect(titles.some((title) => title.includes("Neural networks"))).toBe(true);
    expect(titles.some((title) => title.includes("Black holes"))).toBe(true);
  });
});

describe("dictionary retrieval", () => {
  it("searches by word, definition and part of speech", () => {
    expect(searchDictionary(words, "World").map((item) => item.word)).toContain("World");
    expect(searchDictionary(words, "greeting").map((item) => item.word)).toContain("Hello");
    expect(searchDictionary(words, "pronoun").map((item) => item.word)).toContain("I");
  });

  it("only retrieves dictionary words actually present in the message", () => {
    expect(retrieveDictionary("What is a world?", words).map((m) => m.word.word)).toContain("World");
    expect(retrieveDictionary("quantum banana", words)).toEqual([]);
  });

  it("never retrieves a rejected correction as a dictionary answer", () => {
    const rejected = { ...word("Moose", "noun", "A small rodent."), reviewStatus: "rejected" as const };
    expect(retrieveDictionary("What is a moose?", [rejected])).toEqual([]);
  });

  it("does not return a qualifier word as the headword when it modifies a subject", () => {
    const electrical = [word("Current", "noun", "A flow of electric charge.")];
    expect(retrieveDictionary("What is the current Canadian prime minister?", electrical)).toEqual([]);
    expect(retrieveDictionary("What does current mean?", electrical).map((m) => m.word.word)).toContain("Current");
  });

});

describe("sentence analysis", () => {
  it("recognizes subject, verb and object in I learn English", () => {
    const analysis = analyzeSentence("I learn English.", words);
    expect(analysis.subject).toContain("i");
    expect(analysis.verbs).toContain("learn");
    expect(analysis.pattern).toBe("Subject + Verb + Object");
    expect(analysis.description).toContain("subject i");
    expect(analysis.matches.map((m) => m.word.word)).toContain("I");
  });

  it("recognizes the additional-information pattern", () => {
    const analysis = analyzeSentence("I learn English every day.", words);
    expect(analysis.pattern).toBe("Subject + Verb + Object + Additional information");
    expect(analysis.adverbs).toContain("day");
  });

  it("recognizes subject + verb and subject + verb + adjective", () => {
    expect(analyzeSentence("I run.", words).pattern).toBe("Subject + Verb");
    expect(analyzeSentence("The sky is blue.", [...words, word("Blue", "adjective", "The colour of the clear sky.")]).pattern)
      .toBe("Subject + Verb + Adjective");
  });

});
