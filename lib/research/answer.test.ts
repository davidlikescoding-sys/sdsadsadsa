import { describe, expect, it } from "vitest";
import { shouldTryWebFallback } from "./fallback";
import { detectFactQuestion, extractCapital, extractPerson } from "./text";
import { runWebResearch } from "./engine";
import type { LocalKnowledgeMatch, SearchHit, SourceSearchResult, WebPage } from "./types";

function hit(id: string, title: string, url: string, snippet: string): SearchHit {
  return { id, title, url, snippet, source: "wikipedia" };
}

const franceHit = hit("fr", "France", "https://en.wikipedia.org/wiki/France", "France country capital Paris");
const punishmentHit = hit("cp", "Capital punishment in France", "https://en.wikipedia.org/wiki/Capital_punishment_in_France", "Capital punishment banned in France");

const pages: Record<string, WebPage> = {
  "https://en.wikipedia.org/wiki/France": {
    url: "https://en.wikipedia.org/wiki/France",
    finalUrl: "https://en.wikipedia.org/wiki/France",
    title: "France",
    text: "France is a country primarily located in Western Europe. Its capital, largest city and main cultural and economic centre is Paris, with a metropolitan population of over 13 million. Metropolitan France was settled during the Iron Age by Celtic tribes known as Gauls before Rome annexed the area in 51 BC, leading to a distinct Gallo-Roman culture.",
    fetchedAt: "2026-01-01T00:00:00.000Z", bytes: 500, truncated: false,
  },
  "https://en.wikipedia.org/wiki/Capital_punishment_in_France": {
    url: "https://en.wikipedia.org/wiki/Capital_punishment_in_France",
    finalUrl: "https://en.wikipedia.org/wiki/Capital_punishment_in_France",
    title: "Capital punishment in France",
    text: "Capital punishment in France is banned by Article 66-1 of the Constitution of the French Republic, voted as a constitutional amendment by the Congress of the French Parliament on 19 February 2007.",
    fetchedAt: "2026-01-01T00:00:00.000Z", bytes: 400, truncated: false,
  },
};

const search = async (): Promise<SourceSearchResult[]> => [{
  source: "wikipedia", query: "capital of France", hits: [punishmentHit, franceHit], ok: true, elapsedMs: 10,
}];
const read = async (url: string): Promise<WebPage> => pages[url];

describe("single-value fact extraction", () => {
  it("recognises a capital question and rejects capital punishment phrasing", () => {
    const fact = detectFactQuestion("What is the capital of France?");
    expect(fact?.kind).toBe("capital");
    expect(fact?.label).toBe("France");
    expect(fact?.required).toContain("france");
    expect(extractCapital("Capital punishment in France is banned by law.")).toBeNull();
  });

  it("pulls the named capital from a real source sentence", () => {
    const text = pages["https://en.wikipedia.org/wiki/France"].text;
    expect(extractCapital(text.split(". ")[1])).toBe("Paris");
    expect(extractCapital("Paris is the capital and largest city of France.")).toBe("Paris");
  });

  it("recognises current office-holder questions but not historical ones", () => {
    expect(detectFactQuestion("Who is the current prime minister of Canada?"))
      .toMatchObject({ kind: "person", role: "prime minister", label: "Canada" });
    expect(detectFactQuestion("Who is the Canadian prime minister?"))
      .toMatchObject({ kind: "person", role: "prime minister", label: "Canadian" });
    expect(detectFactQuestion("Who was the prime minister of Canada in 2015?")).toBeNull();
    expect(extractPerson("Mark Carney is the current prime minister of Canada, taking office on March 14, 2025.", "prime minister"))
      .toBe("Mark Carney");
  });
});

