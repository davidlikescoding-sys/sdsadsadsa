"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Tokenizer } from "@/engine/tokenizer";
import { Transformer, DEFAULT_CONFIG, estimateParams, generate, scoreAnswer, validateConfig, type ModelConfig } from "@/engine/transformer";
import {
  buildTrainingData, countWindows, sessionFromSnapshot, TrainingSession,
} from "@/engine/session";
import { createSnapshot, snapshotSizeBytes, validateSnapshot, type ModelSnapshot } from "@/engine/serialization";
import type { GenerationOptions, GenerationResult } from "@/engine/transformer";
import {
  ASSISTANT_MODES, DEFAULT_SETTINGS, DEFAULT_TRAINING_STATE,
  type Activity, type AppSettings, type AssistantMode, type ChatMessage, type CheckpointMeta, type Conversation, type Dataset,
  type DatasetStats, type Experiment, type KnowledgeEntry, type TrainingState,
  type Correction, type Feedback, type FeedbackRating, type LearningSession, type Memory, type MemoryKind,
  type ModelVersion, type TrainingExample, type DictionaryWord, type DictionaryCategory, type SandboxExperiment,
  type ExperimentProposal, type LearningEdit,
} from "./types";
import { createConversation as makeConversation, titleFromMessage, type ChatTurn } from "./chat";
import {
  answerAddressesQuestion, buildLocalPrompt, conversationPairs, datasetAnswers, exampleFromCorrection,
  exportLearningData, exportTrainingData, findConversationAnswer, findDatasetAnswers, groundedCandidates,
  isReadableText, memoryHash, normalizeForHash, queryCoverage, rankRetrievalCandidates,
  retrieveLearningContext, trainingText, type LocalAnswerResult,
} from "./learning";
import { documentsFromStore, retrieveContext } from "./rag";
import { polishAnswer } from "./answer-text";
import {
  analyzeSentence, extractWords, loadBulkDictionary, missingGrammarLessons, normalizeWord,
  parseDictionaryImport, retrieveDictionary, retrieveGrammar, seedDictionary,
} from "./dictionary";
import { buildExperimentalResult, selectSandboxAlternatives } from "./experimental";
import {
  buildConceptGraph, edgesFromCorrection, mergeConceptEdges, type ConceptEdge,
} from "./concept-graph";
import { enrichUnderstanding, understandMessage } from "./language";
import {
  buildReasoningPlan, verifyAnswer, type AnswerVerification, type EvidenceItem,
} from "./reasoning";
import { buildWordCorpus, wordPrompt } from "./word-corpus";
import { TraceRecorder, type ActivityRun, type ReasoningSummary, type TraceStatus } from "./trace";
import { hashText, listLocalKeys, makeId, readLocal, removeLocal, writeLocal } from "./storage";

