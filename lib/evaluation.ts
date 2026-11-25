import type { Correction, DictionaryWord, KnowledgeEntry, LearningSession, Memory } from "./types";
import type { ConceptEdge } from "./concept-graph";
import { buildConceptGraph, expandConcepts } from "./concept-graph";
import { classifyUtterance, correctSpelling, resolveContext, understandMessage } from "./language";
import { decomposeQuestion, detectContradictions, evaluateArithmetic, solveLinearEquation } from "./reasoning";
import { proposeMemory, retrieveLearningContext } from "./learning";
import { tokenize } from "./rag";

export type EvalCategory = "language" | "reasoning" | "memory" | "generalization";

export interface EvaluationContext {
  dictionary: DictionaryWord[];
  knowledge: KnowledgeEntry[];
  memories: Memory[];
  corrections: Correction[];
  conceptEdges: ConceptEdge[];
  trainingLoss: number | null;
  validationLoss: number | null;
  learningSessions: LearningSession[];
}

export interface EvalCase {
  id: string;
  category: EvalCategory;
  name: string;
  prompt: string;
  expected: string;
  check: (context: EvaluationContext) => { passed: boolean; actual: string };
}

export interface EvalResult extends Omit<EvalCase, "check"> {
  passed: boolean;
  actual: string;
}

export interface CategoryScore {
  total: number;
  correct: number;
  accuracy: number;
}

export interface EvaluationReport {
  generatedAt: string;
  results: EvalResult[];
  total: number;
  correct: number;
  accuracy: number;
  categories: Record<EvalCategory, CategoryScore>;
  mistakes: Array<{ name: string; expected: string; actual: string }>;
  losses: {
    training: number | null;
    validation: number | null;
    latestSessionTraining: number | null;
    latestSessionValidation: number | null;
    sessions: number;
  };
}

const STAMP = "2026-01-01T00:00:00.000Z";

function word(id: string, name: string, definition: string, synonyms: string[] = []): DictionaryWord {
  return {
    id, word: name, definition, partOfSpeech: "noun", example: `A ${name} is described here.`,
    related: [], synonyms, topics: ["evaluation"], source: "evaluation", reviewStatus: "approved",
    createdAt: STAMP, updatedAt: STAMP, useCount: 0,
  };
}

function memory(id: string, content: string): Memory {
  return {
    id, content, kind: "fact", conversationId: null, source: "manual", hash: id,
    createdAt: STAMP, updatedAt: STAMP, recallCount: 0,
  };
}

function correction(id: string, question: string, answer: string): Correction {
  return {
    id, feedbackId: `fb-${id}`, conversationId: "eval", question,
    originalAnswer: "wrong", correctedAnswer: answer, explanation: "", status: "approved",
    createdAt: STAMP, updatedAt: STAMP,
  };
}

