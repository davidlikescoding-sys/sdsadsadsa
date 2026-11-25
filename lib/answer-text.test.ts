import { describe, expect, it } from "vitest";
import { polishAnswer } from "./answer-text";
import { qualifierModifiers, withoutModifierWords } from "./question-terms";

describe("answer sentence casing", () => {
  it("capitalizes and punctuates raw word-model output", () => {
    expect(polishAnswer("paris is the capital of france")).toBe("Paris is the capital of France.");
    expect(polishAnswer("the answer is 42")).toBe("The answer is 42.");
    expect(polishAnswer("i think davidai can help")).toBe("I think DavidAI can help.");
  });

  it("uses the user's own capitalization for proper nouns in the question", () => {
    expect(polishAnswer("the current canadian prime minister leads the government", "Who is the current Canadian prime minister?"))
      .toBe("The current Canadian prime minister leads the government.");
  });

  it("removes prompt fragments and fixes punctuation spacing", () => {
    expect(polishAnswer("DavidAI: it is ready .", "What is ready?")).toBe("It is ready.");
    expect(polishAnswer("a  b   c?")).toBe("A b c?");
  });

  it("strips stored memory labels and fixes definition capitals", () => {
    expect(polishAnswer("Vocabulary: Lion means A large wild cat that lives in Africa."))
      .toBe("Lion means a large wild cat that lives in Africa.");
    expect(polishAnswer("Vocabulary: Paris means The capital of France."))
      .toBe("Paris means the capital of France.");
  });

  it("capitalizes a lowercase dictionary headword in a definition answer", () => {
    expect(polishAnswer("current means a flow of electricity through a conductor", "What does current mean?"))
      .toBe("Current means a flow of electricity through a conductor.");
  });

  it("keeps existing capitalization and punctuation intact", () => {
    expect(polishAnswer("Hello! How can I help you today?")).toBe("Hello! How can I help you today?");
    expect(polishAnswer("The Prime Minister leads the federal government."))
      .toBe("The Prime Minister leads the federal government.");
  });
});

describe("question qualifier handling", () => {
  it("treats 'current' as a modifier only when it modifies another subject", () => {
    expect([...qualifierModifiers("what is the current Canadian prime minister")]).toContain("current");
    expect([...qualifierModifiers("what does current mean")]).not.toContain("current");
    expect([...qualifierModifiers("what is current")]).not.toContain("current");
  });

  it("drops modifier words from retrieval terms but keeps headwords", () => {
    expect(withoutModifierWords(["current", "canadian", "prime", "minister"], "what is the current Canadian prime minister"))
      .toEqual(["canadian", "prime", "minister"]);
    expect(withoutModifierWords(["current"], "what does current mean")).toEqual(["current"]);
  });
});
