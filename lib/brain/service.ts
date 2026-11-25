import { brainDbPath, brainStats, cleanupOrphanedEmbeddings, getBrainDb, integrityCheck } from "./db";
import { absorbResearchFinding, saveAndExtractConversation } from "./extract";
import { modeStrategy, resolveAssistantMode, type ModeStrategy } from "./modes";
import { buildOfflinePrompt, retrieveBrainContext } from "./retrieve";
import { embedWithLocalModel, getLocalModelStatus, LOCAL_EMBEDDING_ID, runLocalCompletion } from "./local-llm";
import type { AssistantMode } from "../types";
import type { BrainConversation, BrainRetrievalItem, BrainStatus } from "./types";

export interface BrainSearchOptions {
  limit?: number;
  includeConversations?: boolean;
  includeDocuments?: boolean;
  includeCorrections?: boolean;
  useSemantic?: boolean;
  signal?: AbortSignal;
}

export interface BrainAnswerInput {
  question: string;
  conversationId?: string;
  history?: Array<{ role: string; content: string }>;
  mode?: AssistantMode;
  systemStyle?: string;
  strict?: boolean;
  useLocalModel?: boolean;
  useSemantic?: boolean;
  includeCorrections?: boolean;
  /** Reported only: this local path never performs web research. */
  allowWeb?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface BrainAnswerResult {
  answer: string;
  /** Resolved quick mode that produced the answer. */
  mode: AssistantMode;
  /** Answer outcome, kept separate from the quick mode. */
  answerMode: "local-llm" | "no-context" | "model-unavailable";
  /** Concrete retrieval and sampling values used for this answer. */
  strategy: ModeStrategy;
  usedLocalModel: boolean;
  usedSemantic: boolean;
  context: BrainRetrievalItem[];
  note: string;
  model?: string;
  elapsedMs?: number;
}

function numericSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// Status is polled from several components. A brief server-side coalesce keeps
// repeated mounts and tab switches from re-reading the whole database, while
// explicit `fresh` callers (dashboard/restore) bypass it after mutations.
const STATUS_TTL_MS = 1_500;
let statusCache: { at: number; value: BrainStatus } | null = null;

export function getBrainStatus(force = false): BrainStatus {
  const now = Date.now();
  if (!force && statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  const db = getBrainDb();
  const integrity = integrityCheck(db);
  cleanupOrphanedEmbeddings(db);
  const value: BrainStatus = {
    databasePath: brainDbPath(),
    ready: integrity === "ok",
    stats: brainStats(db, brainDbPath(), integrity),
    localModel: getLocalModelStatus(),
  };
  statusCache = { at: now, value };
  return value;
}

export async function searchBrain(question: string, options: BrainSearchOptions = {}): Promise<BrainRetrievalItem[]> {
  const db = getBrainDb();
  const modelStatus = getLocalModelStatus();
  const useSemantic = options.useSemantic !== false && modelStatus.embeddingReady;
  return retrieveBrainContext(db, question, {
    limit: options.limit ?? 8,
    includeConversations: options.includeConversations,
    includeDocuments: options.includeDocuments,
    includeCorrections: options.includeCorrections,
    embeddingModel: useSemantic ? LOCAL_EMBEDDING_ID : undefined,
    embedder: useSemantic ? embedWithLocalModel : undefined,
    signal: options.signal,
  });
}

export async function answerFromBrain(input: BrainAnswerInput): Promise<BrainAnswerResult> {
  const question = String(input.question ?? "").trim();
  if (!question) throw new Error("A question is required.");
  const status = getLocalModelStatus();
  const useSemantic = input.useSemantic !== false && status.embeddingReady;
  // This is the local Qwen path: there is no web client here, so research only
  // widens local retrieval and reports web permission instead of using it.
  const mode = resolveAssistantMode(question, input.mode, false, {
    strictOfflineMemory: input.strict !== false,
    webSearch: input.allowWeb === true,
  });
  const strategy = modeStrategy(mode);
  const strict = input.strict ?? strategy.strict;
  const includeCorrections = input.includeCorrections ?? strategy.includeCorrections;
  const systemStyle = input.systemStyle ?? strategy.style;
  const maxTokens = numericSetting(input.maxTokens, strategy.maxTokens, 32, 512);
  const temperature = numericSetting(input.temperature, strategy.temperature, 0, 1.5);
  const context = await retrieveBrainContext(getBrainDb(), question, {
    limit: strategy.retrievalLimit,
    includeCorrections,
    embeddingModel: useSemantic ? LOCAL_EMBEDDING_ID : undefined,
    embedder: useSemantic ? embedWithLocalModel : undefined,
    signal: input.signal,
  });

  if (strict && context.length === 0) {
    return {
      answer: "I do not have any relevant information saved in your local memory for that question. Nothing was invented, and no web research was performed.",
      mode,
      answerMode: "no-context",
      strategy,
      usedLocalModel: false,
      usedSemantic: useSemantic,
      context,
      note: "No relevant local context. No answer was invented.",
    };
  }

  if (input.useLocalModel === false || !status.modelReady) {
    const missing = !status.modelReady
      ? `The local Qwen model is not installed completely (${status.modelBytes} of ${1_117_320_736} bytes present).`
      : "The local language model is disabled in settings.";
    return {
      answer: `${missing} ${context.length ? "Relevant local information was found, but no local model generated an answer." : "No relevant local information was found."}`,
      mode,
      answerMode: "model-unavailable",
      strategy,
      usedLocalModel: false,
      usedSemantic: useSemantic,
      context,
      note: missing,
    };
  }

  const prompt = buildOfflinePrompt(question, context, input.history ?? [], systemStyle);
  const completion = await runLocalCompletion({
    prompt,
    maxTokens,
    temperature,
    signal: input.signal,
  });
  return {
    answer: completion.text || "The local model returned an empty answer; nothing was invented.",
    mode,
    answerMode: "local-llm",
    strategy,
    usedLocalModel: true,
    usedSemantic: useSemantic,
    context,
    note: `Answered locally from ${context.length} saved context item${context.length === 1 ? "" : "s"} using ${mode} mode.`,
    model: completion.model,
    elapsedMs: completion.elapsedMs,
  };
}

export function persistBrainConversation(conversation: BrainConversation) {
  return saveAndExtractConversation(getBrainDb(), conversation);
}

export function persistResearchFinding(finding: {
  title?: string;
  content: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceService?: string;
  retrievedAt?: string;
  publishedAt?: string;
  lastModified?: string;
  etag?: string;
  keywords?: string[];
}) {
  return absorbResearchFinding(getBrainDb(), finding);
}