interface StoreValue {
  hydrated: boolean;
  datasets: Dataset[];
  checkpoints: CheckpointMeta[];
  experiments: Experiment[];
  knowledge: KnowledgeEntry[];
  dictionary: DictionaryWord[];
  sandboxExperiments: SandboxExperiment[];
  memories: Memory[];
  feedback: Feedback[];
  corrections: Correction[];
  trainingExamples: TrainingExample[];
  learningSessions: LearningSession[];
  modelVersions: ModelVersion[];
  activity: Activity[];
  traces: ActivityRun[];
  learningEdits: LearningEdit[];
  /** Feedback-learned concept associations, separate from model weights. */
  conceptEdges: ConceptEdge[];
  wordModelReady: boolean;
  wordVocabSize: number;
  wordParams: number;
  wordSteps: number;
  wordLoss: number | null;
  wordTraining: boolean;
  chatMessages: ChatMessage[];
  conversations: Conversation[];
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  activeConversationId: string | null;
  createConversation: () => string;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  togglePinConversation: (id: string) => void;
  moveConversationToFolder: (id: string, folderId: string | null) => void;
  setConversationArchived: (id: string, archived: boolean) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  updateMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  settings: AppSettings;
  config: ModelConfig;
  training: TrainingState;
  modelReady: boolean;
  selectedDatasetIds: string[];
  activeCheckpointId: string | null;
  setSelectedDatasetIds: (ids: string[]) => void;
  setConfigLocal: (config: ModelConfig) => void;
  addDataset: (name: string, description: string, content: string, category?: string) => Dataset;
  addFiles: (files: File[]) => Promise<Dataset[]>;
  updateDataset: (id: string, patch: Partial<Pick<Dataset, "name" | "description" | "content" | "category">>) => void;
  deleteDataset: (id: string) => void;
  findDuplicateDataset: (content: string, excludeId?: string) => Dataset | null;
  combineDatasets: (ids: string[], name: string) => Dataset;
  exportDatasets: (ids?: string[]) => string;
  importDatasets: (json: string) => Dataset[];
  initModel: (config?: ModelConfig, datasetIds?: string[]) => void;
  startTraining: (datasetIds?: string[], totalSteps?: number) => void;
  pauseTraining: () => void;
  resumeTraining: () => void;
  stopTraining: () => void;
  generateText: (prompt: string, opts: GenerationOptions) => Promise<GenerationResult>;
  generateAnswer: (text: string, conversationId: string, history: ChatTurn[], signal?: AbortSignal) => Promise<LocalAnswerResult>;
  addMemory: (input: { content: string; kind?: MemoryKind; conversationId?: string | null; source?: Memory["source"]; sourceMessageId?: string }) => Memory;
  updateMemory: (id: string, patch: Partial<Pick<Memory, "content" | "kind" | "conversationId">>) => void;
  deleteMemory: (id: string) => void;
  submitFeedback: (input: {
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    userMessage: string;
    assistantResponse: string;
    rating: FeedbackRating;
    explanation?: string;
    correction?: string;
  }) => Feedback;
  approveCorrection: (id: string) => void;
  rejectCorrection: (id: string) => void;
  deleteFeedback: (id: string) => void;
  startFeedbackTraining: (steps?: number) => void;
  exportLearning: () => string;
  exportTrainingDataset: () => string;
  clearLearning: () => void;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  clearChat: () => void;
  saveCheckpoint: (name: string, mode?: "char" | "word") => CheckpointMeta;
  loadCheckpoint: (id: string) => void;
  deleteCheckpoint: (id: string) => void;
  exportCheckpoint: (id: string) => string;
  importCheckpoint: (json: string) => CheckpointMeta;
  createExperiment: (name: string, description: string) => Experiment;
  updateExperiment: (id: string, patch: Partial<Experiment>) => void;
  deleteExperiment: (id: string) => void;
  addKnowledge: (entry: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">) => KnowledgeEntry;
  updateKnowledge: (id: string, patch: Partial<KnowledgeEntry>) => void;
  deleteKnowledge: (id: string) => void;
  knowledgeToDataset: (id: string) => Dataset;
  addDictionaryWord: (input: { word: string; definition: string; partOfSpeech: DictionaryCategory; example: string; related?: string[]; synonyms?: string[]; topics?: string[]; source?: string; reviewStatus?: "pending" | "approved" | "rejected" }) => DictionaryWord;
  updateDictionaryWord: (id: string, patch: Partial<Pick<DictionaryWord, "word" | "definition" | "partOfSpeech" | "example" | "related" | "synonyms" | "topics" | "source" | "reviewStatus">>) => void;
  deleteDictionaryWord: (id: string) => void;
  importDictionary: (json: string) => DictionaryWord[];
  reviewDictionaryWord: (id: string, status: "approved" | "rejected") => void;
  runSandboxExperiment: (input: {
    name: string; prompt: string; strategy: string; risk: "low" | "medium" | "high";
    experimental?: boolean; creativity?: number; proposal?: ExperimentProposal;
  }) => SandboxExperiment;
  decideSandboxExperiment: (id: string, decision: "approved" | "rejected") => void;
  deleteSandboxExperiment: (id: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  exportData: () => string;
  importData: (json: string) => void;
  resetApp: () => void;
  logActivity: (type: Activity["type"], message: string) => void;
  clearTraces: () => void;
  initWordModel: (force?: boolean) => { ok: boolean; message: string; vocabSize?: number };
  trainWordModel: (steps?: number) => Promise<{ ok: boolean; message: string }>;
  trainWordModelFromFeedback: (steps?: number) => Promise<{ ok: boolean; message: string }>;
  updateTrainingExample: (id: string, patch: { question?: string; answer?: string }, reason: string) => void;
  updateCorrection: (id: string, patch: { correctedAnswer?: string; explanation?: string }, reason: string) => void;
  getCombinedText: (ids: string[]) => string;
  datasetStats: (dataset: Dataset, contextLength: number) => DatasetStats;
  combinedStats: (ids: string[], contextLength: number) => DatasetStats;
}

const StoreContext = createContext<StoreValue | null>(null);
const MAX_DATASET_CHARS = 2_000_000;

function now(): string { return new Date().toISOString(); }

const FEEDBACK_NOTES: Record<FeedbackRating, { issue: string; improvement: string }> = {
  helpful: { issue: "None reported; the response was useful.", improvement: "Keep using the same local evidence for similar messages." },
  not_helpful: { issue: "The response did not help.", improvement: "Retrieve more relevant local evidence before answering." },
  incorrect: { issue: "The response contained a factual error.", improvement: "Prefer approved corrections and verified dictionary or dataset evidence." },
  incomplete: { issue: "The response missed part of the answer.", improvement: "Combine several retrieved sources instead of stopping at the first one." },
  gibberish: { issue: "The response was not understandable English.", improvement: "Use grounded candidates or admit uncertainty instead of raw token sampling." },
  too_complicated: { issue: "The response was harder to understand than needed.", improvement: "Answer with a shorter, clearer sentence from the retrieved evidence." },
  not_relevant: { issue: "The response did not address the question.", improvement: "Match the answer to the words and intent in the user's message." },
};
function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** One validator for settings, used both on hydration and on user edits. */
function normalizeSettings(next: AppSettings, fallback: AppSettings): AppSettings {
  const out: AppSettings = { ...next };
  out.theme = ["dark", "midnight", "light"].includes(out.theme) ? out.theme : fallback.theme;
  out.density = ["comfortable", "compact"].includes(out.density) ? out.density : fallback.density;
  out.learningRate = Math.max(0.00001, Math.min(1, finite(out.learningRate, fallback.learningRate)));
  if (out.lrSchedule !== "constant" && out.lrSchedule !== "cosine") out.lrSchedule = fallback.lrSchedule;
  out.dropout = Math.max(0, Math.min(0.9, finite(out.dropout, fallback.dropout)));
  out.weightDecay = Math.max(0, Math.min(1, finite(out.weightDecay, fallback.weightDecay)));
  out.batchSize = Math.max(1, Math.min(64, Math.floor(finite(out.batchSize, fallback.batchSize))));
  out.trainingSteps = Math.max(1, Math.min(100000, Math.floor(finite(out.trainingSteps, fallback.trainingSteps))));
  out.temperature = Math.max(0, Math.min(2, finite(out.temperature, fallback.temperature)));
  out.maxTokens = Math.max(1, Math.min(512, Math.floor(finite(out.maxTokens, fallback.maxTokens))));
  out.gradientClip = Math.max(0, Math.min(100, finite(out.gradientClip, fallback.gradientClip)));
  out.feedbackTrainingSteps = Math.max(1, Math.min(10000, Math.floor(finite(out.feedbackTrainingSteps, fallback.feedbackTrainingSteps))));
  out.topK = Math.max(0, Math.min(128, Math.floor(finite(out.topK, fallback.topK))));
  out.topP = Math.max(0, Math.min(1, finite(out.topP, fallback.topP)));
  out.repetitionPenalty = Math.max(1, Math.min(3, finite(out.repetitionPenalty, fallback.repetitionPenalty)));
  out.useKnowledge = typeof out.useKnowledge === "boolean" ? out.useKnowledge : fallback.useKnowledge;
  out.useMemory = typeof out.useMemory === "boolean" ? out.useMemory : fallback.useMemory;
  out.useCorrections = typeof out.useCorrections === "boolean" ? out.useCorrections : fallback.useCorrections;
  out.useGroundedAnswers = typeof out.useGroundedAnswers === "boolean" ? out.useGroundedAnswers : fallback.useGroundedAnswers;
  out.autoSave = typeof out.autoSave === "boolean" ? out.autoSave : fallback.autoSave;
  if (!["low", "medium", "high"].includes(out.sandboxRisk)) out.sandboxRisk = fallback.sandboxRisk;
  if (out.chatMode !== "experimental" && out.chatMode !== "grounded") out.chatMode = fallback.chatMode;
  out.sandboxExperimental = typeof out.sandboxExperimental === "boolean" ? out.sandboxExperimental : fallback.sandboxExperimental;
  out.sandboxCreativity = Math.max(0, Math.min(100, finite(out.sandboxCreativity, fallback.sandboxCreativity)));
  out.sandboxIntensity = Math.max(0, Math.min(100, finite(out.sandboxIntensity, fallback.sandboxIntensity)));
  out.answerEngine = out.answerEngine === "retrieval" ? "retrieval" : "generative";
  out.webSearch = typeof out.webSearch === "boolean" ? out.webSearch : fallback.webSearch;
  out.researchMode = typeof out.researchMode === "boolean" ? out.researchMode : fallback.researchMode;
  out.useLocalLlm = typeof out.useLocalLlm === "boolean" ? out.useLocalLlm : fallback.useLocalLlm;
  out.brainAutoSave = typeof out.brainAutoSave === "boolean" ? out.brainAutoSave : fallback.brainAutoSave;
  out.useSemanticRetrieval = typeof out.useSemanticRetrieval === "boolean" ? out.useSemanticRetrieval : fallback.useSemanticRetrieval;
  out.strictOfflineMemory = typeof out.strictOfflineMemory === "boolean" ? out.strictOfflineMemory : fallback.strictOfflineMemory;
  out.assistantMode = ASSISTANT_MODES.includes(out.assistantMode) ? out.assistantMode : fallback.assistantMode;
  return out;
}

/** Extract the dictionary definition from a natural-language correction. */
function definitionFromCorrection(answer: string): string {
  const match = answer.trim().match(/^([A-Za-z][\w'-]{1,30})\s+(?:means|is defined as|is)\s+(.{3,200}?)[.!]?$/i);
  return (match?.[2] ?? answer).replace(/\s+/g, " ").trim();
}

/** Stable 32-bit seed so identical configs and corpora initialize identically. */
function seedFrom(...parts: string[]): number {
  return Number.parseInt(hashText(parts.join("\u0000")), 16) || 1;
}

/** The small word model needs a higher learning rate than the character model. */
function wordLearningRate(base: number): number {
  return Math.min(0.05, Math.max(0.01, (Number.isFinite(base) && base > 0 ? base : 0.001) * 10));
}

/** Drop exact or whitespace/case-only duplicate documents before training so
 * repeated entries cannot dominate loss or leak between the two splits. */
function deduplicateTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    if (!text.trim()) continue;
    const key = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** Hold out real text for validation; never reuse the same windows for both splits. */
function splitValidation(texts: string[]): { train: string[]; validation: string[] } {
  const clean = texts.filter((text) => text.trim().length > 0);
  if (clean.length >= 2) return { train: clean.slice(0, -1), validation: [clean[clean.length - 1]] };
  if (clean.length === 1 && clean[0].length >= 300) {
    const cut = Math.floor(clean[0].length * 0.8);
    return { train: [clean[0].slice(0, cut)], validation: [clean[0].slice(cut)] };
  }
  return { train: clean, validation: [] };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [dictionary, setDictionary] = useState<DictionaryWord[]>([]);
  const [dictionaryTombstones, setDictionaryTombstones] = useState<string[]>([]);
  const [sandboxExperiments, setSandboxExperiments] = useState<SandboxExperiment[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [trainingExamples, setTrainingExamples] = useState<TrainingExample[]>([]);
  const [learningSessions, setLearningSessions] = useState<LearningSession[]>([]);
  const [modelVersions, setModelVersions] = useState<ModelVersion[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [traces, setTraces] = useState<ActivityRun[]>([]);
  const [learningEdits, setLearningEdits] = useState<LearningEdit[]>([]);
  const [conceptEdges, setConceptEdges] = useState<ConceptEdge[]>([]);
  const [wordModelReady, setWordModelReady] = useState(false);
  const [wordVocabSize, setWordVocabSize] = useState(0);
  const [wordParams, setWordParams] = useState(0);
  const [wordSteps, setWordSteps] = useState(0);
  const [wordLoss, setWordLoss] = useState<number | null>(null);
  const [wordTraining, setWordTraining] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [config, setConfig] = useState<ModelConfig>({ ...DEFAULT_CONFIG, vocabSize: 0 });
  const [training, setTraining] = useState<TrainingState>(DEFAULT_TRAINING_STATE);
  const [modelReady, setModelReady] = useState(false);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [activeCheckpointId, setActiveCheckpointId] = useState<string | null>(null);

  const sessionRef = useRef<TrainingSession | null>(null);
  const wordSessionRef = useRef<TrainingSession | null>(null);
  const wordTrainingRef = useRef(false);
  const runningRef = useRef(false);
  const loopRef = useRef(false);
  const trainingRef = useRef<TrainingState>(DEFAULT_TRAINING_STATE);
  const settingsRef = useRef(settings);
  const datasetsRef = useRef<Dataset[]>([]);
  const memoriesRef = useRef<Memory[]>([]);
  const feedbackRef = useRef<Feedback[]>([]);
  const correctionsRef = useRef<Correction[]>([]);
  const examplesRef = useRef<TrainingExample[]>([]);
  const learningSessionsRef = useRef<LearningSession[]>([]);
  const versionsRef = useRef<ModelVersion[]>([]);
  const knowledgeRef = useRef<KnowledgeEntry[]>([]);
  const dictionaryRef = useRef<DictionaryWord[]>([]);
  const sandboxExperimentsRef = useRef<SandboxExperiment[]>([]);
  const tracesRef = useRef<ActivityRun[]>([]);
  const learningEditsRef = useRef<LearningEdit[]>([]);
  const conceptEdgesRef = useRef<ConceptEdge[]>([]);
  const bulkLoadingRef = useRef(false);
  const pendingLearningRef = useRef<LearningSession | null>(null);
  const pendingFinalizeRef = useRef<((loss: number | null, validationLoss: number | null) => void) | null>(null);
  const accumulatedRef = useRef(0);
  const segmentStartRef = useRef(0);
  const stepTimesRef = useRef<number[]>([]);
  const runStartStepRef = useRef(0);
  const lastTrainingPersistRef = useRef(-1);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { datasetsRef.current = datasets; }, [datasets]);
  useEffect(() => { memoriesRef.current = memories; }, [memories]);
  useEffect(() => { feedbackRef.current = feedback; }, [feedback]);
  useEffect(() => { correctionsRef.current = corrections; }, [corrections]);
  useEffect(() => { examplesRef.current = trainingExamples; }, [trainingExamples]);
  useEffect(() => { learningSessionsRef.current = learningSessions; }, [learningSessions]);
  useEffect(() => { versionsRef.current = modelVersions; }, [modelVersions]);
  useEffect(() => { knowledgeRef.current = knowledge; }, [knowledge]);
  useEffect(() => { dictionaryRef.current = dictionary; }, [dictionary]);
  useEffect(() => { sandboxExperimentsRef.current = sandboxExperiments; }, [sandboxExperiments]);
  useEffect(() => { tracesRef.current = traces; }, [traces]);
  useEffect(() => { learningEditsRef.current = learningEdits; }, [learningEdits]);
  useEffect(() => { conceptEdgesRef.current = conceptEdges; }, [conceptEdges]);

  /** Rebuilt only when the underlying local data changes; no network access.
   *  Already-approved corrections are derived into edges here so older feedback
   *  contributes to retrieval too; new approvals also persist them explicitly. */
  const conceptGraph = useMemo(() => {
    const correctionEdges = corrections
      .filter((correction) => correction.status === "approved")
      .flatMap((correction) => edgesFromCorrection(correction));
    return buildConceptGraph({
      dictionary, knowledge,
      learned: mergeConceptEdges(conceptEdges, correctionEdges),
    });
  }, [dictionary, knowledge, conceptEdges, corrections]);

  // Words that appear in the user's own data are known words. The spelling
  // corrector must not rewrite them into a more common neighbour, otherwise a
  // valid subject such as "moose" silently becomes "mouse" before retrieval.
  const knownWords = useMemo(() => {
    const words = new Set<string>();
    for (const source of [...datasets.map((item) => item.content), ...knowledge.map((item) => item.content)]) {
      for (const match of source.toLowerCase().matchAll(/[a-z]+/g)) {
        if (match[0].length >= 4) words.add(match[0]);
      }
    }
    return words;
  }, [datasets, knowledge]);

  const chatMessages = activeConversationId
    ? conversations.find((c) => c.id === activeConversationId)?.messages ?? []
    : [];

  const setChatMessages = useCallback<React.Dispatch<React.SetStateAction<ChatMessage[]>>>((action) => {
    if (!activeConversationId) return;
    setConversations((prev) => prev.map((conversation) => {
      if (conversation.id !== activeConversationId) return conversation;
      const messages = typeof action === "function" ? action(conversation.messages) : action;
      const firstUser = messages.find((m) => m.role === "user");
      const title = conversation.title === "New conversation" && firstUser
        ? titleFromMessage(firstUser.content)
        : conversation.title;
      return { ...conversation, messages, title, updatedAt: new Date().toISOString() };
    }));
  }, [activeConversationId]);

  const patchTraining = useCallback((patch: Partial<TrainingState>) => {
    const next = { ...trainingRef.current, ...patch };
    trainingRef.current = next;
    setTraining(next);
  }, []);

  const logActivity = useCallback((type: Activity["type"], message: string) => {
    setActivity((prev) => [{ id: makeId(), type, message, timestamp: now() }, ...prev].slice(0, 80));
  }, []);

  const logTraining = useCallback((level: Activity["type"], message: string, step?: number) => {
    const next = {
      ...trainingRef.current,
      logs: [{ id: makeId(), timestamp: now(), level, message, step }, ...trainingRef.current.logs].slice(0, 80),
    };
    trainingRef.current = next;
    setTraining(next);
  }, []);

  const clearTraces = useCallback(() => {
    setTraces([]);
    tracesRef.current = [];
  }, []);

  const persistModel = useCallback(() => {
    const s = sessionRef.current;
    if (!s || !settingsRef.current.autoSave) return;
    const result = writeLocal("model", createSnapshot(s.model, s.tokenizer, s.step, s.optimizer));
    if (!result.ok) logActivity("warning", `Could not autosave model: ${result.error}`);
  }, [logActivity]);

  const prepareSessionData = useCallback((session: TrainingSession, ids: string[], extraTexts: string[] = []) => {
    const texts = [
      ...ids.map((id) => datasetsRef.current.find((d) => d.id === id)?.content ?? ""),
      ...extraTexts,
    ].filter((text) => text.length > 0);
    const uniqueTexts = deduplicateTexts(texts);
    if (!uniqueTexts.length) return { ok: false, reason: "Select at least one dataset before training." };
    try {
      const split = splitValidation(uniqueTexts);
      session.setData(buildTrainingData(split.train.length ? split.train : uniqueTexts, session.tokenizer, session.model.config.blockSize));
      try {
        session.setValidationData(split.validation.length
          ? buildTrainingData(split.validation, session.tokenizer, session.model.config.blockSize)
          : null);
      } catch {
        session.setValidationData(null);
      }
      return { ok: true, reason: "", samples: session.data?.samples ?? 0 };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  const accumulateElapsed = useCallback(() => {
    if (segmentStartRef.current) {
      accumulatedRef.current += Date.now() - segmentStartRef.current;
      segmentStartRef.current = 0;
    }
  }, []);

  /* ------------------------------ hydration ------------------------------ */
  useEffect(() => {
    try {
      const savedDatasets = readLocal<Dataset[]>("datasets", []);
      const savedSelected = readLocal<string[]>("selectedDatasets", []).filter((id) => savedDatasets.some((d) => d.id === id));
      const savedSettings = readLocal<Partial<AppSettings>>("settings", {});
      const merged: AppSettings = normalizeSettings({ ...DEFAULT_SETTINGS, ...savedSettings }, DEFAULT_SETTINGS);
      const savedConfig = readLocal<ModelConfig>("config", { ...DEFAULT_CONFIG, vocabSize: 0 });
      const savedTraining = readLocal<TrainingState>("training", DEFAULT_TRAINING_STATE);
      const savedActivity = readLocal<Activity[]>("activity", []);
      const savedChat = readLocal<ChatMessage[]>("chat", []);
      const savedConversations = readLocal<Conversation[]>("conversations", []);
      const savedActiveId = readLocal<string | null>("activeConversation", null);
  
      let restoredConversations: Conversation[] = [];
      if (Array.isArray(savedConversations) && savedConversations.length) {
        restoredConversations = savedConversations
          .filter((c) => c && typeof c.id === "string")
          .map((c) => ({
            ...c,
            title: typeof c.title === "string" ? c.title : "New conversation",
            messages: Array.isArray(c.messages) ? c.messages : [],
            createdAt: typeof c.createdAt === "string" ? c.createdAt : now(),
            updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : now(),
            pinned: c.pinned === true,
            folderId: typeof c.folderId === "string" && c.folderId ? c.folderId : null,
            archived: c.archived === true,
          }));
      }
      if (!restoredConversations.length && Array.isArray(savedChat) && savedChat.length) {
        const firstUser = savedChat.find((m) => m?.role === "user");
        const migrated = makeConversation(firstUser ? titleFromMessage(firstUser.content) : "New conversation");
        migrated.messages = savedChat;
        restoredConversations = [migrated];
      }
      if (!restoredConversations.length) restoredConversations = [makeConversation()];
      const activeId = restoredConversations.some((c) => c.id === savedActiveId)
        ? savedActiveId!
        : restoredConversations[0].id;
  
      setDatasets(savedDatasets);
      datasetsRef.current = savedDatasets;
      setSelectedDatasetIds(savedSelected);
      setCheckpoints(readLocal<CheckpointMeta[]>("checkpoints", []));
      setExperiments(readLocal<Experiment[]>("experiments", []));
  
      // Seed the dictionary and grammar knowledge only when they are missing, so
      // user edits survive reloads and a fresh install starts with real vocabulary.
      const savedDictionary = readLocal<DictionaryWord[]>("dictionary", [])
        .filter((word) => word && typeof word.id === "string" && typeof word.word === "string");
      const tombstones = readLocal<string[]>("dictionaryRemoved", []).filter((id): id is string => typeof id === "string");
      setDictionaryTombstones(tombstones);
      const seedStamp = now();
      const seededWords: DictionaryWord[] = seedDictionary(savedDictionary).map((seed) => ({
        id: makeId(), word: seed.word, definition: seed.definition, partOfSpeech: seed.partOfSpeech,
        example: seed.example, related: seed.related ?? [], synonyms: [], topics: ["everyday"],
        source: "user", reviewStatus: "approved", createdAt: seedStamp, updatedAt: seedStamp, useCount: 0,
      }));
      const base = [...seededWords, ...savedDictionary];
      setDictionary(base);
      dictionaryRef.current = base;
      // The 5,000-word dataset is bundled locally and loaded lazily. Only user
      // entries are written to localStorage, so the browser quota is not wasted.
      if (!bulkLoadingRef.current) {
        bulkLoadingRef.current = true;
        void loadBulkDictionary().then((bulk) => {
          const custom = dictionaryRef.current;
          const keys = new Set(custom.map((word) => `${normalizeWord(word.word)}|${word.partOfSpeech}`));
          const removed = new Set(readLocal<string[]>("dictionaryRemoved", []));
          const extra = bulk.filter((word) =>
            !keys.has(`${normalizeWord(word.word)}|${word.partOfSpeech}`) && !removed.has(word.id));
          const merged = [...custom, ...extra];
          dictionaryRef.current = merged;
          setDictionary(merged);
        }).catch(() => {
          setActivity((prev) => [{
            id: makeId(), type: "warning" as const,
            message: "The extended local dictionary could not be loaded; the starter dictionary is still available.",
            timestamp: now(),
          }, ...prev].slice(0, 80));
        })
          .finally(() => { bulkLoadingRef.current = false; });
      }
  
      const savedKnowledge = readLocal<KnowledgeEntry[]>("knowledge", [])
        .filter((entry) => entry && typeof entry.id === "string" && typeof entry.content === "string");
      const seededGrammar: KnowledgeEntry[] = missingGrammarLessons(savedKnowledge).map((lesson) => ({
        id: lesson.id, category: "Grammar", title: lesson.title, content: lesson.content,
        createdAt: seedStamp, updatedAt: seedStamp,
      }));
      setKnowledge([...seededGrammar, ...savedKnowledge]);
      knowledgeRef.current = [...seededGrammar, ...savedKnowledge];
      setSandboxExperiments(readLocal<SandboxExperiment[]>("sandboxExperiments", [])
        .filter((item) => item && typeof item.id === "string" && typeof item.prompt === "string"));
      setMemories(readLocal<Memory[]>("memories", []).filter((m) => m && typeof m.id === "string" && typeof m.content === "string"));
      setFeedback(readLocal<Feedback[]>("feedback", []).filter((f) => f && typeof f.id === "string"));
      setCorrections(readLocal<Correction[]>("corrections", []).filter((c) => c && typeof c.id === "string"));
      setTrainingExamples(readLocal<TrainingExample[]>("trainingExamples", []).filter((e) => e && typeof e.id === "string" && typeof e.text === "string"));
      setLearningSessions(readLocal<LearningSession[]>("learningSessions", [])
        .filter((s) => s && typeof s.id === "string")
        .map((s) => s.status === "running"
          ? { ...s, status: "error" as const, error: "Training was interrupted by a page reload.", finishedAt: s.finishedAt ?? now() }
          : s));
      setModelVersions(readLocal<ModelVersion[]>("modelVersions", []).filter((v) => v && typeof v.id === "string"));
      setActivity(savedActivity);
      const savedTraces = readLocal<ActivityRun[]>("activityTraces", [])
        .filter((run) => run && typeof run.id === "string" && Array.isArray(run.stages))
        .slice(0, 24);
      setTraces(savedTraces);
      tracesRef.current = savedTraces;
      const savedEdits = readLocal<LearningEdit[]>("learningEdits", [])
        .filter((edit) => edit && typeof edit.id === "string" && typeof edit.targetId === "string");
      setLearningEdits(savedEdits);
      learningEditsRef.current = savedEdits;
      const savedConceptEdges = readLocal<ConceptEdge[]>("conceptEdges", [])
        .filter((edge) => edge && typeof edge.from === "string" && typeof edge.to === "string" && typeof edge.relation === "string");
      setConceptEdges(savedConceptEdges);
      conceptEdgesRef.current = savedConceptEdges;
      setConversations(restoredConversations);
      setActiveConversationId(activeId);
      setSettings(merged);
      settingsRef.current = merged;
  
      let activeConfig = savedConfig;
      const snap = readLocal<ModelSnapshot | null>("model", null);
      let dataReady = false;
      if (snap) {
        try {
          const session = sessionFromSnapshot(snap, merged.learningRate);
          activeConfig = session.model.config;
          sessionRef.current = session;
          setModelReady(true);
          const prepared = prepareSessionData(session, savedSelected);
          dataReady = prepared.ok;
          patchTraining({
            ...DEFAULT_TRAINING_STATE,
            ...savedTraining,
            lossHistory: Array.isArray(savedTraining.lossHistory) ? savedTraining.lossHistory.slice(-1500) : [],
            validationHistory: Array.isArray(savedTraining.validationHistory) ? savedTraining.validationHistory.slice(-1500) : [],
            validationLoss: typeof savedTraining.validationLoss === "number" && Number.isFinite(savedTraining.validationLoss) ? savedTraining.validationLoss : null,
            logs: Array.isArray(savedTraining.logs) ? savedTraining.logs.slice(-80) : [],
            status: savedTraining.status === "running" || (savedTraining.status === "paused" && !dataReady) ? "paused" : savedTraining.status,
            error: prepared.ok ? null : prepared.reason,
            samples: prepared.samples ?? 0,
            etaMs: null,
          });
          if (!prepared.ok) {
            setActivity((prev) => [{ id: makeId(), type: "warning", message: `Training data was not restored: ${prepared.reason}`, timestamp: now() } as Activity, ...prev].slice(0, 80));
          }
        } catch (e) {
          removeLocal("model");
          setActivity((prev) => [{ id: makeId(), type: "error", message: `Saved model could not be loaded: ${e instanceof Error ? e.message : e}`, timestamp: now() } as Activity, ...prev].slice(0, 80));
        }
      }
      setConfig(activeConfig);
      const wordSnap = readLocal<ModelSnapshot | null>("wordModel", null);
      if (wordSnap) {
        try {
          const wordSession = sessionFromSnapshot(wordSnap, wordLearningRate(merged.learningRate));
          wordSessionRef.current = wordSession;
          setWordModelReady(true);
          setWordVocabSize(wordSession.tokenizer.size);
          setWordParams(estimateParams(wordSession.model.config));
          setWordSteps(wordSession.step);
          const restoredLoss = readLocal<number | null>("wordModelLoss", null);
          setWordLoss(restoredLoss ?? (wordSession.lossHistory.length ? wordSession.lossHistory[wordSession.lossHistory.length - 1].loss : null));
        } catch {
          removeLocal("wordModel");
        }
      }
      setHydrated(true);
    } catch (error) {
      console.error("DavidAI hydration failed", error);
      setActivity((prev) => [{
        id: makeId(), type: "error" as const,
        message: "Local data could not be loaded. Check the browser console before adding new data.",
        timestamp: now(),
      }, ...prev].slice(0, 80));
      setHydrated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (hydrated) writeLocal("datasets", datasets); }, [datasets, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("checkpoints", checkpoints); }, [checkpoints, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("experiments", experiments); }, [experiments, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("knowledge", knowledge); }, [knowledge, hydrated]);
  useEffect(() => {
    if (hydrated) writeLocal("dictionary", dictionary.filter((word) => word.source !== "bundled"));
  }, [dictionary, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("dictionaryRemoved", dictionaryTombstones); }, [dictionaryTombstones, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("sandboxExperiments", sandboxExperiments); }, [sandboxExperiments, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("memories", memories); }, [memories, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("feedback", feedback); }, [feedback, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("corrections", corrections); }, [corrections, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("trainingExamples", trainingExamples); }, [trainingExamples, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("learningSessions", learningSessions); }, [learningSessions, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("modelVersions", modelVersions); }, [modelVersions, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("activity", activity); }, [activity, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("activityTraces", traces.slice(0, 24)); }, [traces, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("learningEdits", learningEdits); }, [learningEdits, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("conceptEdges", conceptEdges); }, [conceptEdges, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("conversations", conversations); }, [conversations, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("activeConversation", activeConversationId); }, [activeConversationId, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("chat", chatMessages); }, [chatMessages, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("settings", settings); }, [settings, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("config", config); }, [config, hydrated]);
  useEffect(() => { if (hydrated) writeLocal("selectedDatasets", selectedDatasetIds); }, [selectedDatasetIds, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const terminal = training.status !== "running";
    if (!terminal && training.step - lastTrainingPersistRef.current < 10) return;
    const result = writeLocal("training", training);
    if (!result.ok) logActivity("warning", `Could not save training state: ${result.error}`);
    lastTrainingPersistRef.current = training.step;
  }, [training, hydrated, logActivity]);

  /* ------------------------------ datasets ------------------------------ */
  const getCombinedText = useCallback((ids: string[]) => {
    const set = new Set(ids);
    return datasetsRef.current.filter((d) => set.has(d.id)).map((d) => d.content).join("\n\n");
  }, []);

  const datasetStats = useCallback((dataset: Dataset, contextLength: number): DatasetStats => {
    const chars = Array.from(dataset.content).length;
    return { chars, tokens: chars, windows: countWindows(chars + 1, contextLength) };
  }, []);

  const combinedStats = useCallback((ids: string[], contextLength: number): DatasetStats => {
    const selected = datasetsRef.current.filter((d) => ids.includes(d.id) && d.content.length > 0);
    const chars = selected.reduce((n, d) => n + Array.from(d.content).length, 0);
    return { chars, tokens: chars, windows: countWindows(chars + selected.length, contextLength) };
  }, []);

  const findDuplicateDataset = useCallback((content: string, excludeId?: string) => {
    const hash = hashText(content);
    return datasetsRef.current.find((d) => d.id !== excludeId && d.hash === hash) ?? null;
  }, []);

  const addDataset = useCallback((name: string, description: string, content: string, category = "General") => {
    if (!content.trim()) throw new Error("Dataset content cannot be empty.");
    if (content.length > MAX_DATASET_CHARS) throw new Error("Dataset is too large for browser storage (2 million character limit).");
    const duplicate = findDuplicateDataset(content);
    if (duplicate) throw new Error(`This content already exists as "${duplicate.name}".`);
    const hash = hashText(content);
    const d: Dataset = {
      id: makeId(), name: name.trim() || "Untitled dataset", description: description.trim(),
      content, category: category.trim() || "General", hash, createdAt: now(), updatedAt: now(),
    };
    const next = [d, ...datasetsRef.current];
    datasetsRef.current = next;
    setDatasets(next);
    setSelectedDatasetIds((prev) => [...prev, d.id]);
    logActivity("success", `Dataset "${d.name}" created (${content.length.toLocaleString()} characters).`);
    return d;
  }, [findDuplicateDataset, logActivity]);

  const addFiles = useCallback(async (files: File[]) => {
    const created: Dataset[] = [];
    for (const file of files) {
      try {
        const content = await file.text();
        created.push(addDataset(file.name.replace(/\.[^.]+$/, "") || file.name, `Uploaded from ${file.name}`, content, "Imported"));
      } catch (e) {
        logActivity("warning", `Could not import ${file.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return created;
  }, [addDataset, logActivity]);

  const updateDataset = useCallback((id: string, patch: Partial<Pick<Dataset, "name" | "description" | "content" | "category">>) => {
    const target = datasetsRef.current.find((d) => d.id === id);
    if (!target) return;
    if (patch.content !== undefined && !patch.content.trim()) throw new Error("Dataset content cannot be empty.");
    if (patch.content && patch.content.length > MAX_DATASET_CHARS) throw new Error("Dataset is too large for browser storage (2 million character limit).");
    const next = datasetsRef.current.map((d) => d.id === id
      ? { ...d, ...patch, hash: patch.content !== undefined ? hashText(patch.content) : d.hash, updatedAt: now() }
      : d);
    datasetsRef.current = next;
    setDatasets(next);
    logActivity("info", `Dataset "${target.name}" updated.`);
  }, [logActivity]);

  const deleteDataset = useCallback((id: string) => {
    const target = datasetsRef.current.find((d) => d.id === id);
    const next = datasetsRef.current.filter((d) => d.id !== id);
    datasetsRef.current = next;
    setDatasets(next);
    setSelectedDatasetIds((prev) => prev.filter((x) => x !== id));
    logActivity("warning", `Dataset "${target?.name ?? id}" deleted.`);
  }, [logActivity]);

  const combineDatasets = useCallback((ids: string[], name: string) => {
    const selected = datasetsRef.current.filter((d) => ids.includes(d.id));
    if (selected.length < 2) throw new Error("Select at least two datasets to combine.");
    return addDataset(name.trim() || `Combined corpus ${new Date().toLocaleDateString()}`, `Combines ${selected.length} datasets`, selected.map((d) => d.content).join("\n\n"), "Combined");
  }, [addDataset]);

  const exportDatasets = useCallback((ids?: string[]) => {
    const selected = ids ? datasetsRef.current.filter((d) => ids.includes(d.id)) : datasetsRef.current;
    return JSON.stringify({ app: "DavidAI-datasets", version: 1, exportedAt: now(), datasets: selected }, null, 2);
  }, []);

  const importDatasets = useCallback((json: string) => {
    const parsed = JSON.parse(json) as { app?: string; datasets?: unknown };
    if (parsed.app !== "DavidAI-datasets" || !Array.isArray(parsed.datasets)) throw new Error("This is not a DavidAI dataset export.");
    const created: Dataset[] = [];
    for (const raw of parsed.datasets) {
      if (!raw || typeof raw !== "object") continue;
      const d = raw as Partial<Dataset>;
      if (typeof d.content !== "string") continue;
      try { created.push(addDataset(String(d.name ?? "Imported dataset"), String(d.description ?? ""), d.content, String(d.category ?? "Imported"))); }
      catch (e) { logActivity("warning", `Dataset import skipped: ${e instanceof Error ? e.message : e}`); }
    }
    if (!created.length) throw new Error("No new datasets were imported.");
    return created;
  }, [addDataset, logActivity]);

  /* --------------------------- model & training --------------------------- */
  const setConfigLocal = useCallback((next: ModelConfig) => setConfig(next), []);

  const initModel = useCallback((override?: ModelConfig, datasetIds?: string[]) => {
    if (runningRef.current || trainingRef.current.status === "running" || trainingRef.current.status === "paused") {
      throw new Error("Stop or complete the current training run before initializing a new model.");
    }
    runningRef.current = false;
    const ids = datasetIds ?? selectedDatasetIds;
    const texts = ids.map((id) => datasetsRef.current.find((d) => d.id === id)?.content ?? "").filter(Boolean);
    if (!texts.length) throw new Error("Select at least one dataset first.");
    const tokenizer = Tokenizer.build(texts);
    const base = override ?? config;
    const cfg: ModelConfig = { ...base, vocabSize: tokenizer.size, dropout: settingsRef.current.dropout };
    const err = validateConfig(cfg);
    if (err) throw new Error(err);
    const seed = seedFrom(JSON.stringify(cfg), ...texts);
    const model = new Transformer(cfg, seed);
    const session = new TrainingSession(model, tokenizer, settingsRef.current.learningRate, seed ^ 0x9e3779b9);
    session.setWeightDecay(settingsRef.current.weightDecay);
    const prepared = prepareSessionData(session, ids);
    if (!prepared.ok) throw new Error(prepared.reason);
    sessionRef.current = session;
    setConfig(cfg);
    setModelReady(true);
    setActiveCheckpointId(null);
    accumulatedRef.current = 0;
    stepTimesRef.current = [];
    patchTraining({ ...DEFAULT_TRAINING_STATE, totalSteps: settingsRef.current.trainingSteps, samples: prepared.samples ?? 0 });
    logTraining("success", `Model initialized: ${cfg.layers}L/${cfg.heads}H/${cfg.dModel}d, ${tokenizer.size} tokens.`);
    persistModel();
    logActivity("success", `Model initialized: ${cfg.layers} layer(s), ${cfg.dModel} dims, ${tokenizer.size} tokens.`);
  }, [config, selectedDatasetIds, logActivity, logTraining, patchTraining, persistModel, prepareSessionData]);

  const runLoop = useCallback(async () => {
    if (loopRef.current) return;
    loopRef.current = true;
    if (!segmentStartRef.current) segmentStartRef.current = Date.now();
    try {
      while (runningRef.current) {
        const s = sessionRef.current;
        const st = trainingRef.current;
        if (!s) {
          runningRef.current = false;
          patchTraining({ status: "error", error: "No model is loaded." });
          break;
        }
        if (st.step >= st.totalSteps) {
          runningRef.current = false;
          accumulateElapsed();
          const avg = stepTimesRef.current.length
            ? stepTimesRef.current.reduce((a, b) => a + b, 0) / stepTimesRef.current.length : 0;
          let finalValidation: number | null = null;
          try { finalValidation = s.validationLoss(settingsRef.current.batchSize); } catch { /* reported by validation history */ }
          patchTraining({
            status: "complete", elapsedMs: accumulatedRef.current, etaMs: 0,
            stepsPerSecond: avg > 0 ? 1000 / avg : null, validationLoss: finalValidation,
          });
          logTraining("success", `Training complete after ${st.step} steps. Final loss ${st.loss?.toFixed(4)}.`, st.step);
          persistModel();
          logActivity("success", `Training completed after ${st.step} steps. Final loss ${st.loss?.toFixed(4)}.`);
          pendingFinalizeRef.current?.(st.loss, finalValidation);
          break;
        }

        const stepStarted = Date.now();
        try {
          s.setLearningRate(settingsRef.current.learningRate);
          s.setWeightDecay(settingsRef.current.weightDecay);
          const loss = s.trainBatch(settingsRef.current.batchSize, settingsRef.current.gradientClip);
          const step = s.step;
          stepTimesRef.current = [...stepTimesRef.current.slice(-11), Date.now() - stepStarted];
          const avg = stepTimesRef.current.reduce((a, b) => a + b, 0) / stepTimesRef.current.length;
          const remaining = Math.max(0, st.totalSteps - step);
          const batchSize = s.lastBatchSize;
          const epoch = st.samples > 0 ? ((step - runStartStepRef.current) * batchSize) / st.samples : 0;
          let validationLoss = st.validationLoss;
          let validationHistory = st.validationHistory;
          if (step % 5 === 0) {
            try {
              const measured = s.validationLoss(settingsRef.current.batchSize);
              if (measured !== null && Number.isFinite(measured)) {
                validationLoss = measured;
                validationHistory = [...validationHistory, { step, loss: measured }].slice(-1500);
              }
            } catch { /* a failed validation measurement must not stop real training */ }
          }
          patchTraining({
            step,
            loss,
            lossHistory: [...st.lossHistory, { step, loss }].slice(-1500),
            validationLoss,
            validationHistory,
            tokensSeen: st.tokensSeen + batchSize * s.model.config.blockSize,
            elapsedMs: accumulatedRef.current + (Date.now() - segmentStartRef.current),
            learningRate: s.optimizer.learningRate,
            batchSize,
            gradNorm: s.lastGradNorm,
            epoch,
            stepsPerSecond: stepTimesRef.current.length >= 3 ? 1000 / avg : null,
            etaMs: stepTimesRef.current.length >= 3 && remaining > 0 ? avg * remaining : null,
            status: "running",
          });
          if (step % 25 === 0) logTraining("info", `step ${step} · loss ${loss.toFixed(4)} · grad ${s.lastGradNorm.toFixed(3)}`, step);
          if (step % 20 === 0) persistModel();
          if (step % 2 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        } catch (e) {
          runningRef.current = false;
          accumulateElapsed();
          const message = e instanceof Error ? e.message : String(e);
          patchTraining({ status: "error", error: message, elapsedMs: accumulatedRef.current });
          setLearningSessions((prev) => prev.map((session) => session.status === "running"
            ? { ...session, status: "error", error: message, finishedAt: now() }
            : session));
          pendingFinalizeRef.current = null;
          pendingLearningRef.current = null;
          logTraining("error", `Training failed: ${message}`);
          logActivity("error", `Training failed: ${message}`);
          break;
        }
      }
    } finally {
      loopRef.current = false;
    }
  }, [accumulateElapsed, logActivity, logTraining, patchTraining, persistModel]);

  const startTraining = useCallback((datasetIds?: string[], totalSteps?: number) => {
    if (runningRef.current || trainingRef.current.status === "running") return;
    let s = sessionRef.current;
    const ids = datasetIds ?? selectedDatasetIds;
    if (!s) {
      const texts = ids.map((id) => datasetsRef.current.find((d) => d.id === id)?.content ?? "").filter(Boolean);
      if (!texts.length) throw new Error("Select at least one dataset before training.");
      const tokenizer = Tokenizer.build(texts);
      const cfg = { ...config, vocabSize: tokenizer.size, dropout: settingsRef.current.dropout };
      const err = validateConfig(cfg);
      if (err) throw new Error(err);
      s = new TrainingSession(new Transformer(cfg, Math.floor(Math.random() * 2 ** 31)), tokenizer, settingsRef.current.learningRate, Date.now() & 0xffffffff);
      sessionRef.current = s;
      setConfig(cfg);
      setModelReady(true);
    }
    const prepared = prepareSessionData(s, ids);
    if (!prepared.ok) throw new Error(prepared.reason);
    s.setLearningRate(settingsRef.current.learningRate);
    s.setWeightDecay(settingsRef.current.weightDecay);
    accumulateElapsed();
    accumulatedRef.current = 0;
    segmentStartRef.current = Date.now();
    stepTimesRef.current = [];
    runStartStepRef.current = s.step;
    const steps = Math.max(1, Math.floor(finite(totalSteps, settingsRef.current.trainingSteps)));
    const startStep = s.step;
    s.configureSchedule(settingsRef.current.lrSchedule === "cosine" ? {
      type: "cosine",
      warmupSteps: Math.min(20, Math.max(1, Math.floor(steps * 0.05))),
      totalSteps: startStep + steps,
      minLrRatio: 0.1,
    } : null);
    const logs = [{
      id: makeId(), timestamp: now(), level: "info" as const,
      message: `Training started: ${steps} steps on ${prepared.samples} windows.`, step: startStep,
    }];
    patchTraining({
      ...DEFAULT_TRAINING_STATE,
      status: "running", step: startStep, totalSteps: startStep + steps, error: null,
      samples: prepared.samples ?? 0, logs,
      batchSize: settingsRef.current.batchSize, learningRate: s.optimizer.learningRate,
    });
    runningRef.current = true;
    logActivity("info", `Training started: ${steps} steps on ${ids.length} dataset(s).`);
    void runLoop();
  }, [accumulateElapsed, config, logActivity, patchTraining, prepareSessionData, runLoop, selectedDatasetIds]);

  const pauseTraining = useCallback(() => {
    runningRef.current = false;
    accumulateElapsed();
    patchTraining({ status: "paused", elapsedMs: accumulatedRef.current, etaMs: null });
    logTraining("warning", "Training paused. Current weights saved.");
    persistModel();
  }, [accumulateElapsed, logTraining, patchTraining, persistModel]);

  const resumeTraining = useCallback(() => {
    const s = sessionRef.current;
    if (!s) throw new Error("No model is loaded.");
    if (!s.data) {
      const prepared = prepareSessionData(s, selectedDatasetIds);
      if (!prepared.ok) throw new Error(prepared.reason);
      patchTraining({ samples: prepared.samples ?? 0 });
    }
    if (!segmentStartRef.current) segmentStartRef.current = Date.now();
    stepTimesRef.current = [];
    runStartStepRef.current = s.step;
    const remaining = Math.max(1, trainingRef.current.totalSteps - s.step);
    s.configureSchedule(settingsRef.current.lrSchedule === "cosine" ? {
      type: "cosine",
      warmupSteps: Math.min(20, Math.max(1, Math.floor(remaining * 0.05))),
      totalSteps: trainingRef.current.totalSteps,
      minLrRatio: 0.1,
    } : null);
    runningRef.current = true;
    patchTraining({ status: "running", error: null });
    logTraining("info", "Training resumed.");
    void runLoop();
  }, [logTraining, patchTraining, prepareSessionData, runLoop, selectedDatasetIds]);

  const stopTraining = useCallback(() => {
    runningRef.current = false;
    accumulateElapsed();
    patchTraining({ status: "stopped", elapsedMs: accumulatedRef.current, etaMs: null });
    setLearningSessions((prev) => prev.map((session) => session.status === "running"
      ? { ...session, status: "error", error: "Stopped before completion.", finishedAt: now() }
      : session));
    pendingFinalizeRef.current = null;
    pendingLearningRef.current = null;
    logTraining("warning", "Training stopped. Current weights saved.");
    persistModel();
  }, [accumulateElapsed, logTraining, patchTraining, persistModel]);

  const generateText = useCallback(async (prompt: string, opts: GenerationOptions) => {
    const s = sessionRef.current;
    if (!s) throw new Error("No model is loaded. Initialize or load a checkpoint first.");
    return s.generateAsync(prompt, opts);
  }, []);

  const initWordModel = useCallback((force = false): { ok: boolean; message: string; vocabSize?: number } => {
    if (wordSessionRef.current && !force) return { ok: true, message: "Word-level language model is already initialized.", vocabSize: wordSessionRef.current.tokenizer.size };
    const corpus = buildWordCorpus({
      datasets: datasetsRef.current,
      knowledge: knowledgeRef.current,
      dictionary: dictionaryRef.current,
      memories: memoriesRef.current,
      corrections: correctionsRef.current,
    });
    if (corpus.examples < 1) return { ok: false, message: "No local text is available to learn from. Add a dataset, dictionary words or knowledge first." };
    try {
      const model = new Transformer({ ...corpus.config, dropout: settingsRef.current.dropout }, seedFrom(
        "wordlm", String(corpus.examples), String(corpus.words), corpus.texts.slice(0, 32).join("\n"),
      ));
      const session = new TrainingSession(model, corpus.tokenizer, wordLearningRate(settingsRef.current.learningRate), seedFrom("wordtrain"));
      session.setWeightDecay(settingsRef.current.weightDecay);
      session.setData(buildTrainingData(corpus.texts, corpus.tokenizer, corpus.config.blockSize));
      wordSessionRef.current = session;
      setWordModelReady(true);
      setWordVocabSize(corpus.tokenizer.size);
      setWordParams(estimateParams(corpus.config));
      setWordSteps(0);
      setWordLoss(null);
      writeLocal("wordModelLoss", null);
      logActivity("success", `Initialized word-level language model: ${corpus.examples} training examples, ${corpus.tokenizer.size} words.`);
      return { ok: true, message: `Initialized with ${corpus.examples} examples and ${corpus.tokenizer.size} words.`, vocabSize: corpus.tokenizer.size };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [logActivity]);

  const trainWordModel = useCallback(async (steps = 300): Promise<{ ok: boolean; message: string }> => {
    if (wordTrainingRef.current) return { ok: false, message: "Word-level training is already running." };
    if (!wordSessionRef.current) {
      const initialized = initWordModel();
      if (!initialized.ok) return initialized;
    }
    const session = wordSessionRef.current!;
    wordTrainingRef.current = true;
    setWordTraining(true);
    const total = Math.max(1, Math.min(2000, Math.floor(steps)));
    const targetStep = session.step + total;
    session.configureSchedule(settingsRef.current.lrSchedule === "cosine" ? {
      type: "cosine",
      warmupSteps: Math.min(20, Math.max(1, Math.floor(total * 0.05))),
      totalSteps: targetStep,
      minLrRatio: 0.1,
    } : null);
    try {
      for (let i = 0; i < total; i++) {
        const loss = session.trainBatch(Math.max(1, Math.round(settingsRef.current.batchSize)), settingsRef.current.gradientClip);
        if (i % 8 === 7) {
          setWordSteps(session.step);
          setWordLoss(loss);
          writeLocal("wordModelLoss", loss);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      const loss = session.lossHistory.length ? session.lossHistory[session.lossHistory.length - 1].loss : null;
      const saved = writeLocal("wordModel", createSnapshot(session.model, session.tokenizer, session.step, session.optimizer));
      setWordSteps(session.step);
      setWordLoss(loss);
      writeLocal("wordModelLoss", loss);
      if (!saved.ok) logActivity("warning", `Word model trained but could not be saved: ${saved.error}`);
      else logActivity("success", `Trained word-level language model for ${total} steps. Final loss ${loss === null ? "n/a" : loss.toFixed(4)}.`);
      return { ok: true, message: `Completed ${total} real training steps. Final loss: ${loss === null ? "n/a" : loss.toFixed(4)}.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    } finally {
      wordTrainingRef.current = false;
      setWordTraining(false);
    }
  }, [initWordModel, logActivity]);

  /**
   * Rebuild the generative word model from the current corpus, which already
   * includes approved corrections, then train it for real. This is an explicit
   * action: approving feedback alone never changes neural weights. The character
   * model, its checkpoints and the tokenizer format are left untouched.
   */
  const trainWordModelFromFeedback = useCallback(async (steps?: number): Promise<{ ok: boolean; message: string }> => {
    if (wordTrainingRef.current) return { ok: false, message: "Word-level training is already running." };
    const approved = correctionsRef.current.filter((correction) => correction.status === "approved");
    if (!approved.length) return { ok: false, message: "Approve at least one correction before word-model feedback training." };
    const initialized = initWordModel(true);
    if (!initialized.ok) return initialized;
    const count = Math.max(1, Math.min(2000, Math.floor(steps ?? settingsRef.current.feedbackTrainingSteps)));
    const trained = await trainWordModel(count);
    if (trained.ok) {
      logActivity("success", `Word model rebuilt and trained from ${approved.length} approved correction(s) plus the current local corpus. This replaced the previous word-model checkpoint; character-model checkpoints were not touched.`);
    }
    return trained;
  }, [initWordModel, trainWordModel, logActivity]);

  // Defined before generateAnswer so real retrieval can save useful facts
  // without depending on a callback declared later in this component.
  const rememberFromAnswer = useCallback((content: string, kind: Memory["kind"]) => {
    const clean = content.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!clean) return;
    const hash = memoryHash(clean);
    if (memoriesRef.current.some((m) => !m.supersededBy && m.hash === hash)) return;
    const stamp = now();
    const memory: Memory = {
      id: makeId(), content: clean, kind, conversationId: null, source: "user",
      hash, createdAt: stamp, updatedAt: stamp, recallCount: 0,
    };
    const next = [memory, ...memoriesRef.current];
    memoriesRef.current = next;
    setMemories(next);
    logActivity("success", `Memory saved: ${clean.slice(0, 64)}`);
  }, [logActivity]);

  const generateAnswer = useCallback(async (text: string, conversationId: string, history: ChatTurn[], signal?: AbortSignal): Promise<LocalAnswerResult> => {
    const charSession = sessionRef.current;
    const prefs = settingsRef.current;
    const experimental = prefs.chatMode === "experimental" && prefs.sandboxExperimental;
    const trace = new TraceRecorder(text, experimental ? "experimental" : "grounded", (snapshot) => {
      setTraces((prev) => [snapshot, ...prev.filter((run) => run.id !== snapshot.id)].slice(0, 24));
    });

    // 1. Receiving user message
    trace.runStage("Receive message", "Accepted the message and verified the local engine is available.", ["User message"], () => ({
      value: text,
      retrieved: [text.slice(0, 160)],
      note: `Mode: ${experimental ? "Sandbox experimental" : "Normal grounded"}. Character model ${charSession ? `step ${trainingRef.current.step}` : "unavailable; ranking uses coverage only"}.`,
    }));

    // 2. Analyzing the message
    const analyzed = trace.runStage("Analyze message", "Normalized informal/typo wording, classified intent, resolved short follow-ups and checked ambiguity.", ["Dictionary", "Grammar knowledge", "Conversation context"], () => {
      const understanding = understandMessage({ text, history, dictionary: dictionaryRef.current, knownWords, conceptGraph });
      const sentence = analyzeSentence(understanding.corrected, dictionaryRef.current);
      return {
        value: { understanding, sentence },
        retrieved: [understanding.corrected, sentence.description, ...understanding.ambiguities],
        note: `Intent: ${understanding.intent}/${understanding.questionKind}; pattern: ${sentence.pattern}`,
      };
    });
    const query = analyzed.understanding.corrected || text;

    // 3. Identifying relevant concepts
    const concepts = trace.runStage("Identify concepts", "Expanded content words with dictionary metadata and the local concept network.", ["Dictionary", "Concept network"], () => {
      const value = analyzed.understanding.expandedTerms.slice(0, 16);
      return {
        value,
        retrieved: value,
        note: value.length ? `${value.length} concept term(s) after expansion.` : "No content words were found.",
      };
    });

    // 4. Searching the dictionary
    const dictionaryMatches = trace.runStage("Search dictionary", "Looked up words that actually appear in the normalized message.", ["Dictionary (bundled + local)"], () => {
      const value = retrieveDictionary(query, dictionaryRef.current).slice(0, 5);
      return { value, retrieved: value.map((m) => `${m.word.word}: ${m.word.definition.slice(0, 100)}`), note: value.length ? "" : "No dictionary entry matched." };
    });
    const language = enrichUnderstanding(analyzed.understanding, dictionaryMatches);
    const dictionaryTerms = dictionaryMatches.map((match) => match.word.word);
    const addressesQuestion = (candidate: string): boolean => answerAddressesQuestion(query, candidate, dictionaryTerms);
    const grammarItems = prefs.useKnowledge ? retrieveGrammar(query, knowledgeRef.current) : [];

    // 5. Searching uploaded datasets
    const datasetResults = trace.runStage("Search datasets", "Scanned uploaded datasets for real Q&A pairs, definitions and passages.", ["Uploaded datasets"], () => {
      const datasetTexts = datasetsRef.current.map((dataset) => dataset.content);
      const conversationAnswer = findConversationAnswer(query, datasetTexts);
      const entries = datasetAnswers(datasetsRef.current.map((dataset) => ({ title: dataset.name, content: dataset.content })));
      const matches = findDatasetAnswers(query, entries, 3);
      return {
        value: { conversationAnswer, matches },
        retrieved: [...(conversationAnswer ? [conversationAnswer] : []), ...matches.map((m) => `Q: ${m.question} · A: ${m.answer.slice(0, 100)}`)],
        note: conversationAnswer || matches.length ? "" : "No dataset answer matched.",
      };
    });

    // 6. Retrieving relevant memories
    const memoryItems = prefs.useMemory
      ? retrieveLearningContext(query, { memories: memoriesRef.current }, { conversationId, maxItems: 2, maxChars: 500 })
      : [];
    const correctionItems = prefs.useCorrections
      ? retrieveLearningContext(query, { corrections: correctionsRef.current }, { maxItems: 2, maxChars: 700 })
      : [];
    const knowledgeItems = prefs.useKnowledge
      ? retrieveContext(query, documentsFromStore(datasetsRef.current, knowledgeRef.current), { maxChunks: 3, maxChars: 1600, chunkSize: 420 }).sources
      : [];
    trace.runStage("Retrieve memories", "Recalled active memories, approved corrections and knowledge by relevance.", ["Memory", "Corrections", "Knowledge base"], () => ({
      value: { memoryItems, correctionItems, knowledgeItems },
      retrieved: [
        ...memoryItems.map((i) => `${i.title}: ${i.content.slice(0, 90)}`),
        ...correctionItems.map((i) => `${i.title}: ${(i.answer ?? i.content).slice(0, 90)}`),
        ...knowledgeItems.map((i) => i.title),
      ],
      note: memoryItems.length + correctionItems.length + knowledgeItems.length ? "" : "No relevant memory, correction or knowledge was retrieved.",
    }));

    // Evidence is shared by generation and by the retrieval engine.
    const evidence = [
      ...correctionItems.map((item) => item.answer ?? item.content),
      ...memoryItems.map((item) => item.content),
      ...datasetResults.matches.map((match) => match.answer),
      ...(datasetResults.conversationAnswer ? [datasetResults.conversationAnswer] : []),
      ...dictionaryMatches.slice(0, 3).map((match) => `${match.word.word}: ${match.word.definition}`),
      ...knowledgeItems.map((item) => item.content.slice(0, 320)),
    ].filter((value) => typeof value === "string" && value.trim()).slice(0, 8);

    // 6.5 Reasoning plan: real decomposition, calculation and consistency check
    const reasoningPlan = trace.runStage("Plan reasoning", "Decomposed the request, performed any real calculation and checked retrieved evidence for direct contradictions.", ["User message", "Retrieved evidence"], () => {
      const evidenceItems: EvidenceItem[] = evidence.map((text, index) => ({ text, source: `Evidence ${index + 1}` }));
      const plan = buildReasoningPlan({ question: query, evidence: evidenceItems, intent: language.intent });
      return {
        value: plan,
        retrieved: plan.steps.map((step) => `${step.action}: ${step.result}`),
        note: plan.calculation
          ? `Real calculation performed: ${plan.calculation.spoken}`
          : "No arithmetic or equation detected; reasoning uses decomposition and evidence checks only.",
      };
    });
    const calculation = reasoningPlan.calculation;
    // A holder avoids control-flow narrowing across the traced callback.
    const verificationState: { value: AnswerVerification | null } = { value: null };

    // 7. Evaluating available information
    const grounded = trace.runStage("Evaluate information", "Built the candidate pool from retrieved evidence only.", ["All retrieved sources"], () => {
      const list = groundedCandidates({
        query,
        memoryItems, correctionItems, knowledgeItems,
        conversationAnswer: datasetResults.conversationAnswer,
        datasetMatches: datasetResults.matches,
      });
      return {
        value: list,
        retrieved: list.map((c) => `${c.source}: ${c.text.slice(0, 90)}`),
        note: list.length ? `${list.length} evidence-backed candidate(s).` : "No evidence-backed candidate was available.",
      };
    });
    // Dictionary definitions are retrieval candidates, not answer rules. The
    // retrieval engine may quote them, but no template is used to invent text.
    // Dictionary definitions are low-priority evidence, never answer rules.
    // A user correction or memory must outrank them when both are retrieved.
    const dictionaryCandidates = dictionaryMatches.slice(0, 3).map((match) => {
      const definition = match.word.definition.replace(/\.$/, "").trim();
    const candidateText = polishAnswer(`${match.word.word} means ${definition}`, text);
      return {
        text: candidateText,
        source: `Dictionary · ${match.word.word}`,
        priority: 1,
        score: 0,
        coverage: queryCoverage(text, candidateText),
      };
    });
    // A definition of one word in the question is not an answer to the whole
    // question. Only keep candidates that address the question's subject.
    const relevantGrounded = grounded.filter((candidate) => addressesQuestion(candidate.text));
    const relevantDictionary = dictionaryCandidates.filter((candidate) => addressesQuestion(candidate.text));
    const candidatePool = [...relevantGrounded, ...relevantDictionary];
    // A verified local calculation is genuine evidence, not a memorized rule.
    // It bypasses the subject-overlap filter because numeric answers rarely
    // repeat the question's words, and it is ranked at the highest priority.
    if (calculation) {
      candidatePool.unshift({
        text: calculation.spoken,
        source: "Local calculation",
        priority: 5,
        score: 1,
        coverage: 1,
      });
    }
    // A complete sentence copied from the user's data is already grammatical
    // and correctly capitalized. The word tokenizer has no case or punctuation
    // tokens, so raw samples cannot match it for sentence quality. Prefer the
    // real sentence whenever one directly addresses the question.
    const preferGrounded = !experimental && !calculation && candidatePool.some((candidate) =>
      isReadableText(candidate.text)
      && /^[A-Z]/.test(candidate.text)
      && /[.!?]$/.test(candidate.text)
      && (candidate.coverage ?? 0) >= 0.34);
    const promptItems = [
      ...knowledgeItems,
      ...grammarItems.map((entry) => ({ title: entry.title, type: "knowledge" as const, content: entry.content })),
      ...dictionaryMatches.slice(0, 3).map((match) => ({
        title: `Dictionary: ${match.word.word}`, type: "knowledge" as const,
        content: `${match.word.word} (${match.word.partOfSpeech}): ${match.word.definition} Example: ${match.word.example}`,
      })),
    ];
    const charPrompt = buildLocalPrompt({
      message: text, history: history.slice(-6), memoryItems, correctionItems,
      knowledgeItems: promptItems, maxChars: 900,
    });

    // 8. Exploring possible approaches
    const experimentalResult = experimental ? buildExperimentalResult({
      message: text,
      words: dictionaryRef.current,
      knowledge: knowledgeRef.current,
      datasetFacts: datasetResults.matches.map((match) => ({ label: `Dataset · ${match.sourceTitle}`, text: match.answer })),
      memoryFacts: memoryItems.map((item) => ({ label: item.title, text: item.content })),
      creativity: Math.max(prefs.sandboxCreativity, prefs.sandboxIntensity),
      risk: prefs.sandboxRisk,
    }) : null;
    trace.runStage("Explore approaches", "Weighed generation against quoting retrieved evidence and labelled sandbox hypotheses.", ["Engine settings", "Retrieved evidence"], () => ({
      value: {
        engine: prefs.answerEngine,
        experimental: Boolean(experimentalResult),
        approaches: [
          ...(correctionItems.length ? ["approved correction"] : []),
          ...(memoryItems.length ? ["memory"] : []),
          ...(grounded.length ? ["retrieved evidence"] : []),
          "word-level generation",
          ...(experimentalResult ? ["labelled hypothesis"] : []),
        ],
      },
      retrieved: [prefs.answerEngine === "generative" ? "Prefer word-level generation conditioned on evidence." : "Prefer quoted local evidence."],
      note: experimentalResult ? "Sandbox hypotheses are explicitly labelled and are not facts." : "",
    }));

    let wordSession = wordSessionRef.current;
    if (prefs.answerEngine === "generative" && !wordSession) {
      const initialized = initWordModel();
      if (initialized.ok) wordSession = wordSessionRef.current;
    }
    // A handful of steps on a thousands-word vocabulary is indistinguishable
    // from random and always fails the coherence gate below. Going through the
    // sampling path anyway only adds tens of seconds before falling back.
    const MIN_GENERATIVE_STEPS = 30;
    const canGenerate = prefs.answerEngine === "generative"
      && Boolean(wordSession && wordSession.step >= MIN_GENERATIVE_STEPS)
      && !calculation;
    let engine: "generative" | "retrieval" = canGenerate ? "generative" : "retrieval";
    const generationNotes: { value: string } = { value: "" };
    const generationMetrics: { tokens: number; elapsedMs: number } = { tokens: 0, elapsedMs: 0 };
    if (preferGrounded && engine === "generative") {
      engine = "retrieval";
      generationNotes.value = "Quoted one complete sentence from your local data so the wording, grammar and capitalization stay faithful to the source.";
    }

    const evidenceWords = new Set(evidence.join(" ").toLowerCase().match(/[a-z]+/g) ?? []);
    const expectedContent = new Set(extractWords([...concepts, evidence.join(" ")].join(" ")));
    // Reject word soup. A generated answer must contain meaningful words that
    // came from the question or retrieved evidence, and must not be mostly
    // repeated function words. This is a real quality gate, not a fake animation.
    const coherentGeneration = (candidate: string): boolean => {
      const words = candidate.toLowerCase().match(/[a-z]+/g) ?? [];
      const content = extractWords(candidate);
      const uniqueRatio = words.length ? new Set(words).size / words.length : 0;
      const hits = content.length ? content.filter((word) => expectedContent.has(word)).length / content.length : 0;
      return words.length >= 4 && content.length >= 2 && uniqueRatio >= 0.55 && hits >= 0.5 && addressesQuestion(candidate);
    };
    const scoreGeneration = (candidate: string): number => {
      const readable = isReadableText(candidate, 3);
      const words = candidate.toLowerCase().match(/[a-z]+/g) ?? [];
      const overlap = words.length ? words.filter((word) => evidenceWords.has(word)).length / words.length : 0;
      const lm = wordSession
        // Ranking candidates only needs a short teacher-forced prefix; each
        // extra token adds a full batch row to the biggest matmul in the model.
        ? scoreAnswer(wordSession.model, wordSession.tokenizer, wordPrompt(text, evidence), candidate, 12)
        : -20;
      return (readable ? 2 : 0) + overlap + Math.max(-2, Math.min(2, lm / 4));
    };

    // 9. Generating a response
    const generation = await trace.runAsyncStage("Generate response", engine === "generative"
      ? `Sampled ${experimental ? "several" : "one"} continuation(s) from the word-level network, conditioned on retrieved evidence.`
      : preferGrounded
        ? "Selected one complete sentence quoted from local evidence so wording and capitalization stay faithful to the source."
        : "Selected a candidate quoted from local evidence; the word-level model is not trained yet.", ["Language model", "Retrieved evidence"], async () => {
        if (signal?.aborted) return { value: [], retrieved: [], note: "Generation was stopped by the user." };
        if (engine === "generative" && wordSession) {
          const count = experimental ? Math.min(4, 1 + Math.floor(prefs.sandboxIntensity / 30)) : 1;
          const out: Array<{ text: string; score: number }> = [];
          for (let i = 0; i < count; i++) {
            const result = await wordSession.generateAsync(wordPrompt(text, evidence), {
              maxTokens: 64,
              temperature: experimental
                ? Math.min(1.4, 0.5 + prefs.sandboxIntensity / 140)
                : Math.min(0.7, prefs.temperature),
              topK: experimental ? 24 : prefs.topK > 0 ? prefs.topK : 8,
              topP: prefs.topP,
              repetitionPenalty: prefs.repetitionPenalty,
              seed: (Date.now() + i * 7919) >>> 0,
              stopOnEos: true,
              signal,
            });
            generationMetrics.tokens += result.tokensGenerated;
            generationMetrics.elapsedMs += result.elapsedMs;
            const boundary = result.text.search(/\n(?:User|DavidAI):/);
            const cleaned = polishAnswer(boundary >= 0 ? result.text.slice(0, boundary) : result.text, text);
            // With one sample the score cannot change which candidate wins, and
            // LM scoring runs a separate forward pass per answer token.
            if (cleaned) out.push({ text: cleaned, score: count === 1 ? 0 : scoreGeneration(cleaned) });
            if (signal?.aborted) break;
          }
          const usable = out.filter((candidate) => coherentGeneration(candidate.text));
          if (usable.length) {
            return { value: usable, retrieved: usable.map((c) => c.text.slice(0, 100)), note: `${usable.length} coherent model continuation(s) from ${out.length} sample(s).` };
          }
          // The network really ran, but its output was not good enough. Say so
          // and fall back to quoted evidence instead of showing word soup.
          engine = "retrieval";
          generationNotes.value = "The word-level model produced no coherent answer. Train it longer or integrate a free local pretrained model for fluent generation.";
        }
        // Retrieval engine: rank real retrieved candidates, using the character
        // model only when it exists and the user allows retrieval fallback.
        if (!prefs.useGroundedAnswers) {
          generationNotes.value = "Retrieval fallback is disabled; no local evidence will be quoted.";
          return {
            value: [], retrieved: [],
            note: "Retrieval fallback is disabled; no local evidence will be quoted.",
          };
        }
        // A repeated question deserves the same factual answer. Never suppress a
        // grounded candidate just because it appeared in a recent turn; doing so
        // created a false no-answer and triggered unnecessary web fallback.
        const ranked = rankRetrievalCandidates({
          candidates: candidatePool,
          query,
          useModelScore: Boolean(charSession),
          modelScore: charSession
            ? (candidateText) => scoreAnswer(charSession.model, charSession.tokenizer, charPrompt, candidateText)
            : undefined,
        });
        const out = ranked.map((candidate) => ({ text: candidate.text, score: candidate.finalScore, source: candidate.source }));
        if (generationNotes.value && out.length) {
          generationNotes.value += " Real retrieved evidence was quoted instead.";
        } else if (!out.length) {
          generationNotes.value = "No relevant local candidate remained after the question-coverage check; an honest no-answer response was delivered.";
        }
        return {
          value: out,
          retrieved: out.slice(0, 4).map((c) => c.text.slice(0, 100)),
          note: `${out.length} relevant retrieved candidate(s); ${charSession ? "scored with the local network" : "ranked by relevance without a character model"}.`,
        };
      });

    if (signal?.aborted) {
      const aborted: LocalAnswerResult = {
        text: "", tokensGenerated: 0, elapsedMs: 0, tokensPerSecond: 0, sources: [],
        memoryItems: [], correctionItems: [], knowledgeItems: [], modelVersion: null,
        answerMode: "fallback", engine: "retrieval", reasoning: {
          concepts, approaches: [], selected: "none", uncertainties: ["Generation was stopped."],
          construction: "No answer was delivered.",
        }, traceId: trace.run.id, understanding: language, reasoningPlan, verification: undefined, candidates: [],
      };
      trace.finish("", aborted.reasoning, "failed");
      return aborted;
    }

    const best = generation.slice().sort((a, b) => b.score - a.score)[0];
    const groundedAvailable = engine === "retrieval" && (Boolean(calculation) || generation.some((candidate) =>
      "source" in candidate && addressesQuestion(candidate.text)));
    let answer = best?.text ?? "";
    let groundedSource = engine === "retrieval" && best && "source" in best ? String((best as { source?: string }).source ?? "") : "";
    // An object keeps the mutable mode visible across the traced check callback.
    const answerState: { mode: LocalAnswerResult["answerMode"] } = { mode: engine === "generative" ? "generated" : "grounded" };
    if (experimentalResult && engine === "retrieval" && !groundedAvailable) {
      answer = experimentalResult.answer;
      groundedSource = "Experimental · labelled hypothesis";
      answerState.mode = "experimental";
    } else if (experimental && engine === "generative" && answer && !correctionItems.length && !memoryItems.length) {
      answer = `Hypothesis (unverified): ${answer}`;
      answerState.mode = "experimental";
    }

    // 10. Checking the generated response
    const checkState: { status: TraceStatus } = { status: "success" };
    trace.runStage("Check response", "Applied real readability, relevance, source and calculation-verification checks.", ["Generated answer", "Retrieved evidence"], () => {
      const readable = isReadableText(answer, 3);
      const groundedOk = engine === "retrieval" ? Boolean(groundedSource) : true;
      const isCalculationAnswer = groundedSource === "Local calculation" || Boolean(calculation && answer === calculation.spoken);
      const relevantOk = answerState.mode === "experimental" || isCalculationAnswer || addressesQuestion(answer);
      verificationState.value = verifyAnswer({ question: query, answer, evidence, plan: reasoningPlan });
      // Verification is no longer decorative: contradictions and unsupported
      // claims block delivery. Labelled sandbox hypotheses are the only
      // exception because they are explicitly marked as unverified.
      const verifiedOk = answerState.mode === "experimental" || verificationState.value.ok;
      const ok = Boolean(answer) && readable && groundedOk && relevantOk && verifiedOk;
      const note = !answer
        ? "No candidate was produced."
        : !readable
          ? "The candidate failed the English readability check."
          : !groundedOk
            ? "No grounded source was available."
            : !relevantOk
              ? "The candidate did not address the question's subject."
              : !verifiedOk
                ? "The answer failed evidence support, contradiction or calculation checks."
                : "Answer passed local checks.";
      if (!ok) {
        answer = "I don't have a reliable answer for that in my local data yet. Add it to Knowledge or correct me, then start feedback training and I will use it next time.";
        answerState.mode = "fallback";
        groundedSource = "";
      }
      checkState.status = ok ? "success" : "failed";
      return { value: ok, retrieved: [answer.slice(0, 160)], note, status: checkState.status };
    });

    const answerAccepted = answerState.mode !== "fallback";
    const recalledIds = answerAccepted ? memoryItems.map((item) => item.sourceId) : [];
    if (recalledIds.length) {
      const stamp = new Date().toISOString();
      setMemories((prev) => prev.map((m) => recalledIds.includes(m.id)
        ? { ...m, recallCount: m.recallCount + 1, lastRecalledAt: stamp }
        : m));
    }
    if (answerAccepted && dictionaryMatches.length) {
      const stamp = new Date().toISOString();
      const usedIds = dictionaryMatches.map((match) => match.word.id);
      setDictionary((prev) => prev.map((word) => usedIds.includes(word.id)
        ? { ...word, useCount: word.useCount + 1, lastUsedAt: stamp }
        : word));
    }
    const questionLike = /^(what|define|meaning|how|who|why|when|where|tell|explain|does|is|are)\b/i.test(text.trim());
    if (!experimental && questionLike && answerAccepted && addressesQuestion(answer)) {
      if (engine === "retrieval" && groundedSource.startsWith("Dictionary")) {
        const match = dictionaryMatches.find((item) => groundedSource.includes(item.word.word))
          ?? dictionaryMatches[0];
        if (match) {
          const storedDefinition = match.word.definition.trim().replace(/\.$/, "");
          rememberFromAnswer(`Vocabulary: ${match.word.word} means ${storedDefinition.charAt(0).toLowerCase()}${storedDefinition.slice(1)}`, "vocabulary");
        }
      } else if (engine === "retrieval" && (groundedSource.startsWith("Dataset") || groundedSource === "Conversation data")) {
        const selectedDatasetMatch = datasetResults.matches.find((item) =>
          groundedSource.includes(item.sourceTitle) && answer.includes(item.answer.slice(0, 40)))
          ?? datasetResults.matches[0];
        if (selectedDatasetMatch) {
          rememberFromAnswer(`Knowledge: ${text.replace(/\s+/g, " ").trim().slice(0, 80)} — ${selectedDatasetMatch.answer}`, "knowledge");
        }
      }
    }

    const uncertainties: string[] = [];
    if (!dictionaryMatches.length) uncertainties.push("No dictionary entry matched this message.");
    if (!datasetResults.matches.length && !datasetResults.conversationAnswer) uncertainties.push("No uploaded dataset answer matched this message.");
    if (engine === "retrieval" && !canGenerate && answerAccepted && !calculation) uncertainties.push("The word-level model is not trained yet, so this answer quotes local evidence rather than generating new text. Train it in the Training Lab.");
    if (checkState.status === "failed" || answerState.mode === "fallback") uncertainties.push("The candidate failed local checks; an honest no-answer response was delivered.");
    if (generationNotes.value) uncertainties.push(generationNotes.value);
    if (verificationState.value?.calculationMatches === false) uncertainties.push(`The local calculation produced a different value than the delivered answer: ${verificationState.value.reasons[0] ?? "mismatch"}.`);
    for (const ambiguity of language.ambiguities.slice(0, 2)) uncertainties.push(ambiguity);
    if (experimental) uncertainties.push("Sandbox output is exploratory; labelled hypotheses are not verified facts.");
    const approaches: ReasoningSummary["approaches"] = [
      { name: "Approved correction", selected: answerAccepted && groundedSource.startsWith("Approved correction"), reason: correctionItems.length ? `${relevantGrounded.length} relevant evidence candidate(s) remained after the subject check.` : "No approved correction matched." },
      { name: "Memory", selected: answerAccepted && (groundedSource === "Memory" || groundedSource.startsWith("Preference") || groundedSource.startsWith("Remembered")), reason: memoryItems.length ? `${memoryItems.length} active memory/matches.` : "No active memory matched." },
      { name: "Dataset evidence", selected: answerAccepted && (groundedSource.startsWith("Dataset") || groundedSource === "Conversation data"), reason: datasetResults.matches.length || datasetResults.conversationAnswer ? "A real Q&A or definition was found in your datasets." : "No dataset answer matched." },
      { name: "Dictionary and grammar", selected: answerAccepted && groundedSource.startsWith("Dictionary"), reason: dictionaryMatches.length ? `${relevantDictionary.length} of ${dictionaryMatches.length} word entries addressed the question.` : "No dictionary entry matched." },
      { name: "Local calculation", selected: answerAccepted && groundedSource === "Local calculation", reason: calculation ? `${calculation.expression} = ${calculation.spoken}` : "No arithmetic or equation detected." },
      { name: "Word-level generation", selected: answerAccepted && engine === "generative", reason: canGenerate ? `Sampled ${generation.length} continuation(s) from ${wordVocabSize || wordSession?.tokenizer.size || 0} learned word tokens.` : calculation ? "A verified local calculation was used instead of generation." : "Model is untrained or disabled." },
      ...(experimentalResult ? [{ name: "Labelled hypothesis", selected: answerAccepted && answerState.mode === "experimental", reason: "Sandbox hypotheses combine local evidence but are explicitly unverified." }] : []),
    ];
    const reasoning: ReasoningSummary = {
      concepts,
      approaches,
      selected: !answerAccepted ? "No grounded source" : answerState.mode === "experimental" ? "Labelled hypothesis" : groundedSource === "Local calculation" ? "Local calculation" : engine === "generative" ? "Word-level generation" : groundedSource || "No grounded source",
      uncertainties,
      construction: !answerAccepted
        ? "Retrieved candidates were checked for readability, source and question coverage; none passed, so an honest no-answer response was delivered."
        : groundedSource === "Local calculation"
          ? `A safe local evaluator computed ${calculation?.expression} = ${calculation?.value}; the answer was verified to contain that value.`
          : engine === "generative"
            ? `The word-level network generated ${generation.length} continuation(s) from a prompt containing ${evidence.length} retrieved evidence item(s); the best candidate passed readability, relevance and overlap checks.`
            : `A candidate was selected from ${candidatePool.length} subject-relevant evidence item(s) and scored with coverage, trust priority${charSession ? " and a real forward pass of the local network" : ""}.${generationNotes.value ? ` ${generationNotes.value}` : ""}`,
    };

    // 11. Delivering the final answer
    trace.runStage("Deliver answer", "Returned the checked answer to the conversation and recorded its sources.", ["Final response"], () => ({
      value: answer,
      retrieved: [answer.slice(0, 160)],
      note: `Engine: ${engine}; mode: ${answerState.mode}.`,
    }));
    trace.finish(answer, reasoning, answerState.mode === "fallback" ? "failed" : "complete");

    const versions = versionsRef.current;
    // Provenance must describe what produced the delivered answer, not every
    // item that happened to be retrieved during the turn.
    const resultSources = !answerAccepted ? [] : [
      ...(groundedSource ? [groundedSource] : []),
      ...(engine === "generative" ? dictionaryMatches.slice(0, 2).map((match) => `Dictionary · ${match.word.word}`) : []),
      ...(experimentalResult ? experimentalResult.sources.slice(0, 4) : []),
    ];
    const result: LocalAnswerResult = {
      text: answer,
      tokensGenerated: generationMetrics.tokens,
      elapsedMs: generationMetrics.elapsedMs,
      tokensPerSecond: generationMetrics.elapsedMs > 0
        ? generationMetrics.tokens / (generationMetrics.elapsedMs / 1000) : 0,
      sources: resultSources,
      memoryItems,
      correctionItems,
      knowledgeItems,
      modelVersion: versions.length ? Math.max(...versions.map((v) => v.version)) : null,
      answerMode: answerState.mode,
      engine,
      reasoning,
      traceId: trace.run.id,
      understanding: language,
      reasoningPlan,
      verification: verificationState.value ?? undefined,
      candidates: generation.map((candidate) => ({
        text: candidate.text.slice(0, 300),
        score: candidate.score,
        selected: candidate.text === best?.text,
      })),
    };
    return result;
  }, [initWordModel, rememberFromAnswer, conceptGraph, wordVocabSize]);

  const clearChat = useCallback(() => setChatMessages([]), [setChatMessages]);

  const createConversation = useCallback(() => {
    const conversation = makeConversation();
    setConversations((prev) => [conversation, ...prev].slice(0, 200));
    setActiveConversationId(conversation.id);
    return conversation.id;
  }, []);

  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    const clean = title.trim().slice(0, 80);
    if (!clean) return;
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, title: clean, updatedAt: now() } : c));
  }, []);

  const deleteConversation = useCallback((id: string) => {
    const remaining = conversations.filter((c) => c.id !== id);
    const next = remaining.length ? remaining : [makeConversation()];
    setConversations(next);
    if (activeConversationId === id) setActiveConversationId(next[0].id);
  }, [activeConversationId, conversations]);

  const togglePinConversation = useCallback((id: string) => {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, pinned: !c.pinned, updatedAt: now() } : c));
  }, []);

  const moveConversationToFolder = useCallback((id: string, folderId: string | null) => {
    const clean = folderId?.trim().slice(0, 40) || null;
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, folderId: clean, updatedAt: now() } : c));
  }, []);

