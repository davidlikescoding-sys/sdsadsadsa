import { describe, expect, it } from "vitest";
import {
  buildConceptGraph, conceptGraphStats, conceptKey, edgesFromCorrection,
  expandConcepts, mergeConceptEdges, relatedConcepts,
} from "./concept-graph";
import type { Correction, DictionaryWord, KnowledgeEntry } from "./types";

function word(name: string, synonyms: string[] = [], related: string[] = [], topics: string[] = []): DictionaryWord {
  return {
    id: name.toLowerCase(), word: name, definition: `the meaning of ${name}`, partOfSpeech: "noun",
    example: `A ${name} example.`, related, synonyms, topics,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", useCount: 0,
  };
}

function entry(id: string, title: string, content: string): KnowledgeEntry {
  return {
    id, title, content, category: "Science",
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

describe("conceptKey", () => {
  it("normalizes phrases into stable identifiers", () => {
    expect(conceptKey("  Bayes' Theorem! ")).toBe("bayes_theorem");
    expect(conceptKey("neural networks")).toBe("neural_networks");
  });
});

describe("buildConceptGraph", () => {
  it("builds synonym, related and topic links from the local dictionary", () => {
    const graph = buildConceptGraph({
      dictionary: [word("enormous", ["huge", "immense"], ["large"], ["size"])],
      knowledge: [],
    });
    expect(relatedConcepts("enormous", graph).map((item) => item.label)).toEqual(expect.arrayContaining(["huge", "immense", "large", "size"]));
    expect(relatedConcepts("enormous", graph).some((item) => item.relation === "synonym")).toBe(true);
    expect(conceptGraphStats(graph).nodes).toBeGreaterThan(4);
  });

  it("links knowledge terms to their entry and category", () => {
    const graph = buildConceptGraph({
      dictionary: [],
      knowledge: [entry("bayes", "Bayes theorem", "Bayes theorem uses prior probability and evidence.")],
    });
    const expanded = expandConcepts(["bayes"], graph, 10);
    expect(expanded.length).toBeGreaterThan(0);
    expect(graph.edges.some((edge) => edge.relation === "cooccurrence")).toBe(true);
  });

  it("includes learned feedback edges in the same graph", () => {
    const learned = [{
      from: "puppy", to: "dog", relation: "learned" as const, weight: 0.8, source: "correction:c1",
    }];
    const graph = buildConceptGraph({ dictionary: [], knowledge: [], learned });
    expect(expandConcepts(["puppy"], graph, 5)).toContain("dog");
    expect(conceptGraphStats(graph).learned).toBe(1);
  });
});

describe("expandConcepts", () => {
  it("returns one-hop and two-hop concepts without inventing new ones", () => {
    const graph = buildConceptGraph({
      dictionary: [
        word("dog", ["canine"], ["animal"], ["pets"]),
        word("animal", ["creature"], ["life"], ["biology"]),
      ],
      knowledge: [],
    });
    const expanded = expandConcepts(["dog"], graph, 12);
    expect(expanded).toContain("canine");
    expect(expanded.length).toBeGreaterThan(2);
    expect(expanded.length).toBeLessThanOrEqual(12);
  });

  it("returns nothing for unknown terms", () => {
    const graph = buildConceptGraph({ dictionary: [], knowledge: [] });
    expect(expandConcepts(["qwerty"], graph)).toEqual([]);
  });
});

describe("edgesFromCorrection", () => {
  const correction: Correction = {
    id: "c1", feedbackId: "f1", conversationId: "conv", question: "What is a puppy?",
    originalAnswer: "a cat", correctedAnswer: "A puppy is a young dog.",
    explanation: "Dogs are canines.", status: "approved",
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z",
  };

  it("creates learned associations from question terms to answer and explanation terms", () => {
    const edges = edgesFromCorrection(correction);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((edge) => edge.relation === "learned")).toBe(true);
    expect(edges.some((edge) => edge.from === "puppy" && edge.to === "dog")).toBe(true);
    expect(edges.every((edge) => edge.source === "correction:c1")).toBe(true);
  });

  it("merges edges by identity and keeps the strongest weight", () => {
    const first = edgesFromCorrection(correction);
    const merged = mergeConceptEdges(first, first);
    const unique = new Set(first.map((edge) => `${edge.from}|${edge.to}|${edge.relation}`)).size;
    expect(merged).toHaveLength(unique);
    expect(merged[0].weight).toBeLessThanOrEqual(1);
  });

  it("does not add learned edges for a trivial correction", () => {
    const trivial: Correction = { ...correction, question: "a", correctedAnswer: "b", explanation: "" };
    expect(edgesFromCorrection(trivial)).toEqual([]);
  });
});
