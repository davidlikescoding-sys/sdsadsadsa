import { describe, expect, it } from "vitest";
import { chunkText, documentsFromStore, retrieveContext } from "./rag";
import type { Dataset, KnowledgeEntry } from "./types";

function dataset(id: string, name: string, content: string): Dataset {
  return {
    id, name, content, description: "", category: "General", hash: id,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function knowledge(id: string, title: string, content: string): KnowledgeEntry {
  return {
    id, title, content, category: "General",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("RAG chunking", () => {
  it("splits long text into bounded chunks with overlap", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} explains retrieval clearly.`).join(" ");
    const chunks = chunkText(text, 300, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300);
    expect(chunks.join(" ")).toContain("Sentence number 0");
  });

  it("returns no chunks for empty text", () => {
    expect(chunkText("   \n\n ")).toEqual([]);
  });
});

describe("RAG retrieval", () => {
  const documents = documentsFromStore(
    [dataset("d1", "Training corpus", "The local transformer uses character tokens and gradient descent.")],
    [knowledge("k1", "Project notes", "DavidAI uses a server-side language model for coherent chat answers.")],
  );

  it("retrieves uploaded knowledge for a matching question", () => {
    const result = retrieveContext("How does DavidAI answer chat questions?", documents);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].sourceType).toBe("knowledge");
    expect(result.sources[0].content).toContain("server-side language model");
  });

  it("prioritizes uploaded knowledge over a generic dataset when both match", () => {
    const mixed = documentsFromStore(
      [dataset("d1", "Model notes", "The model uses gradient descent and character tokens.")],
      [knowledge("k1", "Model notes", "DavidAI uses Adam optimization during local training.")],
    );
    const result = retrieveContext("What optimizer does the model use?", mixed);
    expect(result.chunks[0].sourceType).toBe("knowledge");
  });

  it("returns no context for unrelated or empty questions", () => {
    expect(retrieveContext("", documents).chunks).toEqual([]);
    expect(retrieveContext("what how the a and", documents).chunks).toEqual([]);
  });

  it("does not retrieve the definition of 'current' for a qualifier question", () => {
    const mixed = documentsFromStore(
      [dataset("d1", "Electricity", "Current is the flow of electric charge in a circuit.")],
      [knowledge("k1", "Canada", "The Prime Minister of Canada leads the federal government.")],
    );
    const result = retrieveContext("What is the current Canadian prime minister?", mixed, {
      maxChunks: 3, maxChars: 1600, chunkSize: 420,
    });
    expect(result.sources.map((source) => source.title)).not.toContain("Electricity");
    expect(result.sources.map((source) => source.title)).toContain("Canada");
  });

  it("does not retrieve context when only one coincidental term matches", () => {
    const weakDocuments = documentsFromStore(
      [dataset("d1", "Reference", "This reference happens to mention precise in an unrelated example.")],
      [],
    );
    expect(retrieveContext("What is the precise altitude of the lunar railway in Neptunia?", weakDocuments).chunks).toEqual([]);
  });

  it("does not retrieve uploaded text for greetings and small talk", () => {
    expect(retrieveContext("Hello DavidAI", documents).chunks).toEqual([]);
    expect(retrieveContext("Hello, who are you?", documents).chunks).toEqual([]);
  });

  it("respects the chunk and character budgets", () => {
    const many = documentsFromStore(
      Array.from({ length: 10 }, (_, i) => dataset(`d${i}`, `Doc ${i}`, "quantum finance ledger reconciliation ".repeat(20))),
      [],
    );
    const result = retrieveContext("quantum finance ledger reconciliation", many, { maxChunks: 2, maxChars: 1200 });
    expect(result.chunks.length).toBeLessThanOrEqual(2);
    expect(result.chars).toBeLessThanOrEqual(1200);
  });
});