describe("automatic web fallback", () => {
  it("runs only when local data has no answer and no web attempt was made", () => {
    expect(shouldTryWebFallback("fallback", false)).toBe(true);
    expect(shouldTryWebFallback(null, false)).toBe(true);
    expect(shouldTryWebFallback("grounded", false)).toBe(false);
    expect(shouldTryWebFallback("generated", false)).toBe(false);
    expect(shouldTryWebFallback("experimental", false)).toBe(false);
    expect(shouldTryWebFallback("fallback", true)).toBe(false);
  });
});

describe("web research answer shaping", () => {
  it("answers a capital question with one sentence and no unrelated local dump", async () => {
    const localKnowledge: LocalKnowledgeMatch[] = [{
      title: "Random Junk",
      text: "[Dataset: Random Junk]\nto the foundations of computing. The Wright brothers developed and flew an early successful powered airplane. GEOGRAPHY Canada is a country in North America. Ottawa is the capital of Canada. Toronto is the largest cit",
    }];
    const result = await runWebResearch("What is the capital of France?", { search, read, localKnowledge });
    expect(result.answer).toContain("The capital of France is Paris.");
    expect(result.answer).not.toContain("Capital punishment");
    expect(result.answer).not.toContain("Ottawa");
    expect(result.answer).not.toContain("Random Junk");
    expect(result.answer).not.toContain("1. ");
    expect(result.citations).toHaveLength(1);
  });

  it("quotes only the real answer from a flattened dialogue dataset", async () => {
    const localKnowledge: LocalKnowledgeMatch[] = [{
      title: "Game development",
      text: "GAME DEVELOPMENT User: How do you make a game? DavidAI: A game has a game loop that runs once per frame. Each frame reads input, updates the player and enemies, checks collisions between sprites with hitboxes, and draws the screen.",
    }];
    const gameHit = hit("game", "Video game development", "https://en.wikipedia.org/wiki/Video_game_development", "game loop input update draw");
    const gamePage: WebPage = {
      url: gameHit.url, finalUrl: gameHit.url, title: gameHit.title,
      text: "Game development is the process of creating a game. A game loop reads input, updates state and draws the screen each frame.",
      fetchedAt: "2026-01-01T00:00:00.000Z", bytes: 300, truncated: false,
    };
    const result = await runWebResearch("How do you make a game?", {
      search: async () => [{ source: "wikipedia", query: "make a game", hits: [gameHit], ok: true, elapsedMs: 10 }],
      read: async () => gamePage,
      localKnowledge,
    });
    expect(result.answer).toContain("A game has a game loop");
    expect(result.answer).not.toContain("GAME DEVELOPMENT");
    expect(result.answer).not.toContain("User:");
  });

  it("answers a current office-holder question with one person sentence", async () => {
    const canadaHit = hit("ca", "Prime Minister of Canada", "https://en.wikipedia.org/wiki/Prime_Minister_of_Canada", "current prime minister Canada");
    const canadaPage: WebPage = {
      url: canadaHit.url,
      finalUrl: canadaHit.url,
      title: canadaHit.title,
      text: "The prime minister of Canada is the head of government of Canada. Mark Carney is the current prime minister of Canada, taking office on March 14, 2025.",
      fetchedAt: "2026-01-01T00:00:00.000Z", bytes: 300, truncated: false,
    };
    const personSearch = async (): Promise<SourceSearchResult[]> => [{
      source: "wikipedia", query: "current prime minister Canada", hits: [canadaHit], ok: true, elapsedMs: 10,
    }];
    const result = await runWebResearch("Who is the current prime minister of Canada?", {
      search: personSearch, read: async (url) => canadaPage,
    });
    expect(result.answer).toContain("The current prime minister of Canada is Mark Carney.");
    expect(result.answer).not.toContain("head of government");
    expect(result.citations).toHaveLength(1);
  });

  it("keeps several statements for a multi-source comparison", async () => {
    const result = await runWebResearch("Compare information about the same subject from three different websites.", {
      search, read, historyContext: "user: What is the capital of France?",
    });
    expect(result.answer).toContain("Based on");
    expect(result.answer).toMatch(/1\./);
  });
});
