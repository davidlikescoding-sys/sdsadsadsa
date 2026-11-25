import { describe, expect, it } from "vitest";
import { ASSISTANT_MODES, type AssistantMode } from "../types";
import { isWebSearchEnabled, modeStrategy, resolveAssistantMode } from "./modes";
import { buildOfflinePrompt } from "./retrieve";

describe("assistant mode strategies", () => {
  it("thinking lowers temperature, raises budget and breadth, and plans", () => {
    const auto = modeStrategy("auto");
    const thinking = modeStrategy("thinking");
    expect(thinking.planning).toBe(true);
    expect(thinking.strict).toBe(true);
    expect(thinking.temperature).toBeLessThan(auto.temperature);
    expect(thinking.maxTokens).toBeGreaterThan(auto.maxTokens);
    expect(thinking.retrievalLimit).toBeGreaterThan(auto.retrievalLimit);
    expect(thinking.style).toMatch(/plan/i);
  });

  it("research permits web use, widens retrieval and asks for separated citations", () => {
    const research = modeStrategy("research");
    expect(research.allowWeb).toBe(true);
    expect(research.webPages).toBeGreaterThanOrEqual(4);
    expect(research.retrievalLimit).toBeGreaterThanOrEqual(10);
    expect(research.strict).toBe(true);
    expect(research.style).toMatch(/cite/i);
    expect(research.style).toMatch(/separate/i);
  });

  it("creative relaxes strictness and invites labelled imagination", () => {
    const auto = modeStrategy("auto");
    const creative = modeStrategy("creative");
    expect(creative.temperature).toBeGreaterThan(auto.temperature);
    expect(creative.strict).toBe(false);
    expect(creative.allowWeb).toBe(false);
    expect(creative.style).toMatch(/imagin|invent/i);
  });

  it("coding uses precise, low-temperature, planned code output", () => {
    const coding = modeStrategy("coding");
    expect(coding.temperature).toBeLessThanOrEqual(0.2);
    expect(coding.planning).toBe(true);
    expect(coding.strict).toBe(true);
    expect(coding.style).toMatch(/fenced/i);
    expect(coding.style).toMatch(/language tag/i);
    expect(coding.style).toMatch(/short explanation/i);
  });

  it("learning asks for a teaching example and an understanding check", () => {
    const learning = modeStrategy("learning");
    expect(learning.temperature).toBeGreaterThan(0.2);
    expect(learning.temperature).toBeLessThan(modeStrategy("creative").temperature);
    expect(learning.style).toMatch(/teach/i);
    expect(learning.style).toMatch(/example/i);
    expect(learning.style).toMatch(/understanding/i);
  });

  it("sandbox allows hypotheses and requires them to be labelled", () => {
    const sandbox = modeStrategy("sandbox");
    expect(sandbox.strict).toBe(false);
    expect(sandbox.planning).toBe(true);
    expect(sandbox.style).toMatch(/unverified/i);
    expect(sandbox.style).toMatch(/hypothesis/i);
  });
});

describe("automatic mode routing", () => {
  it("routes code, research, learning and creative questions without a request", () => {
    expect(resolveAssistantMode("How do I debug this TypeScript function?", undefined, true, {})).toBe("coding");
    expect(resolveAssistantMode("What happened in the latest news?", undefined, false, {})).toBe("research");
    expect(resolveAssistantMode("Explain why the sky is blue", undefined, false, {})).toBe("learning");
    expect(resolveAssistantMode("Write a short poem about rain", undefined, false, {})).toBe("creative");
    expect(resolveAssistantMode("Hello there", undefined, false, {})).toBe("auto");
  });

  it("honours an explicit mode and ignores unrecognised values", () => {
    expect(resolveAssistantMode("Explain why the sky is blue", "coding", true, {})).toBe("coding");
    expect(resolveAssistantMode("Write a poem", "auto", false, {})).toBe("creative");
    expect(resolveAssistantMode("Write a poem", "bogus" as AssistantMode, false, {})).toBe("creative");
  });

  it("uses settings to bias research and sandbox only when appropriate", () => {
    expect(resolveAssistantMode("Hello there", "auto", true, { researchMode: true, webSearch: true })).toBe("research");
    expect(resolveAssistantMode("Hello there", "auto", false, { researchMode: true, webSearch: true })).toBe("auto");
    expect(resolveAssistantMode("What if we tried that?", "auto", false, { strictOfflineMemory: false })).toBe("sandbox");
    expect(resolveAssistantMode("What if we tried that?", "auto", false, { strictOfflineMemory: true })).toBe("auto");
  });

  it("never claims web research happened when research is resolved offline", () => {
    const mode = resolveAssistantMode("latest news", "research", false, { webSearch: false, researchMode: true });
    expect(mode).toBe("research");
    const strategy = modeStrategy(mode);
    expect(strategy.allowWeb).toBe(true);
    expect(strategy.strict).toBe(true);
    expect(strategy.style).toMatch(/never claim web research/i);
  });
});

describe("explicit web permission", () => {
  it("stays off for inferred research and every non-research mode unless the toggle is on", () => {
    expect(isWebSearchEnabled({ assistantMode: "auto", webSearch: false }, true)).toBe(false);
    expect(isWebSearchEnabled({ assistantMode: "learning", webSearch: false }, true)).toBe(false);
    expect(isWebSearchEnabled({ assistantMode: "coding", webSearch: false }, true)).toBe(false);
  });

  it("opens only for the Web Search toggle or an explicit Research mode", () => {
    expect(isWebSearchEnabled({ assistantMode: "learning", webSearch: true }, true)).toBe(true);
    expect(isWebSearchEnabled({ assistantMode: "research", webSearch: false }, true)).toBe(true);
  });

  it("never claims web access when the device is known to be offline", () => {
    expect(isWebSearchEnabled({ assistantMode: "research", webSearch: true }, false)).toBe(false);
  });
});

describe("mode and prompt safety bounds", () => {
  it("keeps every mode inside the existing sampling and retrieval clamps", () => {
    for (const mode of ASSISTANT_MODES) {
      const strategy = modeStrategy(mode);
      expect(strategy.mode).toBe(mode);
      expect(strategy.temperature).toBeGreaterThanOrEqual(0);
      expect(strategy.temperature).toBeLessThanOrEqual(1.5);
      expect(strategy.maxTokens).toBeGreaterThanOrEqual(32);
      expect(strategy.maxTokens).toBeLessThanOrEqual(512);
      expect(strategy.retrievalLimit).toBeGreaterThanOrEqual(1);
      expect(strategy.retrievalLimit).toBeLessThanOrEqual(20);
      expect(strategy.webPages).toBeGreaterThanOrEqual(0);
    }
  });

  it("appends a STYLE instruction before the question without breaking 2-arg calls", () => {
    const question = "Explain the mainspring";
    const plain = buildOfflinePrompt(question, [], []);
    const styled = buildOfflinePrompt(question, [], [], "Cite sources.");
    expect(plain).not.toContain("STYLE:");
    expect(styled).toContain("STYLE (trusted instruction): Cite sources.");
    expect(styled.indexOf("STYLE (trusted instruction):")).toBeLessThan(styled.indexOf(`QUESTION: ${question}`));
  });
});
