import { describe, expect, it } from "vitest";
import {
  buildReasoningPlan, decomposeQuestion, detectContradictions, evaluateArithmetic,
  evaluateExpression, findCalculation, formatResult, solveLinearEquation, verifyAnswer,
} from "./reasoning";

describe("evaluateExpression", () => {
  it("uses a safe parser with correct precedence and grouping", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
    expect(evaluateExpression("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluateExpression("-3 + 5")).toBe(2);
    expect(evaluateExpression("10 / 4")).toBe(2.5);
  });

  it("rejects division by zero, malformed input and code injection", () => {
    expect(evaluateExpression("1 / 0")).toBeNull();
    expect(evaluateExpression("2 +")).toBeNull();
    expect(evaluateExpression("process.exit(1)")).toBeNull();
    expect(evaluateExpression("alert('x')")).toBeNull();
  });
});

describe("evaluateArithmetic", () => {
  it("handles informal wording and paraphrases as real calculations", () => {
    expect(evaluateArithmetic("What is 15% of 80?")?.value).toBe(12);
    expect(evaluateArithmetic("what is 20 percent of 90")?.value).toBe(18);
    expect(evaluateArithmetic("How much is 7 plus 5?")?.value).toBe(12);
    expect(evaluateArithmetic("12 times 3")?.value).toBe(36);
    expect(evaluateArithmetic("9 squared")?.value).toBe(81);
    expect(evaluateArithmetic("What is 6 x 7?")?.value).toBe(42);
  });

  it("understands the taught math vocabulary and symbols", () => {
    expect(evaluateArithmetic("8 plus 5")?.value).toBe(13);
    expect(evaluateArithmetic("9 minus 4")?.value).toBe(5);
    expect(evaluateArithmetic("6 multiplied by 7")?.value).toBe(42);
    expect(evaluateArithmetic("20 divided by 4")?.value).toBe(5);
    expect(evaluateArithmetic("5 + 3")?.value).toBe(8);
    expect(evaluateArithmetic("9 - 4")?.value).toBe(5);
    expect(evaluateArithmetic("multiply 6 by 7")?.value).toBe(42);
    expect(evaluateArithmetic("divide 20 by 4")?.value).toBe(5);
    expect(evaluateArithmetic("subtract 4 from 9")?.value).toBe(5);
  });

  it("returns null for non-arithmetic requests", () => {
    expect(evaluateArithmetic("What is Bayes theorem?")).toBeNull();
    expect(evaluateArithmetic("Explain photosynthesis")).toBeNull();
    expect(evaluateArithmetic("What does plus mean?")).toBeNull();
    expect(evaluateArithmetic("What is addition?")).toBeNull();
  });
});

describe("solveLinearEquation", () => {
  it("solves simple linear equations with real algebra", () => {
    expect(solveLinearEquation("2x + 3 = 11")?.value).toBe(4);
    expect(solveLinearEquation("3x - 6 = 0")?.value).toBe(2);
    expect(solveLinearEquation("x + 5 = 12")?.value).toBe(7);
    expect(solveLinearEquation("Solve for x: 4x = 20")?.value).toBe(5);
  });

  it("rejects equations it cannot solve", () => {
    expect(solveLinearEquation("2x + y = 5")).toBeNull();
    expect(solveLinearEquation("x = x + 1")).toBeNull();
  });

  it("findCalculation combines arithmetic and equations", () => {
    expect(findCalculation("What is 10% of 50?")?.value).toBe(5);
    expect(findCalculation("2x = 8")?.value).toBe(4);
  });
});

describe("decomposeQuestion", () => {
  it("splits compound requests into checkable subproblems", () => {
    const parts = decomposeQuestion("Compare A and B and explain why");
    expect(parts).toContain("Compare A");
    expect(parts).toContain("B");
    expect(parts).toContain("explain why");
  });

  it("keeps a single request intact", () => {
    expect(decomposeQuestion("What is a neuron?")).toEqual(["What is a neuron"]);
  });
});

describe("detectContradictions", () => {
  it("detects direct negation conflicts between local evidence", () => {
    const found = detectContradictions([
      { text: "The sky is blue today", source: "A" },
      { text: "The sky is not blue today", source: "B" },
    ]);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toContain("conflicts");
  });

  it("does not flag unrelated statements", () => {
    expect(detectContradictions([
      { text: "The sky is blue", source: "A" },
      { text: "Photosynthesis needs light", source: "B" },
    ])).toEqual([]);
  });
});

describe("buildReasoningPlan", () => {
  it("produces real steps for a calculation question", () => {
    const plan = buildReasoningPlan({
      question: "What is 15% of 80?",
      evidence: [{ text: "Percent means a fraction out of one hundred.", source: "Knowledge" }],
      intent: "question",
    });
    expect(plan.calculation?.value).toBe(12);
    expect(plan.steps.some((step) => step.kind === "calculate")).toBe(true);
    expect(plan.summary).toContain("15% of 80");
  });

  it("plans a calculation for the newly taught operation words", () => {
    const plan = buildReasoningPlan({
      question: "What is 6 multiplied by 7?",
      evidence: [{ text: "Multiplication is repeated addition.", source: "Knowledge" }],
      intent: "question",
    });
    expect(plan.calculation?.value).toBe(42);
    expect(plan.steps.some((step) => step.kind === "calculate")).toBe(true);
  });

  it("records contradictions found in evidence", () => {
    const plan = buildReasoningPlan({
      question: "Is the sky blue?",
      evidence: [
        { text: "The sky is blue today", source: "A" },
        { text: "The sky is not blue today", source: "B" },
      ],
    });
    expect(plan.contradictions.length).toBeGreaterThan(0);
  });
});

describe("verifyAnswer", () => {
  it("checks that a calculation result is actually present in the answer", () => {
    const ok = verifyAnswer({ question: "What is 15% of 80?", answer: "The result is 12.", evidence: [] });
    expect(ok.calculationMatches).toBe(true);
    expect(ok.reasons.some((r) => r.includes("local calculation"))).toBe(true);

    const bad = verifyAnswer({ question: "What is 15% of 80?", answer: "The result is 15.", evidence: [] });
    expect(bad.calculationMatches).toBe(false);
  });

  it("checks lexical support and question coverage", () => {
    const verified = verifyAnswer({
      question: "What is a neuron?",
      answer: "A neuron is a nerve cell.",
      evidence: ["A neuron is a nerve cell that transmits signals."],
    });
    expect(verified.support).toBeGreaterThan(0.5);
    expect(verified.ok).toBe(true);
  });

  it("rejects an empty answer", () => {
    expect(verifyAnswer({ question: "What is a neuron?", answer: "", evidence: [] }).ok).toBe(false);
  });
});

describe("formatResult", () => {
  it("produces stable decimal output", () => {
    expect(formatResult(2.5)).toBe("2.5");
    expect(formatResult(1e-12)).toBe("0");
  });
});
