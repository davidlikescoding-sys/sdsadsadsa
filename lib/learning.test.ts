import { describe, expect, it } from "vitest";
import {
  answerAddressesQuestion, conversationPairs, datasetAnswers, exampleFromCorrection, exportLearningData,
  exportTrainingData, findConversationAnswer, findDatasetAnswer, findDatasetAnswers, groundedCandidates,
  isReadableText, learningStats, memoryHash, proposeMemory, rankRetrievalCandidates, retrieveLearningContext,
  unansweredSubjectTerms,
} from "./learning";
import type { Correction, Feedback, LearningSession, Memory, ModelVersion } from "./types";

function memory(id: string, content: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id, content, kind: "fact", conversationId: null, source: "user",
    hash: memoryHash(content), createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", recallCount: 0, ...overrides,
  };
}

function correction(id: string, question: string, answer: string, overrides: Partial<Correction> = {}): Correction {
  return {
    id, feedbackId: `f-${id}`, conversationId: "c1", question, originalAnswer: "WRONG",
    correctedAnswer: answer, explanation: "", status: "approved",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

describe("memory extraction", () => {
  it("only extracts explicit instructions and preferences", () => {
    expect(proposeMemory("Hello DavidAI")).toBeNull();
    expect(proposeMemory("What is the capital of France?")).toBeNull();
    expect(proposeMemory("Please remember that my emergency code is ZEPHYR-7")).toEqual({
      content: "my emergency code is ZEPHYR-7", kind: "explicit",
    });
    expect(proposeMemory("I prefer concise answers")).toEqual({
      content: "concise answers", kind: "preference",
    });
  });

  it("normalizes duplicate memory content to the same hash", () => {
    expect(memoryHash("My Name Is Sam.")).toBe(memoryHash("my name is sam"));
  });
});

describe("learning retrieval", () => {
  const memories = [
    memory("m1", "My preferred name is Sam.", { kind: "preference" }),
    memory("m2", "The launch code is ZEPHYR-7.", { conversationId: "c1" }),
    memory("m3", "The launch code is OMEGA-9.", { conversationId: "c2" }),
    memory("m4", "Old launch code is SUPERSEDED.", { supersededBy: "m2" }),
  ];
  const corrections = [
    correction("k1", "What is the launch code?", "The launch code is ZEPHYR-7."),
    correction("k2", "What is the lunar railway altitude?", "UNREVIEWED", { status: "pending" }),
  ];

  it("retrieves relevant memories and approved corrections only", () => {
    const result = retrieveLearningContext("What is the launch code?", { memories, corrections }, { conversationId: "c1" });
    expect(result.some((item) => item.sourceId === "m2")).toBe(true);
    expect(result.some((item) => item.sourceId === "k1")).toBe(true);
    expect(result.some((item) => item.sourceId === "m3")).toBe(false);
    expect(result.some((item) => item.sourceId === "m4")).toBe(false);
    expect(result.some((item) => item.sourceId === "k2")).toBe(false);
  });

  it("does not retrieve unrelated memories for a greeting", () => {
    expect(retrieveLearningContext("Hello", { memories, corrections })).toEqual([]);
  });

  it("uses only the newest approval for a question and remembers the wrong answer", () => {
    const older = correction("old", "What is the code?", "The old code.", { updatedAt: "2026-01-01T00:00:00.000Z", originalAnswer: "WRONG OLD" });
    const newer = correction("new", "What is the code?", "The new code.", { updatedAt: "2026-02-01T00:00:00.000Z", originalAnswer: "WRONG NEW" });
    const result = retrieveLearningContext("What is the code?", { corrections: [older, newer] });
    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBe("new");
    expect(result[0].content).toContain("Avoid (wrong answer): WRONG NEW");
    expect(result[0].content).toContain("Correct answer: The new code.");
  });
});

describe("grounded answer sources", () => {
  const dataset = "# Conversation\nUser: Hello\nDavidAI: Hello! How can I help you today?\n\nUser: What is ZEPHYR-7?\nDavidAI: It is the launch code.";

  it("extracts real Q&A pairs from user datasets", () => {
    expect(conversationPairs([dataset])).toEqual([
      { question: "Hello", answer: "Hello! How can I help you today?" },
      { question: "What is ZEPHYR-7?", answer: "It is the launch code." },
    ]);
    expect(findConversationAnswer("Hello there", [dataset])).toBe("Hello! How can I help you today?");
    expect(findConversationAnswer("quantum banana", [dataset])).toBeNull();
  });

  it("only offers answers from retrieved, approved or user-provided text", () => {
    const correctionItem = retrieveLearningContext("What is the code?", {
      corrections: [correction("k1", "What is the code?", "The code is ZEPHYR-7.")],
    })[0];
    const candidates = groundedCandidates({
      correctionItems: [correctionItem],
      conversationAnswer: findConversationAnswer("Hello", [dataset]),
      knowledgeItems: [{ title: "Notes", type: "knowledge", content: "[Knowledge: Notes]\nParis is the capital of France. It is a city." }],
    });
    expect(candidates.map((candidate) => candidate.text)).toContain("The code is ZEPHYR-7.");
    expect(candidates.some((candidate) => candidate.text.includes("Hello! How can I help you today?"))).toBe(true);
    expect(candidates.some((candidate) => candidate.text.includes("Paris is the capital of France."))).toBe(true);
    expect(candidates.find((candidate) => candidate.text.includes("Hello!"))!.priority)
      .toBeGreaterThan(candidates.find((candidate) => candidate.text.includes("Paris"))!.priority);
  });

  it("rejects a dictionary definition that ignores the question's subject", () => {
    const query = "What is the average size of a moose?";
    const matched = ["average", "size"];
    expect(unansweredSubjectTerms(query, matched)).toContain("moose");
    expect(answerAddressesQuestion(query, "average means Amount to or come to an average.", matched)).toBe(false);
    expect(answerAddressesQuestion(query, "Moose facts: Moose are large mammals; their size varies by species.", matched)).toBe(true);
    expect(answerAddressesQuestion("What does enormous mean", "Enormous is very large.", ["enormous"])).toBe(true);
  });

  it("puts the sentence that matches the question first in a knowledge excerpt", () => {
    const candidates = groundedCandidates({
      query: "What does average mean?",
      knowledgeItems: [{ title: "Statistics", type: "knowledge", content: "[Knowledge: Statistics]\nDistributions describe how values vary. The mean is the average of a set of values." }],
    });
    expect(candidates[0].text).toContain("The mean is the average");
    expect(candidates[0].text).not.toContain("Distributions describe");
  });

  it("quotes only the matching answer sentence, never a whole dataset paragraph", () => {
    const candidates = groundedCandidates({
      query: "Who is the current Canadian prime minister?",
      knowledgeItems: [{
        title: "DavidAI_General_Knowledge_Dataset", type: "knowledge",
        content: "[Knowledge: DavidAI_General_Knowledge_Dataset]\nown responsibilities. The Prime Minister leads the federal government. Municipal governments manage local matters under authority granted by provinces or territories. A Member of Parliament represents a constituency, also called a riding.",
      }],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe("The Prime Minister leads the federal government.");
    expect(candidates[0].text).not.toContain("own responsibilities");
    expect(candidates[0].text).not.toContain("Municipal governments");
    expect(candidates[0].source).toBe("DavidAI_General_Knowledge_Dataset");
  });

  it("does not quote a dialogue header or the question itself as the answer", () => {
    const candidates = groundedCandidates({
      query: "How do you make a game?",
      knowledgeItems: [{
        title: "Game development", type: "dataset",
        content: "GAME DEVELOPMENT User: How do you make a game? DavidAI: A game has a game loop that runs once per frame. Each frame reads input, updates the player and enemies, checks collisions between sprites with hitboxes, and draws the screen. The score and levels track progress.",
      }],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toContain("A game has a game loop");
    expect(candidates[0].text).not.toContain("GAME DEVELOPMENT");
    expect(candidates[0].text).not.toContain("User:");
  });

  it("accepts how-to answers that do not repeat the instructional verb", () => {
    const answer = "A game has a game loop that runs once per frame.";
    expect(answerAddressesQuestion("How do you make a game?", answer, ["Game", "Game loop"])).toBe(true);
    expect(answerAddressesQuestion("How do you build a website?", "A website uses HTML, CSS and JavaScript.", ["Website"])).toBe(true);
    expect(answerAddressesQuestion("How do you make a game?", "A banana is long and yellow.", ["Game"])).toBe(false);
  });

  it("does not mistake a temporal qualifier for the question's subject", () => {
    const query = "What is the current Canadian prime minister?";
    expect(unansweredSubjectTerms(query, ["current"])).toEqual(["canadian", "prime", "minister"]);
    expect(answerAddressesQuestion(query, "Current is a flow of electricity.", ["current"])).toBe(false);
    expect(answerAddressesQuestion(query, "The Prime Minister leads the federal government.")).toBe(true);
    expect(unansweredSubjectTerms("What does current mean?", ["current"])).toEqual([]);
  });

  it("ranks a subject-relevant candidate above a loosely matched definition", () => {
    const ranked = rankRetrievalCandidates({
      query: "What is a moose?",
      candidates: [
        { text: "average means Amount to or come to an average.", source: "Dictionary · average", priority: 1, score: 0 },
        { text: "Moose are large mammals.", source: "Knowledge · animals", priority: 1, score: 0 },
      ],
      modelScore: () => 0,
    });
    expect(ranked[0].source).toBe("Knowledge · animals");
    expect(ranked[0].coverage).toBe(1);
  });

  it("does not let a correction for a narrower question answer a broader one", () => {
    const correctionItem = retrieveLearningContext("What is a moose?", {
      corrections: [correction("k1", "What is the average size of a moose?", "The average size of a moose is 6 to 7 feet.")],
    })[0];
    const ranked = rankRetrievalCandidates({
      query: "What is a moose?",
      candidates: groundedCandidates({
        query: "What is a moose?",
        correctionItems: [correctionItem],
        knowledgeItems: [{ title: "Animals & Science", type: "knowledge", content: "[Knowledge: Animals & Science]\nA moose is a large deer species with broad antlers in males." }],
      }),
      modelScore: () => 0,
    });
    expect(ranked[0].source).toBe("Animals & Science");
    expect(ranked[0].text).toBe("A moose is a large deer species with broad antlers in males.");
    expect(ranked.find((candidate) => candidate.source === "Approved correction")?.questionMismatch).toBe(true);
  });

  it("does not let a remembered correction for a narrower question answer a broader one", () => {
    const memoryItem = retrieveLearningContext("What is a moose?", {
      memories: [memory("m1", 'Correct answer to "What is the average size of a moose.": The average size of a moose is 6 to 7 feet.', { kind: "correction" })],
    })[0];
    const ranked = rankRetrievalCandidates({
      query: "What is a moose?",
      candidates: groundedCandidates({
        query: "What is a moose?",
        memoryItems: [memoryItem],
        knowledgeItems: [{ title: "Animals & Science", type: "knowledge", content: "[Knowledge: Animals & Science]\nA moose is a large deer species with broad antlers in males." }],
      }),
      modelScore: () => 0,
    });
    expect(ranked[0].source).toBe("Animals & Science");
    expect(ranked.find((candidate) => candidate.source === "Memory")?.questionMismatch).toBe(true);
  });

  it("answers from dataset definitions and Q&A without inventing text", () => {
    const entries = datasetAnswers([
      { title: "Basic English", content: "# Dictionary\nHello: A greeting used when meeting someone.\nComputer: An electronic machine that processes information.\nVersion: 1.0" },
      { title: "Chat data", content: "User: Where is the launch pad?\nDavidAI: The launch pad is on the north coast." },
    ]);
    expect(entries.map((entry) => entry.question)).toContain("Computer");
    expect(entries.map((entry) => entry.question)).not.toContain("Version");
    expect(findDatasetAnswer("What is a computer?", entries)?.answer)
      .toBe("An electronic machine that processes information.");
    expect(findDatasetAnswer("Where is the launch pad?", entries)?.answer)
      .toBe("The launch pad is on the north coast.");
    const candidates = groundedCandidates({ datasetMatches: findDatasetAnswers("What is a computer?", entries) });
    expect(candidates[0].text).toBe("An electronic machine that processes information.");
    expect(candidates[0].source).toContain("Basic English");
  });

  it("rejects character-soup sampling noise", () => {
    expect(isReadableText("ue6AA##3RDA#，×VAAUDAI，—#9 V5 3CA")).toBe(false);
    expect(isReadableText("eatec et oi tsitremgen? Mi enyoCennnnhacohun세aonhe iunloapeustaptteshaZt . As iseo2t9 g ,neene .Dowtdo tetdtiaP #Da")).toBe(false);
    expect(isReadableText("Ir ictorensN ttlctt-risictth d. E ictardinis theoehbair iintanme senhhaoct aao nu =avidthalBonmi. deanthateiean dri.")).toBe(false);
    expect(isReadableText("Hello! How can I help you today?")).toBe(true);
    expect(isReadableText("The capital of France is Paris. It is a city in Europe.")).toBe(true);
    expect(isReadableText("The hypotenuse equals five.")).toBe(true);
  });
});

describe("training examples and exports", () => {
  const item = correction("k1", "What is the code?", "ZEPHYR-7", { explanation: "Solar-storm docking code." });

  it("builds a real next-token example from an approved correction", () => {
    const example = exampleFromCorrection(item);
    expect(example.question).toBe("What is the code?");
    expect(example.answer).toBe("ZEPHYR-7");
    expect(example.text).toContain("User: What is the code?");
    expect(example.text).toContain("ZEPHYR-7");
    expect(example.text.endsWith("</s>")).toBe(true);
  });

  it("exports learning data and a separate training dataset", () => {
    const feedback: Feedback[] = [{
      id: "f1", conversationId: "c1", userMessageId: "u1", assistantMessageId: "a1",
      userMessage: "What is the code?", assistantResponse: "WRONG", rating: "not_helpful",
      explanation: "", correction: "ZEPHYR-7", status: "approved", createdAt: "2026-01-01T00:00:00.000Z",
      correctionId: "k1", trainingExampleIds: ["e1"],
    }];
    const sessions: LearningSession[] = [{
      id: "s1", startedAt: "2026-01-01T00:00:00.000Z", status: "complete", steps: 10,
      exampleIds: ["e1"], trainExampleIds: ["e1"], validationExampleIds: [], lossHistory: [],
      validationHistory: [], finalLoss: 1.2, finalValidationLoss: 1.4,
    }];
    const versions: ModelVersion[] = [];
    const exported = JSON.parse(exportLearningData({
      memories: [], feedback, corrections: [item],
      examples: [{ ...exampleFromCorrection(item), id: "e1" }], sessions, versions,
    }));
    expect(exported.app).toBe("DavidAI-learning");
    expect(exported.feedback[0].userMessage).toBe("What is the code?");
    const dataset = JSON.parse(exportTrainingData([{ ...exampleFromCorrection(item), id: "e1" }]));
    expect(dataset.app).toBe("DavidAI-training-data");
    expect(dataset.examples[0].text).toContain("ZEPHYR-7");
  });

  it("counts feedback, approvals, examples and model version", () => {
    const stats = learningStats({
      memories: [memory("m1", "A fact.")], feedback: [], corrections: [item],
      examples: [{ ...exampleFromCorrection(item), id: "e1" }], sessions: [],
      versions: [{ id: "v1", version: 3 } as ModelVersion],
    });
    expect(stats.memories).toBe(1);
    expect(stats.approved).toBe(1);
    expect(stats.examples).toBe(1);
    expect(stats.version).toBe(3);
  });
});
