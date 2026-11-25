import { ASSISTANT_MODES, type AssistantMode } from "../types";

/** Settings that affect how an automatic mode is resolved. */
export interface ModeSettings {
  strictOfflineMemory?: boolean;
  webSearch?: boolean;
  researchMode?: boolean;
}

/** The explicit settings that may open web research. "auto" never does. */
export interface WebGateSettings extends ModeSettings {
  assistantMode?: AssistantMode;
}

/**
 * Web access is an explicit permission, independent of the answer style. A
 * mode strategy may prefer more pages, but it can never enable the network by
 * itself; only the Web Search toggle or an explicitly chosen Research mode
 * (and a device that is not known to be offline) may do that.
 */
export function isWebSearchEnabled(settings: WebGateSettings, online: boolean | null = true): boolean {
  if (online === false) return false;
  return settings.webSearch === true
    || settings.researchMode === true
    || settings.assistantMode === "research";
}

/** Concrete processing parameters chosen by a mode. */
export interface ModeStrategy {
  mode: AssistantMode;
  temperature: number;
  maxTokens: number;
  strict: boolean;
  allowWeb: boolean;
  webPages: number;
  retrievalLimit: number;
  includeCorrections: boolean;
  style: string;
  planning: boolean;
}

const CODE_PATTERN = /\b(code|coding|function|bug|debug|error|exception|typescript|javascript|python|react|nextjs|next\.js|api|sql|regex|compile|refactor|script|snippet|algorithm|implement|class|loop|program|command|npm|git)\b/i;
const RESEARCH_PATTERN = /\b(search|latest|newest|recent|news|currently|current|today|update|updates|release|version|happened|discover|find out|research|source|cite|according to|who won|status of)\b/i;
const CREATIVE_PATTERN = /\b(write|story|poem|poetry|song|creative|imagine|invent|brainstorm|draft|narrative|character|slogan|fiction|lyrics|roleplay)\b/i;
const LEARNING_PATTERN = /\b(explain|teach|learn|why|understand|tutorial|beginner|difference between|walk me through|how does|what is|guide me|steps to)\b/i;
const SPECULATIVE_PATTERN = /\b(what if|hypothesis|speculate|speculation|theorize|guess|experimental|alternate|alternatives|possible future|wild idea)\b/i;

/**
 * Pick the mode that will actually drive retrieval and sampling. A requested
 * explicit mode always wins; "auto" (or no request) is derived from the
 * question and the current environment. Research may be selected while
 * offline: its web permission is reported, but this module never fetches.
 */
export function resolveAssistantMode(
  question: string,
  requested: AssistantMode | undefined,
  online: boolean,
  settings: ModeSettings = {},
): AssistantMode {
  if (requested && requested !== "auto" && (ASSISTANT_MODES as readonly string[]).includes(requested)) {
    return requested;
  }

  const text = String(question ?? "");
  if (CODE_PATTERN.test(text)) return "coding";
  if (RESEARCH_PATTERN.test(text)) return "research";
  if (settings.strictOfflineMemory === false && SPECULATIVE_PATTERN.test(text)) return "sandbox";
  if (CREATIVE_PATTERN.test(text)) return "creative";
  if (LEARNING_PATTERN.test(text)) return "learning";
  if (settings.researchMode === true && online && settings.webSearch !== false) return "research";
  return "auto";
}

/**
 * Turn a mode into real processing values. Numeric settings stay inside the
 * existing llama.cpp clamps (temperature 0..1.5, maxTokens 32..512) and the
 * retrieval limit stays inside retrieveBrainContext's 1..20 clamp.
 */
export function modeStrategy(mode: AssistantMode): ModeStrategy {
  switch (mode) {
    case "thinking":
      return {
        mode,
        temperature: 0.15,
        maxTokens: 420,
        strict: true,
        allowWeb: false,
        webPages: 0,
        retrievalLimit: 14,
        includeCorrections: true,
        planning: true,
        style: "Start with a short step-by-step plan, then work through it carefully. Show brief reasoning at each step and flag any uncertainty explicitly.",
      };
    case "research":
      return {
        mode,
        temperature: 0.2,
        maxTokens: 360,
        strict: true,
        allowWeb: true,
        webPages: 4,
        retrievalLimit: 14,
        includeCorrections: true,
        planning: false,
        style: "Cite the numbered local sources for sourced claims and keep them separate from your own general knowledge. State clearly what comes from saved context and what does not. Never claim web research or web pages were used unless real web results were supplied to you.",
      };
    case "creative":
      return {
        mode,
        temperature: 0.9,
        maxTokens: 340,
        strict: false,
        allowWeb: false,
        webPages: 0,
        retrievalLimit: 6,
        includeCorrections: false,
        planning: false,
        style: "Offer original ideas and vivid phrasing. Label anything imagined or invented as imagination rather than fact, and keep using local context when it is available.",
      };
    case "coding":
      return {
        mode,
        temperature: 0.1,
        maxTokens: 420,
        strict: true,
        allowWeb: false,
        webPages: 0,
        retrievalLimit: 10,
        includeCorrections: true,
        planning: true,
        style: "Give working code in fenced blocks with precise language tags, then a short explanation. State assumptions, keep examples runnable, and describe the steps before the code.",
      };
    case "learning":
      return {
        mode,
        temperature: 0.45,
        maxTokens: 360,
        strict: true,
        allowWeb: false,
        webPages: 0,
        retrievalLimit: 10,
        includeCorrections: true,
        planning: false,
        style: "Teach the idea in plain language with one simple example, then ask one short question to check understanding. Distinguish local evidence from general explanation.",
      };
    case "sandbox":
      return {
        mode,
        temperature: 0.75,
        maxTokens: 380,
        strict: false,
        allowWeb: false,
        webPages: 0,
        retrievalLimit: 8,
        includeCorrections: false,
        planning: true,
        style: "Explore possibilities freely, starting with a short plan. Explicitly label every unverified claim as a hypothesis and keep hypotheses separate from saved local evidence.",
      };
    case "auto":
    default:
      return {
        mode: "auto",
        temperature: 0.25,
        maxTokens: 260,
        strict: true,
        allowWeb: false,
        webPages: 0,
        retrievalLimit: 8,
        includeCorrections: true,
        planning: false,
        style: "Give a concise, balanced answer. Prefer saved local context, separate it from general knowledge, and say briefly when information is missing.",
      };
  }
}
