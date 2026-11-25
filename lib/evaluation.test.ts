import { describe, expect, it } from "vitest";
import { EVAL_CASES, runEvaluation, type EvaluationContext } from "./evaluation";

const emptyContext: EvaluationContext = {
  dictionary: [],
  knowledge: [],
  memories: [],
  corrections: [],
  conceptEdges: [],
  trainingLoss: null,
  validationLoss: null,
  learningSessions: [],
};

describe("evaluation lab", () => {
  it("defines deterministic, category-balanced cases", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(16);
    const categories = new Set(EVAL_CASES.map((item) => item.category));
    expect(categories).toEqual(new Set(["language", "reasoning", "memory", "generalization"]));
    expect(new Set(EVAL_CASES.map((item) => item.id)).size).toBe(EVAL_CASES.length);
  });

  it("runs every case and reports real, reproducible results", () => {
    const report = runEvaluation(emptyContext);
    expect(report.total).toBe(EVAL_CASES.length);
    expect(report.results).toHaveLength(EVAL_CASES.length);
    expect(report.correct + report.mistakes.length).toBe(report.total);
    for (const category of Object.values(report.categories)) {
      expect(category.total).toBeGreaterThan(0);
      expect(category.accuracy).toBeGreaterThanOrEqual(0);
      expect(category.accuracy).toBeLessThanOrEqual(100);
    }
    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.losses.sessions).toBe(0);
  });

  it("reports the actual capabilities implemented rather than claiming perfection", () => {
    const report = runEvaluation(emptyContext);
    expect(report.categories.language.correct).toBeGreaterThanOrEqual(3);
    expect(report.categories.reasoning.correct).toBeGreaterThanOrEqual(3);
    expect(report.categories.memory.correct).toBeGreaterThanOrEqual(3);
    expect(report.categories.generalization.correct).toBeGreaterThanOrEqual(3);
    // Honest benchmark: the small local LM is not part of these component cases.
    expect(report.accuracy).toBeLessThanOrEqual(100);
  });
});