function result(passed: boolean, actual: string): { passed: boolean; actual: string } {
  return { passed, actual: actual || (passed ? "passed" : "no result") };
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "language-synonym-definition", category: "language", name: "Synonym/definition lookup",
    prompt: "What does enormous mean?", expected: "Find the local entry whose definition says very large.",
    check: () => {
      const entries = [word("enormous", "Enormous", "very large", ["huge", "immense"])];
      const match = entries.find((entry) => entry.word.toLowerCase() === "enormous");
      const terms = tokenize("What does huge mean?");
      const found = match && terms.some((term) => (match.synonyms ?? []).includes(term));
      return result(Boolean(found), match ? `Definition: ${match.definition}` : "No entry");
    },
  },
  {
    id: "language-spelling", category: "language", name: "Spelling mistake",
    prompt: "what is the captial of france", expected: "Recognise capital despite the typo.",
    check: () => {
      const fixed = correctSpelling("what is the captial of france", new Set(["capital", "france"]));
      return result(fixed.text.includes("capital"), fixed.text);
    },
  },
  {
    id: "language-intent", category: "language", name: "Follow-up recognition",
    prompt: "Why did that happen?", expected: "Classify as a follow-up question with history.",
    check: () => {
      const understanding = understandMessage({
        text: "Why did that happen?",
        history: [{ role: "user", content: "Photosynthesis needs sunlight." }],
      });
      return result(understanding.intent === "followup" && understanding.isQuestion, `${understanding.intent}/${understanding.questionKind}`);
    },
  },
  {
    id: "language-context", category: "language", name: "Context from previous turn",
    prompt: "why?", expected: "Recover the subject photosynthesis from recent history.",
    check: () => {
      const terms = resolveContext("why?", [{ role: "user", content: "Photosynthesis needs sunlight because plants convert light." }]);
      return result(terms.includes("photosynthesis"), terms.join(", ") || "no context");
    },
  },
  {
    id: "language-informal", category: "language", name: "Informal language",
    prompt: "plz explain", expected: "Expand plz to please.",
    check: () => {
      const fixed = correctSpelling("plz explain", new Set(["please", "explain"]));
      return result(fixed.text.includes("please"), fixed.text);
    },
  },
  {
    id: "reasoning-percent", category: "reasoning", name: "Percentage calculation",
    prompt: "What is 15% of 80?", expected: "12",
    check: () => {
      const calculation = evaluateArithmetic("What is 15% of 80?");
      return result(calculation?.value === 12, calculation ? String(calculation.value) : "failed to calculate");
    },
  },
  {
    id: "reasoning-multistep", category: "reasoning", name: "Multi-step decomposition",
    prompt: "Compare A and B and explain why", expected: "At least two subproblems.",
    check: () => {
      const parts = decomposeQuestion("Compare A and B and explain why");
      return result(parts.length >= 2, `${parts.length}: ${parts.join(" | ")}`);
    },
  },
  {
    id: "reasoning-pattern", category: "reasoning", name: "Linear equation",
    prompt: "2x + 3 = 11", expected: "x = 4",
    check: () => {
      const calculation = solveLinearEquation("2x + 3 = 11");
      return result(calculation?.value === 4, calculation ? `x = ${calculation.value}` : "not solved");
    },
  },
  {
    id: "reasoning-logic", category: "reasoning", name: "Contradiction detection",
    prompt: "The sky is blue / The sky is not blue", expected: "Detect a direct contradiction.",
    check: () => {
      const found = detectContradictions([
        { text: "The sky is blue", source: "A" },
        { text: "The sky is not blue", source: "B" },
      ]);
      return result(found.length > 0, found[0] ?? "none");
    },
  },
  {
    id: "memory-remember", category: "memory", name: "Remembering useful information",
    prompt: "My name is David", expected: "Store a fact memory containing David.",
    check: () => {
      const proposal = proposeMemory("My name is David");
      return result(proposal?.content.includes("David") === true, proposal?.content ?? "none");
    },
  },
  {
    id: "memory-retrieve", category: "memory", name: "Retrieving relevant memory",
    prompt: "What is the capital of France?", expected: "Retrieve the Paris memory, not an unrelated one.",
    check: () => {
      const items = retrieveLearningContext("What is the capital of France?", {
        memories: [memory("paris", "The capital of France is Paris."), memory("noise", "The weather is warm today.")],
      });
      return result(items.length === 1 && items[0].content.includes("Paris"), items.map((item) => item.content).join(" | ") || "none");
    },
  },
  {
    id: "memory-correction", category: "memory", name: "Applying an approved correction",
    prompt: "What is the capital of France?", expected: "Retrieve the approved correction naming Paris.",
    check: () => {
      const question = "What is the capital of France?";
      const items = retrieveLearningContext(question, {
        corrections: [correction("c1", question, "Paris is the capital of France.")],
      });
      return result(items.some((item) => (item.answer ?? "").includes("Paris")), items.map((item) => item.answer ?? item.content).join(" | ") || "none");
    },
  },
  {
    id: "memory-contradiction", category: "memory", name: "Avoiding contradictory memories",
    prompt: "Paris is in France / Paris is not in France", expected: "Flag conflicting stored statements.",
    check: () => {
      const found = detectContradictions([
        { text: "Paris is in France", source: "Memory A" },
        { text: "Paris is not in France", source: "Memory B" },
      ]);
      return result(found.length > 0, found[0] ?? "none");
    },
  },
  {
    id: "generalization-paraphrase", category: "generalization", name: "Differently worded calculation",
    prompt: "How do I compute 20 percent of 90?", expected: "18, same as 20% of 90.",
    check: () => {
      const calculation = evaluateArithmetic("How do I compute 20 percent of 90?");
      return result(calculation?.value === 18, calculation ? String(calculation.value) : "failed");
    },
  },
  {
    id: "generalization-concept", category: "generalization", name: "Learned concept relationship",
    prompt: "puppy → dog", expected: "Expand a learned puppy–dog edge from the concept graph.",
    check: () => {
      const graph = buildConceptGraph({
        dictionary: [], knowledge: [],
        learned: [{ from: "puppy", to: "dog", relation: "learned", weight: 0.8, source: "evaluation" }],
      });
      const expanded = expandConcepts(["puppy"], graph, 5);
      return result(expanded.includes("dog"), expanded.join(", ") || "none");
    },
  },
  {
    id: "generalization-define", category: "generalization", name: "Unfamiliar instruction wording",
    prompt: "Define photosynthesis", expected: "Recognise a definition request.",
    check: () => {
      const classification = classifyUtterance("Define photosynthesis", false);
      return result(classification.questionKind === "definition", `${classification.intent}/${classification.questionKind}`);
    },
  },
];

function percentage(correct: number, total: number): number {
  return total ? Math.round((correct / total) * 1000) / 10 : 0;
}

/** Repeatable, deterministic benchmark over pure local components. */
export function runEvaluation(context: EvaluationContext): EvaluationReport {
  const results: EvalResult[] = EVAL_CASES.map((testCase) => {
    const outcome = testCase.check(context);
    return {
      id: testCase.id, category: testCase.category, name: testCase.name,
      prompt: testCase.prompt, expected: testCase.expected,
      actual: outcome.actual, passed: outcome.passed,
    };
  });
  const categories = {} as Record<EvalCategory, CategoryScore>;
  for (const category of ["language", "reasoning", "memory", "generalization"] as EvalCategory[]) {
    const subset = results.filter((item) => item.category === category);
    categories[category] = {
      total: subset.length,
      correct: subset.filter((item) => item.passed).length,
      accuracy: percentage(subset.filter((item) => item.passed).length, subset.length),
    };
  }
  const correct = results.filter((item) => item.passed).length;
  const latest = context.learningSessions[context.learningSessions.length - 1] ?? null;
  return {
    generatedAt: new Date().toISOString(),
    results,
    total: results.length,
    correct,
    accuracy: percentage(correct, results.length),
    categories,
    mistakes: results.filter((item) => !item.passed).map((item) => ({ name: item.name, expected: item.expected, actual: item.actual })),
    losses: {
      training: context.trainingLoss,
      validation: context.validationLoss,
      latestSessionTraining: latest?.finalLoss ?? null,
      latestSessionValidation: latest?.finalValidationLoss ?? null,
      sessions: context.learningSessions.length,
    },
  };
}