  const setConversationArchived = useCallback((id: string, archived: boolean) => {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, archived, updatedAt: now() } : c));
  }, []);

  const updateMessage = useCallback((conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
    setConversations((prev) => prev.map((c) => c.id === conversationId
      ? { ...c, updatedAt: now(), messages: c.messages.map((m) => m.id === messageId ? { ...m, ...patch } : m) }
      : c));
  }, []);

  const deleteMessage = useCallback((conversationId: string, messageId: string) => {
    setConversations((prev) => prev.map((c) => c.id === conversationId
      ? { ...c, updatedAt: now(), messages: c.messages.filter((m) => m.id !== messageId) }
      : c));
  }, []);

  /* ----------------------------- checkpoints ----------------------------- */
  const saveCheckpoint = useCallback((name: string, mode?: "char" | "word") => {
    const wantWord = mode ? mode === "word" : (!sessionRef.current && !!wordSessionRef.current);
    const s = wantWord ? wordSessionRef.current : sessionRef.current;
    if (!s) throw new Error("No model is loaded. Nothing to save.");
    const snapshot = createSnapshot(s.model, s.tokenizer, s.step, s.optimizer);
    const id = makeId();
    const label = wantWord ? "Word model" : "Character model";
    const meta: CheckpointMeta = {
      id,
      name: name.trim().slice(0, 80) || `${label} checkpoint ${new Date().toLocaleString()}`,
      createdAt: now(),
      config: { ...s.model.config },
      vocabSize: s.tokenizer.size,
      trainingSteps: s.step,
      loss: wantWord ? wordLoss : trainingRef.current.loss,
      sizeBytes: snapshotSizeBytes(snapshot),
      datasetNames: selectedDatasetIds.map((id2) => datasetsRef.current.find((d) => d.id === id2)?.name).filter(Boolean) as string[],
      mode: wantWord ? "word" : "char",
    };
    const result = writeLocal(`checkpoint:${id}`, snapshot);
    if (!result.ok) throw new Error(result.error ?? "Could not save checkpoint.");
    setCheckpoints((prev) => [meta, ...prev]);
    setActiveCheckpointId(id);
    logActivity("success", `${label} checkpoint "${meta.name}" saved with ${meta.trainingSteps} training steps.`);
    return meta;
  }, [logActivity, selectedDatasetIds, wordLoss]);

  const loadCheckpoint = useCallback((id: string) => {
    const snap = readLocal<ModelSnapshot | null>(`checkpoint:${id}`, null);
    if (!snap) throw new Error("Checkpoint data is missing.");
    const meta = checkpoints.find((c) => c.id === id);
    // Word-mode snapshots belong to the generative chat model, not the legacy
    // character model. Route them to the correct live session and storage key.
    if (snap.tokenizerMode === "word") {
      const wordSession = sessionFromSnapshot(snap, wordLearningRate(settingsRef.current.learningRate));
      wordSessionRef.current = wordSession;
      const persisted = writeLocal("wordModel", snap);
      if (!persisted.ok) throw new Error(persisted.error ?? "Could not persist the word model.");
      setWordModelReady(true);
      setWordVocabSize(wordSession.tokenizer.size);
      setWordParams(estimateParams(wordSession.model.config));
      setWordSteps(wordSession.step);
      const restoredLoss = meta?.loss ?? (wordSession.lossHistory.length ? wordSession.lossHistory[wordSession.lossHistory.length - 1].loss : null);
      setWordLoss(restoredLoss);
      writeLocal("wordModelLoss", restoredLoss);
      setActiveCheckpointId(id);
      logActivity("success", `Word-model checkpoint "${meta?.name ?? id}" restored for AI Chat.`);
      return;
    }
    const session = sessionFromSnapshot(snap, settingsRef.current.learningRate);
    runningRef.current = false;
    sessionRef.current = session;
    const prepared = prepareSessionData(session, selectedDatasetIds);
    setConfig(session.model.config);
    setModelReady(true);
    setActiveCheckpointId(id);
    accumulatedRef.current = 0;
    stepTimesRef.current = [];
    patchTraining({
      ...DEFAULT_TRAINING_STATE,
      step: session.step,
      loss: meta?.loss ?? null,
      samples: prepared.samples ?? 0,
      status: "idle",
      error: prepared.ok ? null : prepared.reason,
      totalSteps: session.step + settingsRef.current.trainingSteps,
    });
    persistModel();
    logActivity("success", `Checkpoint "${meta?.name ?? id}" loaded.`);
  }, [checkpoints, logActivity, patchTraining, persistModel, prepareSessionData, selectedDatasetIds]);

  const deleteCheckpoint = useCallback((id: string) => {
    const meta = checkpoints.find((c) => c.id === id);
    setCheckpoints((prev) => prev.filter((c) => c.id !== id));
    removeLocal(`checkpoint:${id}`);
    setActiveCheckpointId((prev) => prev === id ? null : prev);
    logActivity("warning", `Checkpoint "${meta?.name ?? id}" deleted.`);
  }, [checkpoints, logActivity]);

  const exportCheckpoint = useCallback((id: string) => {
    const meta = checkpoints.find((c) => c.id === id);
    const snapshot = readLocal<ModelSnapshot | null>(`checkpoint:${id}`, null);
    if (!meta || !snapshot) throw new Error("Checkpoint data is missing.");
    return JSON.stringify({ app: "DavidAI-checkpoint", version: 1, meta, snapshot }, null, 2);
  }, [checkpoints]);

  const importCheckpoint = useCallback((json: string) => {
    const parsed = JSON.parse(json) as { app?: string; snapshot?: unknown; meta?: Partial<CheckpointMeta> };
    if (parsed.app !== "DavidAI-checkpoint" || !parsed.snapshot) throw new Error("This is not a DavidAI checkpoint export.");
    const error = validateSnapshot(parsed.snapshot);
    if (error) throw new Error(`Incompatible checkpoint: ${error}`);
    const snap = parsed.snapshot as ModelSnapshot;
    const id = makeId();
    const meta: CheckpointMeta = {
      id,
      name: String(parsed.meta?.name ?? `Imported checkpoint ${new Date().toLocaleDateString()}`).slice(0, 80),
      createdAt: now(),
      config: { ...snap.config },
      vocabSize: snap.vocab.length,
      trainingSteps: FiniteStep(snap.step),
      loss: Number.isFinite(parsed.meta?.loss) ? parsed.meta!.loss! : null,
      sizeBytes: snapshotSizeBytes(snap),
      datasetNames: Array.isArray(parsed.meta?.datasetNames) ? parsed.meta!.datasetNames!.map(String) : [],
      mode: parsed.meta?.mode ?? (snap.tokenizerMode === "word" ? "word" : "char"),
    };
    writeLocal(`checkpoint:${id}`, snap);
    setCheckpoints((prev) => [meta, ...prev]);
    logActivity("success", `Checkpoint "${meta.name}" imported.`);
    return meta;
  }, [logActivity]);

  /* ------------------------ experiments & knowledge ------------------------ */
  const createExperiment = useCallback((name: string, description: string) => {
    const e: Experiment = {
      id: makeId(), name: name.trim() || "Untitled experiment", description: description.trim(),
      config: { ...config }, datasetIds: [...selectedDatasetIds], createdAt: now(),
      results: trainingRef.current.lossHistory.map((h) => ({ step: h.step, loss: h.loss, timestamp: now() })).slice(-200),
    };
    setExperiments((prev) => [e, ...prev]);
    logActivity("success", `Experiment "${e.name}" recorded.`);
    return e;
  }, [config, selectedDatasetIds, logActivity]);

  const updateExperiment = useCallback((id: string, patch: Partial<Experiment>) => {
    setExperiments((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e));
  }, []);

  const deleteExperiment = useCallback((id: string) => {
    setExperiments((prev) => prev.filter((e) => e.id !== id));
    logActivity("warning", "Experiment deleted.");
  }, [logActivity]);

  const addKnowledge = useCallback((entry: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">) => {
    const k: KnowledgeEntry = { ...entry, id: makeId(), createdAt: now(), updatedAt: now() };
    setKnowledge((prev) => [k, ...prev]);
    logActivity("success", `Knowledge entry "${k.title}" added.`);
    return k;
  }, [logActivity]);

  const updateKnowledge = useCallback((id: string, patch: Partial<KnowledgeEntry>) => {
    setKnowledge((prev) => prev.map((k) => k.id === id ? { ...k, ...patch, updatedAt: now() } : k));
  }, []);

  const deleteKnowledge = useCallback((id: string) => {
    setKnowledge((prev) => prev.filter((k) => k.id !== id));
    logActivity("warning", "Knowledge entry deleted.");
  }, [logActivity]);

  const knowledgeToDataset = useCallback((id: string) => {
    const k = knowledge.find((x) => x.id === id);
    if (!k) throw new Error("Knowledge entry not found.");
    return addDataset(k.title, `From knowledge base / ${k.category}`, k.content, k.category);
  }, [knowledge, addDataset]);

  /* ---------------------------- dictionary ----------------------------- */
  const addDictionaryWord = useCallback((input: {
    word: string; definition: string; partOfSpeech: DictionaryCategory; example: string; related?: string[];
    synonyms?: string[]; topics?: string[]; source?: string; reviewStatus?: "pending" | "approved" | "rejected";
  }) => {
    const cleanWord = input.word.trim().replace(/\s+/g, " ");
    if (!cleanWord) throw new Error("Word cannot be empty.");
    const existing = dictionaryRef.current.find((word) => normalizeWord(word.word) === normalizeWord(cleanWord));
    if (existing) {
      setDictionary((prev) => prev.map((word) => word.id === existing.id
        ? { ...word, definition: input.definition || word.definition, partOfSpeech: input.partOfSpeech || word.partOfSpeech,
            example: input.example || word.example, related: input.related ?? word.related,
            synonyms: input.synonyms ?? word.synonyms, topics: input.topics ?? word.topics,
            source: input.source ?? (word.source === "bundled" ? "user" : word.source),
            reviewStatus: input.reviewStatus ?? word.reviewStatus, updatedAt: now() }
        : word));
      logActivity("success", `Dictionary word "${cleanWord}" updated.`);
      return { ...existing, word: cleanWord, definition: input.definition || existing.definition, updatedAt: now() };
    }
    const stamp = now();
    const entry: DictionaryWord = {
      id: makeId(), word: cleanWord, definition: input.definition.trim(), partOfSpeech: input.partOfSpeech,
      example: input.example.trim(), related: input.related ?? [], synonyms: input.synonyms ?? [],
      topics: input.topics ?? ["everyday"], source: input.source ?? "user",
      reviewStatus: input.reviewStatus ?? "approved", createdAt: stamp, updatedAt: stamp, useCount: 0,
    };
    setDictionary((prev) => [entry, ...prev]);
    logActivity("success", `Dictionary word "${cleanWord}" added.`);
    return entry;
  }, [logActivity]);

  const updateDictionaryWord = useCallback((id: string, patch: Partial<Pick<DictionaryWord,
    "word" | "definition" | "partOfSpeech" | "example" | "related" | "synonyms" | "topics" | "source" | "reviewStatus">>) => {
    setDictionary((prev) => prev.map((word) => word.id === id
      ? { ...word, ...patch, source: patch.source ?? (word.source === "bundled" ? "user" : word.source), updatedAt: now() }
      : word));
    logActivity("info", "Dictionary word updated.");
  }, [logActivity]);

  const deleteDictionaryWord = useCallback((id: string) => {
    const target = dictionaryRef.current.find((word) => word.id === id);
    if (target?.source === "bundled") {
      setDictionaryTombstones((prev) => prev.includes(id) ? prev : [...prev, id]);
    }
    setDictionary((prev) => prev.filter((word) => word.id !== id));
    logActivity("warning", "Dictionary word deleted.");
  }, [logActivity]);

  const importDictionary = useCallback((json: string) => {
    const incoming = parseDictionaryImport(json);
    if (!incoming.length) throw new Error("No valid dictionary entries found in that file.");
    const existing = new Set(dictionaryRef.current.map((word) => `${normalizeWord(word.word)}|${word.partOfSpeech}`));
    const added = incoming.filter((word) => {
      const key = `${normalizeWord(word.word)}|${word.partOfSpeech}`;
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (added.length) {
      setDictionary((prev) => [...added, ...prev]);
      logActivity("success", `Imported ${added.length} dictionary word(s).`);
    }
    return added;
  }, [logActivity]);

  const reviewDictionaryWord = useCallback((id: string, status: "approved" | "rejected") => {
    setDictionary((prev) => prev.map((word) => word.id === id ? { ...word, reviewStatus: status, updatedAt: now() } : word));
    logActivity(status === "approved" ? "success" : "warning", `Dictionary correction ${status}.`);
  }, [logActivity]);

  /* ------------------------- sandbox experiments ------------------------ */
  const runSandboxExperiment = useCallback((input: {
    name: string; prompt: string; strategy: string; risk: "low" | "medium" | "high";
    experimental?: boolean; creativity?: number; proposal?: ExperimentProposal;
  }) => {
    const clean = input.prompt.trim();
    if (!clean) throw new Error("Enter a prompt to experiment with.");
    const trace = new TraceRecorder(`Sandbox · ${input.name.trim() || clean.slice(0, 40)}`, "experimental", (snapshot) => {
      setTraces((prev) => [snapshot, ...prev.filter((run) => run.id !== snapshot.id)].slice(0, 24));
    });
    trace.runStage("Receive experiment", "Accepted an isolated experiment prompt. No live conversation was changed.", ["User prompt"], () => ({
      value: clean, retrieved: [clean], note: `Strategy: ${input.strategy}; risk: ${input.risk}.`,
    }));

    const words = dictionaryRef.current;
    const entries = datasetAnswers(datasetsRef.current.map((dataset) => ({ title: dataset.name, content: dataset.content })));
    const dictMatches = trace.runStage("Search dictionary", "Retrieved real dictionary entries for the experiment prompt.", ["Dictionary"], () => {
      const value = retrieveDictionary(clean, words);
      return { value, retrieved: value.slice(0, 4).map((m) => `${m.word.word}: ${m.word.definition.slice(0, 100)}`), note: value.length ? "" : "No dictionary match." };
    });
    const dataMatches = trace.runStage("Search datasets", "Retrieved real dataset answers and passages.", ["Uploaded datasets"], () => {
      const value = findDatasetAnswers(clean, entries, 3);
      return { value, retrieved: value.map((m) => `Q: ${m.question} · A: ${m.answer.slice(0, 100)}`), note: value.length ? "" : "No dataset match." };
    });
    const grammar = trace.runStage("Search knowledge", "Retrieved grammar and knowledge lessons relevant to the prompt.", ["Knowledge base"], () => {
      const value = retrieveGrammar(clean, knowledgeRef.current);
      return { value, retrieved: value.slice(0, 3).map((g) => `${g.title}: ${g.content.slice(0, 90)}`), note: value.length ? "" : "No knowledge match." };
    });
    const analysis = analyzeSentence(clean, words);
    const memoryFacts = retrieveLearningContext(clean, {
      memories: memoriesRef.current, corrections: correctionsRef.current,
    }, { maxItems: 2, maxChars: 600 }).map((item) => ({ label: item.title, text: item.content }));
    trace.runStage("Retrieve memory", "Read active memories and approved corrections for context only.", ["Memory", "Corrections"], () => ({
      value: memoryFacts, retrieved: memoryFacts.map((m) => `${m.label}: ${m.text.slice(0, 90)}`), note: memoryFacts.length ? "" : "No relevant memory.",
    }));
    const experimentalResult = trace.runStage("Generate hypotheses", "Combined retrieved facts into explicitly unverified hypotheses.", ["Dictionary", "Datasets", "Knowledge", "Memory"], () => {
      const value = input.experimental ? buildExperimentalResult({
        message: clean,
        words,
        knowledge: knowledgeRef.current,
        datasetFacts: dataMatches.map((match) => ({ label: `Dataset · ${match.sourceTitle}`, text: match.answer })),
        memoryFacts,
        creativity: Math.max(input.creativity ?? settingsRef.current.sandboxCreativity, settingsRef.current.sandboxIntensity),
        risk: input.risk,
      }) : null;
      return { value, retrieved: value ? [...value.knownFacts, ...value.hypotheses].slice(0, 6) : [], note: value ? "" : "Hypothesis generation was disabled." };
    });

    // Every simulated answer comes from real retrieved local data.
    const evidence: Array<{ label: string; text: string }> = [];
    const seen = new Set<string>();
    const addEvidence = (label: string, text: string) => {
      const key = text.toLowerCase().replace(/\s+/g, " ").trim();
      if (!text || seen.has(key)) return;
      seen.add(key);
      evidence.push({ label, text });
    };
    for (const match of dictMatches.slice(0, 3)) {
      addEvidence("Dictionary", `${match.word.word}: ${match.word.definition} (${match.word.partOfSpeech})`);
    }
    for (const match of dataMatches) addEvidence(`Dataset · ${match.sourceTitle}`, match.answer);
    for (const lesson of grammar.slice(0, 2)) addEvidence("Grammar", `${lesson.title}: ${lesson.content}`);
    for (const fact of memoryFacts.slice(0, 2)) addEvidence("Memory", `${fact.label}: ${fact.text}`);
    if (analysis.pattern !== "No complete sentence pattern found") addEvidence("Sentence analysis", analysis.description);
    for (const hypothesis of experimentalResult?.hypotheses ?? []) addEvidence("Hypothesis", hypothesis);

    const intensity = Math.max(input.creativity ?? settingsRef.current.sandboxCreativity, settingsRef.current.sandboxIntensity);
    const modelAlternatives = trace.runStage("Explore model alternatives", "Sampled the trained word-level network with different seeds to produce alternative continuations.", ["Language model", "Retrieved evidence"], () => {
      const session = wordSessionRef.current;
      if (!session || session.step === 0) {
        return { value: [] as string[], retrieved: [], note: "Word model is not trained yet; no neural alternatives were produced.", status: "skipped" as const };
      }
      const count = input.risk === "low" ? 0 : input.risk === "medium" ? 2 : 4;
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        const text = generate(session.model, session.tokenizer, wordPrompt(clean, evidence.map((e) => e.text)), {
          maxTokens: 48,
          temperature: Math.min(1.4, 0.5 + intensity / 140),
          topK: 16 + Math.floor(intensity / 8),
          seed: (Date.now() + i * 7919) >>> 0,
          stopOnEos: true,
        }).trim();
        if (text && isReadableText(text, 3)) out.push(`Model hypothesis (unverified): ${text}`);
      }
      return { value: out, retrieved: out.slice(0, 4), note: `${out.length} neural alternative(s) from ${session.tokenizer.size} learned word tokens.` };
    });

    const ordered = [...evidence];
    const firstOf = (label: string) => ordered.findIndex((item) => item.label === label);
    const prioritize = (label: string) => {
      const index = firstOf(label);
      if (index > 0) ordered.unshift(ordered.splice(index, 1)[0]);
    };
    if (input.strategy === "dictionary-first") prioritize("Dictionary");
    else if (input.strategy === "dataset-first") {
      const index = ordered.findIndex((item) => item.label.startsWith("Dataset"));
      if (index > 0) ordered.unshift(ordered.splice(index, 1)[0]);
    } else if (input.strategy === "grammar-first") prioritize("Grammar");

    const simulatedAnswer = experimentalResult?.answer ?? (ordered.length
      ? ordered[0].text
      : "No supporting information found in local data. This is a simulation only; nothing was added to the main application.");
    const alternatives = selectSandboxAlternatives({
      risk: input.risk,
      alternatives: [
        ...(experimentalResult ? experimentalResult.alternatives : []),
        ...modelAlternatives,
        ...(!experimentalResult ? ordered.slice(1).map((item) => `${item.label}: ${item.text}`) : []),
      ],
      evidence: [...ordered.map((item) => item.text), ...modelAlternatives],
    });
    trace.runStage("Compare outputs", "Compared the selected simulation against the generated alternatives without changing live data.", ["Simulated answer", "Alternatives"], () => ({
      value: alternatives,
      retrieved: [simulatedAnswer.slice(0, 120), ...alternatives.slice(0, 4).map((a) => a.slice(0, 120))],
      note: `${alternatives.length} alternative(s) with risk ${input.risk} and intensity ${intensity}%.`,
    }));
    const stamp = now();
    const experiment: SandboxExperiment = {
      id: makeId(), name: input.name.trim() || `Experiment ${stamp.slice(11, 19)}`, risk: input.risk,
      strategy: input.strategy, prompt: clean, simulatedAnswer, alternatives,
      sources: [...ordered.map((item) => item.label), ...(modelAlternatives.length ? ["Word model"] : [])],
      mode: experimentalResult || modelAlternatives.length ? "experimental" : "grounded",
      creativity: experimentalResult || modelAlternatives.length ? intensity : undefined,
      knownFacts: experimentalResult?.knownFacts,
      hypotheses: [...(experimentalResult?.hypotheses ?? []), ...modelAlternatives],
      analysis: `Strategy: ${input.strategy} · Risk: ${input.risk} · Intensity: ${intensity}% · Mode: ${experimentalResult || modelAlternatives.length ? "experimental" : "grounded"} · ${evidence.length} local evidence item(s). ` +
        `Sentence pattern: ${analysis.pattern}. Matched dictionary words: ${dictMatches.map((m) => m.word.word).join(", ") || "none"}. ` +
        `Simulated only — no model weights, memories or user data were changed.`,
      proposal: input.proposal, status: "draft", createdAt: stamp, updatedAt: stamp,
    };
    trace.finish(simulatedAnswer, {
      concepts: extractWords(clean).slice(0, 10),
      approaches: [
        { name: "Retrieved evidence", selected: ordered.length > 0, reason: `${ordered.length} local evidence item(s) retrieved.` },
        { name: "Word-level alternatives", selected: modelAlternatives.length > 0, reason: modelAlternatives.length ? `${modelAlternatives.length} neural continuations sampled in isolation.` : "Model is untrained or disabled." },
        { name: "Unverified hypotheses", selected: Boolean(experimentalResult), reason: experimentalResult ? "Hypotheses are labelled and are not facts." : "Hypothesis mode was disabled." },
      ],
      selected: experimentalResult ? "Unverified hypotheses" : modelAlternatives.length ? "Word-level alternatives" : "Retrieved evidence",
      uncertainties: ["Sandbox output is exploratory and was not applied to live data.", ...(modelAlternatives.length ? [] : ["No trained word model was available for neural alternatives."])],
      construction: `Evidence was collected from ${evidence.length} local item(s); ${alternatives.length} alternative(s) were compared in an isolated simulation.`,
    }, "complete");
    setSandboxExperiments((prev) => [experiment, ...prev].slice(0, 50));
    logActivity("success", `Sandbox experiment "${experiment.name}" simulated (isolated).`);
    return experiment;
  }, [logActivity]);

  const decideSandboxExperiment = useCallback((id: string, decision: "approved" | "rejected") => {
    const experiment = sandboxExperimentsRef.current.find((item) => item.id === id);
    if (!experiment || experiment.status !== "draft") return;
    if (decision === "approved" && experiment.proposal) {
      const proposal = experiment.proposal;
      if (proposal.type === "dictionary" && proposal.word) {
        addDictionaryWord({
          word: proposal.word, definition: proposal.definition ?? "", partOfSpeech: proposal.partOfSpeech ?? "other",
          example: proposal.example ?? "", related: [],
        });
      } else if (proposal.type === "knowledge" && proposal.title) {
        addKnowledge({ title: proposal.title, category: proposal.category ?? "General", content: proposal.content ?? "" });
      }
    }
    setSandboxExperiments((prev) => prev.map((item) => item.id === id
      ? { ...item, status: decision, updatedAt: now() } : item));
    logActivity(decision === "approved" ? "success" : "warning",
      `Sandbox experiment "${experiment.name}" ${decision}.`);
  }, [addDictionaryWord, addKnowledge, logActivity]);

  const deleteSandboxExperiment = useCallback((id: string) => {
    setSandboxExperiments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  /* ------------------------- memory & learning ------------------------- */
  const addMemory = useCallback((input: {
    content: string; kind?: MemoryKind; conversationId?: string | null;
    source?: Memory["source"]; sourceMessageId?: string;
  }) => {
    const content = input.content.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!content) throw new Error("Memory content cannot be empty.");
    const hash = memoryHash(content);
    const existing = memoriesRef.current.find((m) => !m.supersededBy && m.hash === hash);
    if (existing) return existing;
    const timestamp = now();
    const memory: Memory = {
      id: makeId(), content, kind: input.kind ?? "explicit",
      conversationId: input.conversationId === undefined ? null : input.conversationId,
      source: input.source ?? "manual", sourceMessageId: input.sourceMessageId,
      hash, createdAt: timestamp, updatedAt: timestamp, recallCount: 0,
    };
    const next = [memory, ...memoriesRef.current];
    memoriesRef.current = next;
    setMemories(next);
    logActivity("success", `Memory saved: ${memory.content.slice(0, 64)}`);
    return memory;
  }, [logActivity]);

  const updateMemory = useCallback((id: string, patch: Partial<Pick<Memory, "content" | "kind" | "conversationId">>) => {
    const next = memoriesRef.current.map((m) => {
      if (m.id !== id) return m;
      const content = patch.content === undefined ? m.content : patch.content.replace(/\s+/g, " ").trim().slice(0, 240);
      if (!content) return m;
      return {
        ...m,
        content,
        kind: patch.kind ?? m.kind,
        conversationId: patch.conversationId === undefined ? m.conversationId : patch.conversationId,
        hash: memoryHash(content),
        updatedAt: now(),
      };
    });
    memoriesRef.current = next;
    setMemories(next);
    logActivity("info", "Memory updated.");
  }, [logActivity]);

  const deleteMemory = useCallback((id: string) => {
    const next = memoriesRef.current.filter((m) => m.id !== id);
    memoriesRef.current = next;
    setMemories(next);
    logActivity("warning", "Memory deleted.");
  }, [logActivity]);

  const recordEdit = useCallback((edit: Omit<LearningEdit, "id" | "createdAt">) => {
    const entry: LearningEdit = { ...edit, id: makeId(), createdAt: now() };
    const next = [entry, ...learningEditsRef.current].slice(0, 400);
    learningEditsRef.current = next;
    setLearningEdits(next);
    logActivity("info", `Learned information changed: ${edit.targetType}/${edit.field}.`);
  }, [logActivity]);

  const updateTrainingExample = useCallback((id: string, patch: { question?: string; answer?: string }, reason: string) => {
    const current = examplesRef.current.find((example) => example.id === id);
    if (!current) return;
    const question = patch.question === undefined ? current.question : patch.question.replace(/\s+/g, " ").trim().slice(0, 400);
    const answer = patch.answer === undefined ? current.answer : patch.answer.replace(/\s+/g, " ").trim().slice(0, 600);
    if (!question || !answer) return;
    const next = examplesRef.current.map((example) => example.id === id ? {
      ...example, question, answer, text: trainingText(buildLocalPrompt({ message: question, history: [] }), answer),
    } : example);
    examplesRef.current = next;
    setTrainingExamples(next);
    if (question !== current.question) recordEdit({ targetType: "training_example", targetId: id, field: "question", before: current.question, after: question, reason });
    if (answer !== current.answer) recordEdit({ targetType: "training_example", targetId: id, field: "answer", before: current.answer, after: answer, reason });
  }, [recordEdit]);

  const updateCorrection = useCallback((id: string, patch: { correctedAnswer?: string; explanation?: string }, reason: string) => {
    const current = correctionsRef.current.find((item) => item.id === id);
    if (!current) return;
    const correctedAnswer = patch.correctedAnswer === undefined ? current.correctedAnswer : patch.correctedAnswer.replace(/\s+/g, " ").trim().slice(0, 600);
    if (!correctedAnswer) return;
    const explanation = patch.explanation === undefined ? current.explanation : patch.explanation.replace(/\s+/g, " ").trim().slice(0, 400);
    const stamp = now();
    const answerChanged = correctedAnswer !== current.correctedAnswer;

    // Patch the dictionary id if this record was created before links were stored.
    let dictionaryId = current.dictionaryId;
    if (answerChanged && !dictionaryId) {
      const oldDefinition = definitionFromCorrection(current.correctedAnswer);
      dictionaryId = dictionaryRef.current.find((word) =>
        word.source === "feedback" && word.definition === oldDefinition)?.id;
    }
    const next = correctionsRef.current.map((item) => item.id === id
      ? { ...item, correctedAnswer, explanation, dictionaryId: dictionaryId ?? item.dictionaryId, updatedAt: stamp } : item);
    correctionsRef.current = next;
    setCorrections(next);

    if (answerChanged) {
      recordEdit({ targetType: "correction", targetId: id, field: "correctedAnswer", before: current.correctedAnswer, after: correctedAnswer, reason });
      if (current.exampleId) updateTrainingExample(current.exampleId, { answer: correctedAnswer }, reason);

      // Update the linked dictionary entry in place. Editing a correction must
      // not leave a stale definition behind or create a second rule.
      const linked = dictionaryRef.current.find((word) => word.id === dictionaryId);
      if (linked) {
        const beforeDefinition = linked.definition;
        const afterDefinition = definitionFromCorrection(correctedAnswer);
        const nextDictionary = dictionaryRef.current.map((word) => word.id === linked.id
          ? { ...word, definition: afterDefinition, updatedAt: stamp } : word);
        dictionaryRef.current = nextDictionary;
        setDictionary(nextDictionary);
        if (beforeDefinition !== afterDefinition) {
          recordEdit({ targetType: "dictionary", targetId: linked.id, field: "definition", before: beforeDefinition, after: afterDefinition, reason });
        }
      }
      if (current.memoryId) {
        const beforeMemory = `Correct answer to "${current.question}": ${current.correctedAnswer}`.slice(0, 240);
        const memoryContent = `Correct answer to "${current.question}": ${correctedAnswer}`.slice(0, 240);
        const nextMemories = memoriesRef.current.map((memory) => memory.id === current.memoryId
          ? { ...memory, content: memoryContent, hash: memoryHash(memoryContent), updatedAt: stamp } : memory);
        if (nextMemories.some((memory, i) => memory.content !== memoriesRef.current[i].content)) {
          memoriesRef.current = nextMemories;
          setMemories(nextMemories);
          recordEdit({ targetType: "memory", targetId: current.memoryId, field: "content", before: beforeMemory, after: memoryContent, reason });
        }
      }
      if (current.feedbackId) {
        const nextFeedback = feedbackRef.current.map((item) => item.id === current.feedbackId
          ? { ...item, correction: correctedAnswer } : item);
        feedbackRef.current = nextFeedback;
        setFeedback(nextFeedback);
        recordEdit({ targetType: "feedback", targetId: current.feedbackId, field: "correction", before: current.correctedAnswer, after: correctedAnswer, reason });
      }
    }
    if (explanation !== current.explanation) {
      recordEdit({ targetType: "correction", targetId: id, field: "explanation", before: current.explanation, after: explanation, reason });
      if (current.feedbackId) {
        const nextFeedback = feedbackRef.current.map((item) => item.id === current.feedbackId
          ? { ...item, explanation } : item);
        feedbackRef.current = nextFeedback;
        setFeedback(nextFeedback);
      }
    }
  }, [recordEdit, updateTrainingExample]);

  const submitFeedback = useCallback((input: {
    conversationId: string; userMessageId: string; assistantMessageId: string;
    userMessage: string; assistantResponse: string; rating: FeedbackRating;
    explanation?: string; correction?: string;
  }) => {
    const correction = (input.correction ?? "").trim();
    const feedbackId = makeId();
    const correctionId = correction ? makeId() : undefined;
    const timestamp = now();
    const entry: Feedback = {
      id: feedbackId,
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      userMessage: input.userMessage,
      assistantResponse: input.assistantResponse,
      rating: input.rating,
      explanation: (input.explanation ?? "").trim(),
      correction,
      issue: FEEDBACK_NOTES[input.rating].issue,
      improvement: FEEDBACK_NOTES[input.rating].improvement,
      status: "pending",
      createdAt: timestamp,
      correctionId,
      trainingExampleIds: [],
    };
    const nextFeedback = [entry, ...feedbackRef.current];
    feedbackRef.current = nextFeedback;
    setFeedback(nextFeedback);

    if (correction && correctionId) {
      const record: Correction = {
        id: correctionId, feedbackId, conversationId: input.conversationId,
        question: input.userMessage, originalAnswer: input.assistantResponse,
        correctedAnswer: correction, explanation: entry.explanation,
        status: "pending", createdAt: timestamp, updatedAt: timestamp,
      };
      const nextCorrections = [record, ...correctionsRef.current];
      correctionsRef.current = nextCorrections;
      setCorrections(nextCorrections);
    }
    // A correction such as "Enormous means very large." becomes an identifiable,
    // reviewable dictionary entry. It is immediately retrievable but stays
    // marked as a user correction until the user approves it.
    const definitionMatch = correction.match(/^\s*([A-Za-z][\w'-]{1,30})\s+(?:means|is defined as|is)\s+(.{3,200}?)[.!]?\s*$/i);
    if (definitionMatch) {
      const name = definitionMatch[1];
      const definition = definitionMatch[2].trim();
      const existing = dictionaryRef.current.find((word) => normalizeWord(word.word) === normalizeWord(name));
      const dictionaryEntry = addDictionaryWord({
        word: name, definition,
        partOfSpeech: existing?.partOfSpeech ?? "noun",
        example: existing?.example ?? input.userMessage,
        related: existing?.related ?? [], synonyms: existing?.synonyms ?? [],
        source: "feedback", reviewStatus: "pending",
      });
      if (correctionId) {
        const linked = correctionsRef.current.map((item) => item.id === correctionId
          ? { ...item, dictionaryId: dictionaryEntry.id } : item);
        correctionsRef.current = linked;
        setCorrections(linked);
      }
      // The corrected meaning immediately replaces older vocabulary memories
      // for the same word, so DavidAI stops repeating the rejected definition.
      const corrected = addMemory({
        content: `Vocabulary: ${name} means ${definition.charAt(0).toLowerCase()}${definition.slice(1)}`.slice(0, 240),
        kind: "vocabulary", source: "correction",
      });
      const wordKey = normalizeWord(name);
      const outdated = memoriesRef.current
        .filter((memory) => memory.id !== corrected.id && !memory.supersededBy && memory.kind === "vocabulary"
          && normalizeWord(memory.content).includes(wordKey))
        .map((memory) => memory.id);
      if (outdated.length) {
        const stamp = now();
        const updated = memoriesRef.current.map((memory) => outdated.includes(memory.id)
          ? { ...memory, supersededBy: corrected.id, updatedAt: stamp } : memory);
        memoriesRef.current = updated;
        setMemories(updated);
      }
    }

    logActivity("success", definitionMatch
      ? "Feedback saved. The corrected definition is in the dictionary and marked as a user correction awaiting review."
      : correction
        ? "Feedback and correction saved for review. Nothing changes in the model until a correction is approved and training is started."
        : "Feedback saved.");
    return entry;
  }, [addDictionaryWord, addMemory, logActivity]);

  const approveCorrection = useCallback((id: string) => {
    const correction = correctionsRef.current.find((c) => c.id === id);
    if (!correction || correction.status === "approved") return;
    const timestamp = now();

    let example = exampleFromCorrection(correction);
    const existingExample = examplesRef.current.find((e) => e.hash === example.hash);
    example = existingExample ?? { ...example, id: makeId(), createdAt: timestamp };
    if (!existingExample) {
      const nextExamples = [example, ...examplesRef.current];
      examplesRef.current = nextExamples;
      setTrainingExamples(nextExamples);
    }

    const memory = addMemory({
      content: `Correct answer to "${correction.question}": ${correction.correctedAnswer}`.slice(0, 240),
      kind: "correction",
      conversationId: null,
      source: "correction",
    });

    const questionKey = normalizeForHash(correction.question);
    const lexical = retrieveLearningContext(correction.question, {
      memories: memoriesRef.current.filter((m) => m.id !== memory.id),
    }, { maxItems: 3, maxChars: 2000 }).map((item) => item.sourceId);
    // Always retire earlier correction memories for the same question, even when
    // lexical retrieval would miss them. The newest approved mistake wins.
    const sameQuestion = memoriesRef.current.filter((m) => {
      if (m.supersededBy || m.id === memory.id || m.kind !== "correction") return false;
      const match = m.content.match(/^Correct answer to "(.+)":/);
      return !!match && normalizeForHash(match[1]) === questionKey;
    }).map((m) => m.id);
    const outdated = Array.from(new Set([...lexical, ...sameQuestion]));
    const nextMemories = memoriesRef.current.map((m) => outdated.includes(m.id)
      ? { ...m, supersededBy: memory.id, updatedAt: timestamp }
      : m);
    memory.supersedes = outdated;
    memoriesRef.current = nextMemories;
    setMemories(nextMemories);

    const nextCorrections = correctionsRef.current.map((c) => c.id === id
      ? { ...c, status: "approved" as const, exampleId: example.id, memoryId: memory.id, updatedAt: timestamp }
      : c);
    correctionsRef.current = nextCorrections;
    setCorrections(nextCorrections);

    const nextFeedback = feedbackRef.current.map((f) => f.id === correction.feedbackId
      ? {
        ...f, status: "approved" as const, reviewedAt: timestamp, correctionId: correction.id,
        trainingExampleIds: Array.from(new Set([...f.trainingExampleIds, example.id])),
      }
      : f);
    feedbackRef.current = nextFeedback;
    setFeedback(nextFeedback);

    // Learning that is real but separate from weights: approved corrections add
    // concept associations. The neural model changes only on explicit training.
    const correctionEdges = edgesFromCorrection(correction);
    const learnedEdges = mergeConceptEdges(conceptEdgesRef.current, correctionEdges);
    if (learnedEdges.length !== conceptEdgesRef.current.length
      || learnedEdges.some((edge, index) => edge.weight !== conceptEdgesRef.current[index]?.weight)) {
      conceptEdgesRef.current = learnedEdges;
      setConceptEdges(learnedEdges);
    }

    // Only an approved correction becomes persistent brain knowledge. Submitting
    // feedback alone leaves it pending in the local review queue.
    void fetch("/api/brain/corrections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: correction.conversationId,
        userMessageId: correction.feedbackId,
        assistantMessageId: correction.id,
        userMessage: correction.question,
        assistantResponse: correction.originalAnswer,
        correction: correction.correctedAnswer,
      }),
    }).catch(() => undefined);

    logActivity("success", `Correction approved. It is now in memory, a real training example is available, and ${correctionEdges.length} concept link(s) were learned. Model weights are unchanged until training.`);
  }, [addMemory, logActivity]);

  const rejectCorrection = useCallback((id: string) => {
    const correction = correctionsRef.current.find((c) => c.id === id);
    if (!correction) return;
    const timestamp = now();
    const nextCorrections = correctionsRef.current.map((c) => c.id === id
      ? { ...c, status: "rejected" as const, updatedAt: timestamp }
      : c);
    correctionsRef.current = nextCorrections;
    setCorrections(nextCorrections);
    const nextFeedback = feedbackRef.current.map((f) => f.id === correction.feedbackId
      ? { ...f, status: "rejected" as const, reviewedAt: timestamp }
      : f);
    feedbackRef.current = nextFeedback;
    setFeedback(nextFeedback);
    // Rejecting must remove every derived artifact, not just flip the status.
    // Otherwise a rejected definition can still be retrieved or trained on.
    if (correction.dictionaryId) {
      const nextDictionary = dictionaryRef.current.map((word) => word.id === correction.dictionaryId
        ? { ...word, reviewStatus: "rejected" as const, updatedAt: timestamp }
        : word);
      dictionaryRef.current = nextDictionary;
      setDictionary(nextDictionary);
    }
    if (correction.memoryId) {
      const nextMemories = memoriesRef.current.map((item) => item.id === correction.memoryId
        ? { ...item, supersededBy: correction.id, updatedAt: timestamp }
        : item);
      memoriesRef.current = nextMemories;
      setMemories(nextMemories);
    }
    logActivity("warning", "Correction rejected. Its dictionary entry and memory were disabled for retrieval and training.");
  }, [logActivity]);

  const deleteFeedback = useCallback((id: string) => {
    const target = feedbackRef.current.find((f) => f.id === id);
    const correctionIds = new Set<string>();
    const exampleIds = new Set<string>();
    if (target?.correctionId) correctionIds.add(target.correctionId);
    for (const correction of correctionsRef.current) {
      if (correction.feedbackId === id) {
        correctionIds.add(correction.id);
        if (correction.exampleId) exampleIds.add(correction.exampleId);
        if (correction.memoryId) {
          const nextMemories = memoriesRef.current.filter((m) => m.id !== correction.memoryId);
          memoriesRef.current = nextMemories;
          setMemories(nextMemories);
        }
      }
    }
    const nextFeedback = feedbackRef.current.filter((f) => f.id !== id);
    feedbackRef.current = nextFeedback;
    setFeedback(nextFeedback);
    const nextCorrections = correctionsRef.current.filter((c) => !correctionIds.has(c.id));
    correctionsRef.current = nextCorrections;
    setCorrections(nextCorrections);
    const nextExamples = examplesRef.current.filter((e) => !exampleIds.has(e.id));
    examplesRef.current = nextExamples;
    setTrainingExamples(nextExamples);
    logActivity("warning", "Feedback record deleted.");
  }, [logActivity]);

  const finalizeLearningSession = useCallback((sessionId: string, loss: number | null, validationLoss: number | null) => {
    const pending = pendingLearningRef.current?.id === sessionId
      ? pendingLearningRef.current
      : learningSessionsRef.current.find((s) => s.id === sessionId);
    if (!pending) return;
    const nextVersion = versionsRef.current.length ? Math.max(...versionsRef.current.map((v) => v.version)) + 1 : 1;
    let checkpointId = "";
    try {
      const meta = saveCheckpoint(`Feedback v${nextVersion} — ${new Date().toLocaleString()}`);
      checkpointId = meta.id;
    } catch (e) {
      logActivity("error", `Training finished but the checkpoint could not be saved: ${e instanceof Error ? e.message : e}`);
    }
    const timestamp = now();
    if (!checkpointId) {
      const failed = learningSessionsRef.current.map((s) => s.id === sessionId
        ? { ...s, status: "error" as const, error: "Checkpoint save failed", finishedAt: timestamp }
        : s);
      learningSessionsRef.current = failed;
      setLearningSessions(failed);
      pendingFinalizeRef.current = null;
      pendingLearningRef.current = null;
      return;
    }
    const activeSession = sessionRef.current;
    const version: ModelVersion = {
      id: makeId(), version: nextVersion, createdAt: timestamp, sessionId, checkpointId,
      source: "feedback", step: trainingRef.current.step, loss, validationLoss,
      vocabSize: activeSession?.tokenizer.size ?? config.vocabSize,
      config: activeSession ? { ...activeSession.model.config } : { ...config },
      exampleIds: [...pending.exampleIds],
    };
    const nextVersions = [...versionsRef.current, version];
    versionsRef.current = nextVersions;
    setModelVersions(nextVersions);
    const nextSessions = learningSessionsRef.current.map((s) => s.id === sessionId
      ? {
        ...s, status: "complete" as const, finishedAt: timestamp, steps: trainingRef.current.step,
        finalLoss: loss, finalValidationLoss: validationLoss, checkpointId, modelVersion: nextVersion,
        lossHistory: [...trainingRef.current.lossHistory],
        validationHistory: [...trainingRef.current.validationHistory],
      }
      : s);
    learningSessionsRef.current = nextSessions;
    setLearningSessions(nextSessions);
    const nextExamples = examplesRef.current.map((e) => pending.exampleIds.includes(e.id)
      ? { ...e, usedInSessionIds: Array.from(new Set([...e.usedInSessionIds, sessionId])) }
      : e);
    examplesRef.current = nextExamples;
    setTrainingExamples(nextExamples);
    pendingFinalizeRef.current = null;
    pendingLearningRef.current = null;
    logActivity("success", `Model version ${nextVersion} trained on ${pending.exampleIds.length} approved example(s) and checkpointed.`);
  }, [config, logActivity, saveCheckpoint]);

  useEffect(() => {
    if (pendingLearningRef.current) {
      pendingFinalizeRef.current = (loss, validationLoss) => finalizeLearningSession(pendingLearningRef.current!.id, loss, validationLoss);
    }
  }, [finalizeLearningSession]);

  const startFeedbackTraining = useCallback((stepCount?: number) => {
    if (runningRef.current || trainingRef.current.status === "running" || trainingRef.current.status === "paused") {
      throw new Error("Stop the current training run before retraining with feedback.");
    }
    const approved = correctionsRef.current.filter((c) => c.status === "approved" && c.exampleId);
    const examples = examplesRef.current.filter((e) => approved.some((c) => c.exampleId === e.id));
    if (!examples.length) throw new Error("Approve at least one correction before feedback training.");

    const datasetTexts = selectedDatasetIds
      .map((id) => datasetsRef.current.find((d) => d.id === id)?.content ?? "")
      .filter(Boolean);
    const memoryTexts = memoriesRef.current
      .filter((m) => !m.supersededBy)
      .map((m) => `[Memory] ${m.content}`);
    const knowledgeTexts = knowledgeRef.current
      .filter((k) => k.content.trim())
      .map((k) => `[Knowledge: ${k.title}] ${k.content}`);
    // Approved corrections and the user's own Q&A pairs are deliberately repeated:
    // in a small from-scratch model a single example among ~28k tokens is otherwise
    // never learned. This oversampling is real data duplication, not fake feedback.
    const correctionTexts = examples.flatMap((example) => Array(12).fill(example.text));
    const conversationTexts = conversationPairs(datasetTexts)
      .flatMap((pair) => Array(6).fill(`${buildLocalPrompt({ message: pair.question, history: [], maxChars: 700 })} ${pair.answer}</s>`));
    const allTexts = [...datasetTexts, ...memoryTexts, ...knowledgeTexts, ...conversationTexts, ...correctionTexts];
    if (!allTexts.length) throw new Error("No training corpus is available.");

    let backupCheckpointId: string | undefined;
    if (sessionRef.current) {
      backupCheckpointId = saveCheckpoint(`Backup before feedback training — ${new Date().toLocaleString()}`).id;
    }

    const tokenizer = Tokenizer.build(allTexts);
    const cfg: ModelConfig = { ...config, vocabSize: tokenizer.size };
    const error = validateConfig(cfg);
    if (error) throw new Error(error);
    const seed = seedFrom(JSON.stringify(cfg), ...allTexts, "feedback-training");
    const session = new TrainingSession(new Transformer(cfg, seed), tokenizer, settingsRef.current.learningRate, seed ^ 0x9e3779b9);
    const prepared = prepareSessionData(session, [], allTexts);
    if (!prepared.ok) throw new Error(prepared.reason);

    sessionRef.current = session;
    setConfig(cfg);
    setModelReady(true);
    setActiveCheckpointId(null);
    accumulatedRef.current = 0;
    stepTimesRef.current = [];
    runStartStepRef.current = 0;

    const sessionId = makeId();
    const record: LearningSession = {
      id: sessionId,
      startedAt: now(),
      status: "running",
      steps: 0,
      exampleIds: examples.map((e) => e.id),
      trainExampleIds: examples.map((e) => e.id),
      validationExampleIds: examples.map((e) => e.id),
      lossHistory: [],
      validationHistory: [],
      finalLoss: null,
      finalValidationLoss: null,
      backupCheckpointId,
    };
    const nextSessions = [...learningSessionsRef.current, record];
    learningSessionsRef.current = nextSessions;
    setLearningSessions(nextSessions);
    pendingLearningRef.current = record;
    pendingFinalizeRef.current = (loss, validationLoss) => finalizeLearningSession(sessionId, loss, validationLoss);

    const steps = Math.max(1, Math.floor(finite(stepCount, settingsRef.current.feedbackTrainingSteps)));
    session.setLearningRate(settingsRef.current.learningRate);
    segmentStartRef.current = Date.now();
    patchTraining({
      ...DEFAULT_TRAINING_STATE,
      status: "running",
      totalSteps: steps,
      samples: prepared.samples ?? 0,
      batchSize: settingsRef.current.batchSize,
      learningRate: session.optimizer.learningRate,
      logs: [{ id: makeId(), timestamp: now(), level: "info", message: `Feedback training started on ${examples.length} approved example(s).`, step: 0 }],
    });
    runningRef.current = true;
    logActivity("info", `Feedback training started: ${steps} steps on ${examples.length} approved example(s).`);
    void runLoop();
  }, [config, finalizeLearningSession, logActivity, patchTraining, prepareSessionData, runLoop, saveCheckpoint, selectedDatasetIds]);

  const exportLearning = useCallback(() => exportLearningData({
    memories: memoriesRef.current,
    feedback: feedbackRef.current,
    corrections: correctionsRef.current,
    examples: examplesRef.current,
    sessions: learningSessionsRef.current,
    versions: versionsRef.current,
    edits: learningEditsRef.current,
  }), []);

  const exportTrainingDataset = useCallback(() => exportTrainingData(examplesRef.current), []);

  const clearLearning = useCallback(() => {
    for (const key of ["memories", "feedback", "corrections", "trainingExamples", "learningSessions", "modelVersions"]) removeLocal(key);
    memoriesRef.current = []; feedbackRef.current = []; correctionsRef.current = [];
    examplesRef.current = []; learningSessionsRef.current = []; versionsRef.current = [];
    setMemories([]); setFeedback([]); setCorrections([]);
    setTrainingExamples([]); setLearningSessions([]); setModelVersions([]);
    logActivity("warning", "Learning data cleared. Model weights were not changed.");
  }, [logActivity]);

  /* -------------------------- settings & transfer -------------------------- */
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => normalizeSettings({ ...prev, ...patch }, prev));
  }, []);

  const exportData = useCallback(() => {
    const out: Record<string, unknown> = {};
    for (const key of listLocalKeys()) {
      try { out[key] = JSON.parse(window.localStorage.getItem(`davidai:${key}`) ?? "null"); }
      catch { /* ignore malformed keys */ }
    }
    return JSON.stringify({ app: "DavidAI", version: 2, exportedAt: now(), data: out }, null, 2);
  }, []);

  const importData = useCallback((json: string) => {
    const parsed = JSON.parse(json) as { app?: string; data?: Record<string, unknown> };
    if (parsed.app !== "DavidAI" || !parsed.data || typeof parsed.data !== "object") throw new Error("This is not a DavidAI export file.");
    if (parsed.data.model) {
      const error = validateSnapshot(parsed.data.model);
      if (error) throw new Error(`Exported model is invalid: ${error}`);
    }
    for (const [key, value] of Object.entries(parsed.data)) {
      if (!key.startsWith("checkpoint:")) continue;
      const error = validateSnapshot(value);
      if (error) throw new Error(`Exported checkpoint "${key}" is invalid: ${error}`);
    }
    for (const key of [
      "datasets", "checkpoints", "experiments", "knowledge", "activity", "selectedDatasets", "conversations",
      "memories", "feedback", "corrections", "trainingExamples", "learningSessions", "modelVersions",
      "dictionary", "dictionaryRemoved", "sandboxExperiments", "activityTraces", "learningEdits", "conceptEdges",
      "visualConcepts", "imageHistory",
    ]) {
      if (parsed.data[key] !== undefined && !Array.isArray(parsed.data[key])) throw new Error(`Exported ${key} data is malformed.`);
    }
    if (parsed.data.imageSettings !== undefined && (
      !parsed.data.imageSettings || typeof parsed.data.imageSettings !== "object" || Array.isArray(parsed.data.imageSettings)
    )) throw new Error("Exported imageSettings data is malformed.");
    if (parsed.data.imageGalleryMeta !== undefined && (
      !parsed.data.imageGalleryMeta || typeof parsed.data.imageGalleryMeta !== "object" || Array.isArray(parsed.data.imageGalleryMeta)
    )) throw new Error("Exported imageGalleryMeta data is malformed.");
    // Import must be all-or-nothing. A quota failure halfway through used to
    // leave a half-imported, unreadable state and then reload into it.
    const entries = Object.entries(parsed.data);
    const previous = new Map<string, string | null>();
    for (const [key] of entries) previous.set(key, window.localStorage.getItem(`davidai:${key}`));
    const failures: string[] = [];
    for (const [key, value] of entries) {
      const result = writeLocal(key, value);
      if (!result.ok) failures.push(`${key}: ${result.error ?? "storage write failed"}`);
    }
    if (failures.length) {
      for (const [key, raw] of previous) {
        if (raw === null) removeLocal(key);
        else window.localStorage.setItem(`davidai:${key}`, raw);
      }
      throw new Error(`Import failed and existing data was restored. ${failures[0]}`);
    }
    logActivity("success", "Import complete. Reloading application...");
    setTimeout(() => window.location.reload(), 400);
  }, [logActivity]);

  const resetApp = useCallback(() => {
    for (const key of listLocalKeys()) removeLocal(key);
    sessionRef.current = null;
    wordSessionRef.current = null;
    runningRef.current = false;
    window.location.reload();
  }, []);

  const value = useMemo<StoreValue>(() => ({
    hydrated, datasets, checkpoints, experiments, knowledge, dictionary, sandboxExperiments, memories, feedback, corrections,
    trainingExamples, learningSessions, modelVersions, activity, traces, learningEdits, conceptEdges,
    wordModelReady, wordVocabSize, wordParams, wordSteps, wordLoss, wordTraining,
    chatMessages, conversations, setConversations,
    activeConversationId, settings, config, training, modelReady, selectedDatasetIds, activeCheckpointId,
    createConversation, selectConversation, renameConversation, deleteConversation,
    togglePinConversation, moveConversationToFolder, setConversationArchived, updateMessage, deleteMessage,
    setSelectedDatasetIds, setConfigLocal,
    addDataset, addFiles, updateDataset, deleteDataset, findDuplicateDataset, combineDatasets, exportDatasets, importDatasets,
    initModel, startTraining, pauseTraining, resumeTraining, stopTraining,
    initWordModel, trainWordModel, trainWordModelFromFeedback,
    generateText, generateAnswer, setChatMessages, clearChat,
    addMemory, updateMemory, deleteMemory, submitFeedback, approveCorrection, rejectCorrection,
    updateTrainingExample, updateCorrection,
    deleteFeedback, startFeedbackTraining, exportLearning, exportTrainingDataset, clearLearning,
    saveCheckpoint, loadCheckpoint, deleteCheckpoint, exportCheckpoint, importCheckpoint,
    createExperiment, updateExperiment, deleteExperiment,
    addKnowledge, updateKnowledge, deleteKnowledge, knowledgeToDataset,
    addDictionaryWord, updateDictionaryWord, deleteDictionaryWord, importDictionary, reviewDictionaryWord,
    runSandboxExperiment, decideSandboxExperiment, deleteSandboxExperiment,
    updateSettings, exportData, importData, resetApp, logActivity, clearTraces,
    getCombinedText, datasetStats, combinedStats,
  }), [
    hydrated, datasets, checkpoints, experiments, knowledge, dictionary, sandboxExperiments, memories, feedback, corrections,
    trainingExamples, learningSessions, modelVersions, activity, traces, learningEdits, conceptEdges,
    wordModelReady, wordVocabSize, wordParams, wordSteps, wordLoss, wordTraining,
    chatMessages, conversations, setConversations,
    activeConversationId, settings, config, training, modelReady, selectedDatasetIds, activeCheckpointId,
    setChatMessages, createConversation, selectConversation, renameConversation, deleteConversation,
    togglePinConversation, moveConversationToFolder, setConversationArchived, updateMessage, deleteMessage,
    setConfigLocal, addDataset, addFiles, updateDataset, deleteDataset, findDuplicateDataset, combineDatasets, exportDatasets, importDatasets,
    initModel, startTraining, pauseTraining, resumeTraining, stopTraining,
    initWordModel, trainWordModel, trainWordModelFromFeedback,
    generateText, generateAnswer, clearChat,
    addMemory, updateMemory, deleteMemory, submitFeedback, approveCorrection, rejectCorrection,
    updateTrainingExample, updateCorrection,
    deleteFeedback, startFeedbackTraining, exportLearning, exportTrainingDataset, clearLearning,
    saveCheckpoint, loadCheckpoint, deleteCheckpoint, exportCheckpoint, importCheckpoint,
    createExperiment, updateExperiment, deleteExperiment,
    addKnowledge, updateKnowledge, deleteKnowledge, knowledgeToDataset,
    addDictionaryWord, updateDictionaryWord, deleteDictionaryWord, importDictionary, reviewDictionaryWord,
    runSandboxExperiment, decideSandboxExperiment, deleteSandboxExperiment,
    updateSettings, exportData, importData, resetApp, logActivity, clearTraces,
    getCombinedText, datasetStats, combinedStats,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function FiniteStep(value: unknown): number {
  const n = finite(value, 0);
  return Math.max(0, Math.floor(n));
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
