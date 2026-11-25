"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { makeId } from "@/lib/storage";
import { recentTurns } from "@/lib/chat";
import { documentsFromStore, retrieveContext } from "@/lib/rag";
import { proposeMemory, retrieveLearningContext, type LocalAnswerResult } from "@/lib/learning";
import { runWebResearch, understandQuestion } from "@/lib/research/engine";
import { shouldTryWebFallback } from "@/lib/research/fallback";
import { findingToWebEvidence } from "@/lib/research/evidence";
import { findWebEntry, isNewerFinding, webKnowledgeFields } from "@/lib/research/knowledge";
import type { LocalKnowledgeMatch, ResearchActivity, ResearchFinding, SourceSearchResult, WebPage, WebResearchResult } from "@/lib/research/types";
import { ASSISTANT_MODES, type AssistantMode, type ChatAttachment, type ChatMessage, type Conversation, type FeedbackRating } from "@/lib/types";
import { isWebSearchEnabled, modeStrategy, resolveAssistantMode } from "@/lib/brain/modes";
import type { BrainConversation, BrainRetrievalItem } from "@/lib/brain/types";
import type { BrainAnswerResult } from "@/lib/brain/service";
import {
  PageHeader, Card, Button, Badge, Field, Input, Select, Textarea, EmptyState, ErrorBox, ConfirmDialog, timeAgo,
} from "@/components/ui";
import { RichText } from "@/components/RichText";
import { ModelInfoPanel } from "@/components/ModelInfoPanel";
import { useSystemStatus } from "@/lib/use-system-status";

const MODE_LABELS: Record<AssistantMode, string> = {
  auto: "Auto", thinking: "Thinking", research: "Research", creative: "Creative",
  coding: "Coding", learning: "Learning", sandbox: "Sandbox",
};

const MODE_HINTS: Record<AssistantMode, string> = {
  auto: "Chooses retrieval depth, sampling and web use from the question.",
  thinking: "More context, lower randomness and an explicit plan before the answer.",
  research: "Opens real public sources when online; cites what was actually retrieved.",
  creative: "Higher variety and permission to use model ideas when memory is silent.",
  coding: "Precise, lower-temperature answers with language-tagged code.",
  learning: "Teaching style: explanation, simple example and a check of understanding.",
  sandbox: "Experimental: unverified content is clearly labelled as a hypothesis.",
};

const FEEDBACK_OPTIONS: Array<{ rating: FeedbackRating; label: string }> = [
  { rating: "helpful", label: "👍 Good" },
  { rating: "not_helpful", label: "👎 Not helpful" },
  { rating: "incorrect", label: "❌ Incorrect" },
  { rating: "incomplete", label: "◐ Incomplete" },
  { rating: "gibberish", label: "⌁ Gibberish" },
  { rating: "too_complicated", label: "≋ Too complicated" },
  { rating: "not_relevant", label: "↯ Not relevant" },
];

const FEEDBACK_LABELS: Record<FeedbackRating, string> = {
  helpful: "Good response", not_helpful: "Not helpful", incorrect: "Incorrect",
  incomplete: "Incomplete", gibberish: "Gibberish", too_complicated: "Too complicated", not_relevant: "Not relevant",
};

interface FeedbackDraft {
  messageId: string;
  rating: FeedbackRating;
  explanation: string;
  correction: string;
}

export default function ChatPage() {
  const {
    settings, updateSettings, chatMessages, setChatMessages, clearChat, hydrated,
    conversations, setConversations, activeConversationId, createConversation, selectConversation,
    renameConversation, deleteConversation, togglePinConversation, moveConversationToFolder,
    setConversationArchived, deleteMessage,
    datasets, knowledge, memories, corrections, feedback,
    modelReady, training, config, modelVersions, generateAnswer, addMemory, submitFeedback,
    addKnowledge, updateKnowledge, logActivity,
  } = useStore();

  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState(settings.temperature);
  const [maxTokens, setMaxTokens] = useState(Math.min(512, settings.maxTokens));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft | null>(null);
  const [activities, setActivities] = useState<ResearchActivity[]>([]);
  const [lastResearch, setLastResearch] = useState<WebResearchResult | null>(null);
  // Shared with AppShell/SystemStatus: one poller, one source of truth.
  const { brain: brainStatus, online } = useSystemStatus();
  const [brainContext, setBrainContext] = useState<BrainRetrievalItem[]>([]);
  const [brainDraftContext, setBrainDraftContext] = useState<BrainRetrievalItem[]>([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [renameDraft, setRenameDraft] = useState<{ id: string; title: string } | null>(null);
  const [deleteDraft, setDeleteDraft] = useState<{ id: string; title: string } | null>(null);
  const [folderEditor, setFolderEditor] = useState<string | null>(null);
  const [folderText, setFolderText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const brainLoadedRef = useRef(false);

  const documents = useMemo(() => documentsFromStore(datasets, knowledge), [datasets, knowledge]);
  const knowledgePreview = useMemo(
    () => settings.useKnowledge ? retrieveContext(prompt, documents, { maxChunks: 3, maxChars: 900 }).chunks : [],
    [prompt, documents, settings.useKnowledge],
  );
  const memoryPreview = useMemo(
    () => settings.useMemory
      ? retrieveLearningContext(prompt, { memories }, { conversationId: activeConversationId, maxItems: 2, maxChars: 500 })
      : [],
    [prompt, memories, activeConversationId, settings.useMemory],
  );
  const correctionPreview = useMemo(
    () => settings.useCorrections
      ? retrieveLearningContext(prompt, { corrections }, { maxItems: 2, maxChars: 700 })
      : [],
    [prompt, corrections, settings.useCorrections],
  );
  const previewingDraft = prompt.trim().length >= 3;
  const visibleBrainContext = previewingDraft ? brainDraftContext : brainContext;

  const feedbackByAssistant = useMemo(() => new Map(
    feedback.filter((f) => f.conversationId === activeConversationId).map((f) => [f.assistantMessageId, f]),
  ), [feedback, activeConversationId]);

  const folders = useMemo(
    () => Array.from(new Set(conversations.map((c) => c.folderId).filter((id): id is string => !!id))).sort(),
    [conversations],
  );
  const filteredConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    return conversations
      .filter((c) => showArchived || !c.archived)
      .filter((c) => !query || c.title.toLowerCase().includes(query)
        || c.messages.some((m) => m.content.toLowerCase().includes(query)))
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
        || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [conversations, conversationSearch, showArchived]);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }, [chatMessages, busy]);

  useEffect(() => {
    if (!hydrated || !settings.brainAutoSave || brainLoadedRef.current) return;
    brainLoadedRef.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/brain/conversations", { cache: "no-store" });
        const payload = await response.json() as { ok?: boolean; conversations?: BrainConversation[] };
        const remote = payload.ok && Array.isArray(payload.conversations) ? payload.conversations : [];
        if (!remote.length) {
          for (const local of conversations.slice(0, 30)) {
            if (!local.messages.length) continue;
            await fetch("/api/brain/conversations", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ conversation: local }),
            }).catch(() => undefined);
          }
          return;
        }
        const mapped: Conversation[] = remote.map((item) => ({
          id: item.id,
          title: item.title,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          messages: item.messages.filter((message) => message.role === "user" || message.role === "assistant").map((message) => ({
            id: message.id,
            role: message.role as "user" | "assistant",
            content: message.content,
            timestamp: message.createdAt,
          })),
        }));
        setConversations((prev) => {
          const merged = new Map(prev.map((conversation) => [conversation.id, conversation]));
          for (const conversation of merged.size ? mapped : mapped.slice(0, 50)) {
            const current = merged.get(conversation.id);
            if (!current || Date.parse(conversation.updatedAt) > Date.parse(current.updatedAt)) merged.set(conversation.id, conversation);
          }
          return Array.from(merged.values()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 50);
        });
        if (!activeConversationId && mapped[0]) selectConversation(mapped[0].id);
      } catch { /* localStorage remains the fallback */ }
    })();
  }, [activeConversationId, conversations, hydrated, selectConversation, setConversations, settings.brainAutoSave]);

  useEffect(() => {
    if (!hydrated || !settings.brainAutoSave || busy || !activeConversationId) return;
    const conversation = conversations.find((item) => item.id === activeConversationId);
    if (!conversation?.messages.length) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/brain/conversations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation }),
      }).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeConversationId, busy, conversations, hydrated, settings.brainAutoSave]);

  useEffect(() => {
    if (!settings.useLocalLlm || prompt.trim().length < 3) { setBrainDraftContext([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/brain/retrieve", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Draft preview is lexical-only. Starting the embedding server on
          // every keystroke is wasteful; semantic depth runs on Send.
          question: prompt, limit: 3, useSemantic: false,
          includeCorrections: false, includeDocuments: true,
        }),
        signal: controller.signal,
      }).then(async (response) => {
        const payload = await response.json() as { ok?: boolean; items?: BrainRetrievalItem[] };
        if (response.ok && payload.ok) setBrainDraftContext(payload.items ?? []);
      }).catch(() => undefined);
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [prompt, settings.useLocalLlm]);

  const searchWeb = async (query: string, intent: "general" | "news" | "tutorial" | "technical" | "comparison", signal?: AbortSignal): Promise<SourceSearchResult[]> => {
    const response = await fetch("/api/research/search", {
      method: "POST", headers: { "content-type": "application/json", "x-davidai-online": online === false ? "false" : "true" },
      body: JSON.stringify({ query, intent, online: online !== false }), signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? `Search failed (HTTP ${response.status}).`);
    return payload.results as SourceSearchResult[];
  };

  const readWeb = async (url: string, signal?: AbortSignal): Promise<WebPage> => {
    const response = await fetch("/api/research/read", {
      method: "POST", headers: { "content-type": "application/json", "x-davidai-online": online === false ? "false" : "true" },
      body: JSON.stringify({ url, online: online !== false }), signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? `Page read failed (HTTP ${response.status}).`);
    return payload.page as WebPage;
  };

  const saveFinding = (finding: ResearchFinding) => {
    // One evidence boundary for both stores: real page title/URL/service/time,
    // and no instruction-like sentences. Existing localStorage keys are kept.
    const evidence = findingToWebEvidence(finding);
    if (evidence) {
      void fetch("/api/brain/research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(evidence),
      }).catch(() => undefined);
    }
    const existing = findWebEntry(knowledge, finding);
    const fields = webKnowledgeFields(finding);
    if (!fields) {
      setNotice("That page contained no saved statements that passed the untrusted-text filter.");
      return;
    }
    if (!existing) {
      addKnowledge(fields);
      setNotice("Saved to your knowledge base with the source URL and retrieval date.");
      return;
    }
    if (isNewerFinding(existing, finding)) {
      updateKnowledge(existing.id, fields);
      setNotice("Updated the older saved finding with the newer source information.");
    } else {
      setNotice("That finding is already in your knowledge base.");
    }
  };

  const trustSource = (finding: ResearchFinding, trusted: boolean) => {
    addMemory({
      content: `${trusted ? "Trusted" : "Untrusted"} web source: ${finding.hit.title} (${finding.hit.url})`,
      kind: "preference", source: "manual",
    });
    setNotice(trusted ? "Marked that source as trusted in long-term memory." : "Marked that source as untrusted in long-term memory.");
  };

  const uploadAttachments = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of list) {
        if (file.size > 20 * 1024 * 1024) {
          setError(`"${file.name}" is above the 20 MB offline import limit.`);
          continue;
        }
        const pending: ChatAttachment = {
          id: makeId(), name: file.name, mime: file.type || "text/plain",
          size: file.size, kind: "document", status: "pending",
        };
        setAttachments((prev) => [...prev, pending]);
        try {
          const form = new FormData();
          form.append("file", file);
          const response = await fetch("/api/brain/documents", { method: "POST", body: form });
          const payload = await response.json() as { ok?: boolean; result?: { chunks?: number }; error?: string };
          if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Import failed (HTTP ${response.status}).`);
          setAttachments((prev) => prev.map((item) => item.id === pending.id
            ? { ...item, status: "indexed", chunkCount: payload.result?.chunks ?? 0 } : item));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setAttachments((prev) => prev.map((item) => item.id === pending.id
            ? { ...item, status: "error", error: message } : item));
          setError(`"${file.name}" could not be indexed: ${message}`);
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const runGeneration = async (text: string, replaceAssistantId?: string, suppliedHistory?: ReturnType<typeof recentTurns>, edited = false) => {
    // A second click in the same tick would otherwise start two local answers.
    if (controllerRef.current) return;
    setError(null);
    setNotice(null);
    setFeedbackDraft(null);
    setActivities([]);
    setLastResearch(null);
    if (!text.trim()) { setError("Enter a message first."); return; }
    if (!activeConversationId) { setError("No active conversation. Start a new one."); return; }
    const offlineNow = online === false || (online === null && typeof navigator !== "undefined" && !navigator.onLine);
    const resolvedMode = resolveAssistantMode(text, settings.assistantMode, !offlineNow, settings);
    const strategy = modeStrategy(resolvedMode);
    // Web stays off by default. Only an explicit Web Search toggle or an
    // explicitly chosen Research mode may open it — never "auto" inference,
    // and never a claim of research while offline.
    const explicitResearch = settings.assistantMode === "research";
    // The Web Search toggle is an explicit permission for every mode. Mode
    // strategies only change style/depth; auto inference must never open web.
    const webEnabled = isWebSearchEnabled(settings, offlineNow ? false : online);
    const effectiveTemperature = resolvedMode === "auto" ? temperature : strategy.temperature;
    const effectiveMaxTokens = resolvedMode === "auto" ? maxTokens : strategy.maxTokens;
    const effectiveStrict = resolvedMode === "creative" || resolvedMode === "sandbox"
      ? false : settings.strictOfflineMemory && strategy.strict;
    const indexedAttachments = attachments.filter((item) => item.status === "indexed");
    const userMessage = {
      id: makeId(), role: "user" as const, content: text, timestamp: new Date().toISOString(),
      attachments: indexedAttachments, ...(edited ? { edited: true } : {}),
    };
    const assistantId = replaceAssistantId ?? makeId();
    const previousAssistant = replaceAssistantId
      ? chatMessages.find((message) => message.id === replaceAssistantId)
      : undefined;
    const assistantPlaceholder = {
      id: assistantId, role: "assistant" as const, content: "", timestamp: new Date().toISOString(), mode: resolvedMode,
    };
    const history = suppliedHistory ?? recentTurns(chatMessages);

    // Pin every write to the conversation that started this request. If the
    // user switches conversations while the local model is running, an abort
    // must not touch the newly selected conversation.
    const generationConversationId = activeConversationId;
    const updateGenerationMessages = (updater: (messages: ChatMessage[]) => ChatMessage[]) => {
      setConversations((prev) => prev.map((conversation) => conversation.id === generationConversationId
        ? { ...conversation, messages: updater(conversation.messages) }
        : conversation));
    };
    updateGenerationMessages((prev) => replaceAssistantId
      ? prev.map((m) => m.id === replaceAssistantId ? assistantPlaceholder : m)
      : [...prev, userMessage, assistantPlaceholder]);
    setBusy(true);

    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const understood = understandQuestion(text);
      const localMatches: LocalKnowledgeMatch[] = settings.useKnowledge
        ? retrieveContext(text, documents, { maxChunks: 3, maxChars: 1200 }).sources.map((item) => ({ title: item.title, text: item.content }))
        : [];
      let research: WebResearchResult | null = null;
      let researchError: string | null = null;
      let webAttempted = false;
      let contextNote = "";

      const runResearch = async (reason: "requested" | "fallback"): Promise<{ result: WebResearchResult | null; error: string | null }> => {
        webAttempted = true;
        if (offlineNow) {
          setActivities((prev) => [...prev, {
            id: `ra-offline-${makeId()}`, stage: "searching", status: "skipped",
            message: "Web research skipped — device is offline",
            detail: "No search request was sent and no web research is claimed.", at: new Date().toISOString(),
          } as ResearchActivity].slice(-120));
          return { result: null, error: "Offline — no web request was made." };
        }
        setActivities((prev) => [...prev, {
          id: `ra-start-${makeId()}`, stage: "understanding", status: "running",
          message: reason === "fallback"
            ? "Local data was insufficient — trying a web lookup"
            : "Web Search is on — starting research",
          detail: `Question: “${text.slice(0, 80)}”`, at: new Date().toISOString(),
        } as ResearchActivity].slice(-120));
        try {
          const result = await runWebResearch(text, {
            search: searchWeb,
            read: readWeb,
            localKnowledge: localMatches,
            historyContext: history.map((turn) => `${turn.role}: ${turn.content}`).join("\n"),
            onActivity: (entry) => setActivities((prev) => [...prev, entry].slice(-120)),
            signal: controller.signal,
            maxPages: Math.max(strategy.webPages, understood.intent === "comparison" ? 5 : 3),
          });
          setLastResearch(result);
          logActivity("info", `Web research used ${result.citations.length} source(s), ${result.queries.length} quer${result.queries.length === 1 ? "y" : "ies"} for “${text.slice(0, 60)}”.`);
          return { result, error: null };
        } catch (e) {
          if (controller.signal.aborted) throw e;
          const message = e instanceof Error ? e.message : String(e);
          setActivities((prev) => [...prev, {
            id: `ra-error-${makeId()}`, stage: "searching", status: "error",
            message: "Web research failed", detail: message, at: new Date().toISOString(),
          } as ResearchActivity].slice(-120));
          return { result: null, error: message };
        }
      };

      const applyResearchAnswer = (result: WebResearchResult, note: string) => {
        const elapsed = Math.max(0, Date.parse(result.finishedAt) - Date.parse(result.startedAt));
        updateGenerationMessages((prev) => prev.map((m) => m.id === assistantId ? {
          ...m,
          content: result.answer,
          sources: result.citations.map((citation) => `${citation.source}: ${citation.title}`),
          webResearch: result,
          answerMode: "grounded",
          mode: resolvedMode,
          engine: "retrieval",
          localModel: false,
          elapsedMs: elapsed,
          provider: undefined,
          model: undefined,
          memoryIds: [],
          correctionIds: [],
          modelVersion: undefined,
          reasoning: undefined,
          understanding: undefined,
          reasoningPlan: undefined,
          verification: undefined,
          traceId: undefined,
          tokensGenerated: undefined,
          tokensPerSecond: undefined,
        } : m));
        contextNote = note;
      };

      if (webEnabled && (understood.needWeb || explicitResearch)) {
        const attempt = await runResearch("requested");
        research = attempt.result;
        researchError = attempt.error;
      }

      if (research?.usedWeb && research.citations.length > 0) {
        applyResearchAnswer(research, `Web research: ${research.citations.length} source${research.citations.length === 1 ? "" : "s"} cited.`);
      } else {
        let localResult: LocalAnswerResult | null = null;
        let brainResult: BrainAnswerResult | null = null;
        let brainError: string | null = null;

        if (settings.useLocalLlm) {
          try {
            const response = await fetch("/api/brain/answer", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({
                question: text,
                conversationId: activeConversationId,
                history,
                strict: effectiveStrict,
                useLocalModel: true,
                useSemantic: settings.useSemanticRetrieval,
                includeCorrections: settings.useCorrections && strategy.includeCorrections,
                maxTokens: effectiveMaxTokens,
                temperature: effectiveTemperature,
                mode: resolvedMode,
                systemStyle: strategy.style,
                allowWeb: webEnabled,
              }),
              signal: controller.signal,
            });
            const payload = await response.json() as { ok?: boolean; error?: string } & Partial<BrainAnswerResult>;
            if (!response.ok || !payload.ok || !payload.answer) throw new Error(payload.error ?? `Local brain answer failed (HTTP ${response.status}).`);
            brainResult = payload as BrainAnswerResult;
            setBrainContext(brainResult.context ?? []);
            updateGenerationMessages((prev) => prev.map((m) => m.id === assistantId ? {
              ...m,
              content: brainResult!.answer,
              sources: (brainResult!.context ?? []).map((item) => `${item.sourceType}: ${item.title}`),
              memoryIds: (brainResult!.context ?? []).filter((item) => item.sourceType === "knowledge").map((item) => item.sourceId),
              correctionIds: (brainResult!.context ?? []).filter((item) => item.sourceType === "correction").map((item) => item.sourceId),
              localModel: brainResult!.usedLocalModel,
              answerMode: brainResult!.usedLocalModel ? "grounded" : "fallback",
              mode: resolvedMode,
              engine: "local-llm",
              model: brainResult!.model,
              elapsedMs: brainResult!.elapsedMs,
              webResearch: research ?? undefined,
              provider: undefined,
              reasoning: undefined,
              understanding: undefined,
              reasoningPlan: undefined,
              verification: undefined,
              traceId: undefined,
              tokensGenerated: undefined,
              tokensPerSecond: undefined,
            } : m));
            contextNote = brainResult.note;
          } catch (e) {
            if (controller.signal.aborted) throw e;
            brainError = e instanceof Error ? e.message : String(e);
            contextNote = `Local brain answer failed (${brainError}).`;
          }
        }

        if (!brainResult && modelReady) {
          localResult = await generateAnswer(text, activeConversationId, history, controller.signal);
          updateGenerationMessages((prev) => prev.map((m) => m.id === assistantId ? {
            ...m,
            content: localResult!.text,
            sources: localResult!.sources,
            memoryIds: localResult!.memoryItems.map((i) => i.sourceId),
            correctionIds: localResult!.correctionItems.map((i) => i.sourceId),
            modelVersion: localResult!.modelVersion ?? undefined,
            localModel: true,
            answerMode: localResult!.answerMode,
            mode: resolvedMode,
            engine: localResult!.engine,
            reasoning: localResult!.reasoning,
            understanding: localResult!.understanding,
            reasoningPlan: localResult!.reasoningPlan,
            verification: localResult!.verification,
            traceId: localResult!.traceId,
            tokensGenerated: localResult!.tokensGenerated,
            elapsedMs: localResult!.elapsedMs,
            tokensPerSecond: localResult!.tokensPerSecond,
            webResearch: research ?? undefined,
            provider: undefined,
            model: undefined,
          } : m));
          contextNote = researchError
            ? `Web research failed (${researchError}). Answered from local data instead.`
            : research?.usedWeb
              ? "Web pages were opened but no usable statement was found; answered from local data instead."
              : localResult.sources.length
                ? `Used ${localResult.sources.length} local context item${localResult.sources.length === 1 ? "" : "s"}.`
                : "No relevant local context was retrieved.";
        } else if (!brainResult && !modelReady) {
          const honest = offlineNow
            ? "Offline: the installed local model is not ready and no web research was attempted. Nothing was invented."
            : researchError ?? "Web lookup found no sourced answer and no local model is loaded. No answer was invented.";
          updateGenerationMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: honest, webResearch: research ?? undefined, answerMode: "fallback", mode: resolvedMode } : m));
          contextNote = offlineNow ? "Offline; no web request was made." : "Web lookup could not produce a sourced answer.";
        }

        const fallbackMode = Boolean(brainResult) && (brainResult!.context.length === 0 || !brainResult!.usedLocalModel) || brainError
          ? "fallback" as const
          : localResult?.answerMode ?? null;
        if (webEnabled && shouldTryWebFallback(fallbackMode, webAttempted)) {
          const attempt = await runResearch("fallback");
          research = attempt.result;
          researchError = attempt.error;
          if (research?.usedWeb && research.citations.length > 0) {
            applyResearchAnswer(research, `Local data had no reliable answer; web lookup found ${research.citations.length} source${research.citations.length === 1 ? "" : "s"}.`);
          } else if (researchError) {
            contextNote = `Local data had no reliable answer; web lookup failed (${researchError}). Kept the local reply.`;
          } else {
            contextNote = "Local data had no reliable answer and the web lookup found no usable source. Kept the local reply.";
          }
        }
      }
      if (!replaceAssistantId) { setPrompt(""); setAttachments([]); }
      updateSettings({ temperature, maxTokens });

      let memoryNote = "";
      if (!replaceAssistantId) {
        const proposal = proposeMemory(text);
        if (proposal) {
          addMemory({ content: proposal.content, kind: proposal.kind, source: "user" });
          memoryNote = ` Saved a ${proposal.kind} memory.`;
        }
      }
      const modeNote = explicitResearch && !settings.webSearch && webEnabled
        ? " Research mode enabled a real web lookup for this question."
        : "";
      setNotice(`${MODE_LABELS[resolvedMode]} mode · ${contextNote || "Answer generated."}${modeNote}${memoryNote}`);
    } catch (e) {
      // A stopped regeneration must never destroy the answer it replaced.
      if (previousAssistant) {
        updateGenerationMessages((prev) => prev.map((m) => m.id === assistantId ? previousAssistant : m));
      } else {
        updateGenerationMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
      if (controller.signal.aborted) setNotice("Generation stopped.");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      controllerRef.current = null;
      setBusy(false);
    }
  };

  const switchConversation = (id: string) => {
    if (id === activeConversationId) return;
    controllerRef.current?.abort();
    setBusy(false);
    setError(null);
    setNotice(null);
    setFeedbackDraft(null);
    selectConversation(id);
  };

  const startConversation = () => switchConversation(createConversation());

  const lastUserIndex = chatMessages.map((m) => m.role).lastIndexOf("user");
  const lastUser = lastUserIndex >= 0 ? chatMessages[lastUserIndex] : null;
  const lastAssistant = [...chatMessages].reverse().find((m) => m.role === "assistant");

  const precedingUser = (assistantId: string) => {
    const index = chatMessages.findIndex((m) => m.id === assistantId);
    for (let i = index - 1; i >= 0; i--) if (chatMessages[i].role === "user") return chatMessages[i];
    return null;
  };

  const resendEdited = (messageId: string) => {
    const index = chatMessages.findIndex((m) => m.id === messageId);
    if (index < 0 || !editText.trim() || busy) return;
    const prefix = chatMessages.slice(0, index);
    setEditingMessageId(null);
    setChatMessages(prefix);
    void runGeneration(editText, undefined, recentTurns(prefix), true);
  };

  const regenerateAnswer = (assistantId: string) => {
    if (busy) return;
    const user = precedingUser(assistantId);
    if (!user) return;
    const userIndex = chatMessages.findIndex((m) => m.id === user.id);
    void runGeneration(user.content, assistantId, recentTurns(chatMessages.slice(0, userIndex)));
  };

  const confirmDeleteConversation = () => {
    if (!deleteDraft) return;
    deleteConversation(deleteDraft.id);
    void fetch(`/api/brain/conversations?id=${encodeURIComponent(deleteDraft.id)}`, { method: "DELETE" }).catch(() => undefined);
    setNotice(`Deleted conversation “${deleteDraft.title}”.`);
    setDeleteDraft(null);
  };

  const applyFolder = () => {
    if (!folderEditor) return;
    moveConversationToFolder(folderEditor, folderText.trim() || null);
    setFolderEditor(null);
    setFolderText("");
  };

  const openFeedback = (messageId: string, rating: FeedbackRating) => {
    setFeedbackDraft({ messageId, rating, explanation: "", correction: "" });
    setError(null);
  };

  const submitFeedbackDraft = () => {
    if (!feedbackDraft) return;
    const assistant = chatMessages.find((m) => m.id === feedbackDraft.messageId);
    const user = precedingUser(feedbackDraft.messageId);
    if (!assistant || !user || !activeConversationId) { setError("The original exchange for this feedback is no longer available."); return; }
    const entry = submitFeedback({
      conversationId: activeConversationId,
      userMessageId: user.id,
      assistantMessageId: assistant.id,
      userMessage: user.content,
      assistantResponse: assistant.content,
      rating: feedbackDraft.rating,
      explanation: feedbackDraft.explanation,
      correction: feedbackDraft.correction,
    });
    setChatMessages((prev) => prev.map((m) => m.id === assistant.id ? { ...m, feedbackId: entry.id } : m));
    setFeedbackDraft(null);
    setNotice(feedbackDraft.correction.trim()
      ? "Feedback and correction saved. Review and approve it in Learning before it can affect answers or training."
      : "Feedback saved. Thank you.");
  };

  const version = modelVersions.length ? Math.max(...modelVersions.map((v) => v.version)) : 0;
  const offlineNowBadge = online === false || (online === null && typeof navigator !== "undefined" && !navigator.onLine);

  return (
    <>
      <PageHeader
        eyebrow="Local Inference"
        title="AI Chat"
        description={settings.webSearch
          ? "Web Search is on: DavidAI still answers from the local Qwen model and persistent SQLite memory first, then searches free public sources when needed. Every real research operation is labelled; no external AI service or paid API is used."
          : "Offline-first: every conversation is saved to the local SQLite brain, relevant knowledge is retrieved automatically, and Qwen2.5 1.5B runs on this CPU through llama.cpp. With no relevant local memory, DavidAI says so instead of inventing facts."}
        actions={<div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[150px]">
            <Select
              aria-label="AI mode"
              value={settings.assistantMode}
              onChange={(e) => {
                const mode = e.target.value as AssistantMode;
                updateSettings({ assistantMode: mode, chatMode: mode === "sandbox" ? "experimental" : "grounded" });
              }}
              className="py-1.5 text-xs"
            >
              {ASSISTANT_MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABELS[mode]} mode</option>)}
            </Select>
          </div>
          <Button variant={settings.webSearch ? "primary" : "outline"} size="sm" onClick={() => updateSettings({ webSearch: !settings.webSearch })}>
            Web Search · {settings.webSearch ? "on" : "off"}
          </Button>
          <Button
            variant={settings.assistantMode === "research" ? "primary" : "outline"}
            size="sm"
            onClick={() => {
              const enable = settings.assistantMode !== "research";
              updateSettings({ assistantMode: enable ? "research" : "auto", researchMode: enable });
            }}
          >
            Research Mode · {settings.assistantMode === "research" ? "on" : "off"}
          </Button>
          <Badge tone={offlineNowBadge ? "red" : brainStatus?.localModel.modelReady && settings.useLocalLlm ? "green" : modelReady ? "green" : "amber"}>
            {offlineNowBadge ? "OFFLINE · LOCAL ONLY" : brainStatus?.localModel.modelReady && settings.useLocalLlm ? "QWEN LOCAL ACTIVE" : modelReady ? `LOCAL · V${version} · STEP ${training.step}` : "NO LOCAL MODEL"}
          </Badge>
        </div>}
      />

      <ErrorBox message={error} />
      {notice && <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}
      <div className="mb-4 rounded border hairline bg-black/20 px-3 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--muted)]">
        {MODE_LABELS[settings.assistantMode]} mode · {MODE_HINTS[settings.assistantMode]}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card
          className="flex min-h-[620px] flex-col !p-0"
          title="Conversation"
          subtitle={brainStatus?.localModel.executableReady && brainStatus?.localModel.modelReady && settings.useLocalLlm
            ? "Qwen2.5 local · SQLite memory"
            : modelReady ? `Local model · ${config.layers}L/${config.heads}H/${config.dModel}d · ctx ${config.blockSize}` : "Local model not ready"}
        >
          <div className="flex-1 space-y-4 overflow-y-auto p-4" style={{ maxHeight: "min(62vh, 620px)" }}>
            {chatMessages.length === 0 && !busy ? (
              <EmptyState
                title="No conversation yet"
                description="Ask DavidAI anything. Conversations are saved to the local SQLite brain, relevant knowledge is retrieved automatically, and browser storage is an additional cache."
              />
            ) : chatMessages.map((m) => {
              const feedbackRecord = m.feedbackId ? feedbackByAssistant.get(m.feedbackId) : undefined;
              const isDraft = feedbackDraft?.messageId === m.id;
              return (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`message-bubble max-w-[88%] rounded-lg border px-3.5 py-2.5 ${m.role === "user" ? "chat-bubble--user" : "chat-bubble--assistant"}`}>
                    <div className="mono-label mb-1.5 flex items-center justify-between gap-4 text-[9px]">
                      <span>{m.role === "user" ? "YOU" : "DAVIDAI"}</span>
                      {m.role === "assistant" && m.answerMode && (
                        <span className="font-mono normal-case tracking-normal text-[9px]">
                          {m.answerMode === "grounded" ? (m.engine === "generative" ? "GENERATED" : "RETRIEVED EVIDENCE") : m.answerMode === "experimental" ? "HYPOTHESIS" : m.answerMode === "fallback" ? "NO LOCAL ANSWER" : `${m.tokensGenerated ?? 0} tok · ${(m.tokensPerSecond ?? 0).toFixed(1)} tok/s`}
                        </span>
                      )}
                    </div>
                    {m.content
                      ? <RichText content={m.content} className="text-[13px] leading-relaxed text-slate-200" />
                      : <div className="text-[13px] leading-relaxed text-slate-400">{busy ? "DavidAI is thinking…" : ""}</div>}
                    {m.attachments?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1 border-t hairline pt-2">
                        {m.attachments.map((item) => (
                          <span key={item.id} className="rounded border hairline bg-black/20 px-1.5 py-0.5 font-mono text-[9px] text-slate-300">
                            📎 {item.name} · {item.chunkCount ?? 0} chunks
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {m.role === "assistant" && m.mode && (
                      <div className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-cyan-500/70">{MODE_LABELS[m.mode]} strategy</div>
                    )}
                    {m.edited && <div className="mt-1 font-mono text-[9px] text-[var(--muted)]">edited before resend</div>}
                    {m.role === "assistant" && m.sources?.length ? (
                      <details className="luxe-details mt-2 border-t hairline pt-2">
                        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-wider text-cyan-400/80">Sources used · {m.sources.length}</summary>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {m.sources.map((source, i) => <span key={`${source}-${i}`} className="rounded border border-cyan-500/20 bg-cyan-500/5 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">{source}</span>)}
                        </div>
                      </details>
                    ) : null}
                    {m.role === "assistant" && m.webResearch && (
                      <>
                        {m.webResearch.citations.length > 0 ? (
                          <details open className="luxe-details mt-2 border-t hairline pt-2">
                            <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-wider text-cyan-400/80">
                              Web sources · {m.webResearch.citations.length} · retrieved {new Date(m.webResearch.finishedAt).toLocaleTimeString()}
                            </summary>
                            <ol className="mt-2 space-y-2">
                              {m.webResearch.citations.map((citation) => {
                                const finding = m.webResearch?.findings.find((item) => item.hit.url === citation.url);
                                return (
                                  <li key={citation.url} className="rounded border border-cyan-500/15 bg-cyan-500/[0.04] px-2 py-1.5">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-mono text-[9px] text-cyan-400">[{citation.index}]</span>
                                      <a href={citation.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-[11px] text-cyan-300 underline decoration-cyan-500/40 hover:text-cyan-200">
                                        {citation.title}
                                      </a>
                                      <span className="font-mono text-[8px] uppercase text-[var(--muted)]">{citation.source}</span>
                                    </div>
                                    {finding && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        <button onClick={() => saveFinding(finding)} className="focus-ring rounded border hairline px-1.5 py-0.5 font-mono text-[9px] text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300">Save finding</button>
                                        <button onClick={() => trustSource(finding, true)} className="focus-ring rounded border hairline px-1.5 py-0.5 font-mono text-[9px] text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300">Trust source</button>
                                        <button onClick={() => trustSource(finding, false)} className="focus-ring rounded border hairline px-1.5 py-0.5 font-mono text-[9px] text-slate-300 hover:border-red-500/40 hover:text-red-300">Distrust</button>
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ol>
                          </details>
                        ) : null}
                        <details className="luxe-details mt-2 border-t hairline pt-2">
                          <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-wider text-cyan-400/80">
                            Inspect gathered information · {m.webResearch.activities.length} operations
                          </summary>
                          <div className="mt-2 space-y-2">
                            {m.webResearch.queries.length > 0 && (
                              <div className="font-mono text-[9px] text-[var(--muted)]">Queries: {m.webResearch.queries.map((q) => `“${q}”`).join(" · ")}</div>
                            )}
                            {m.webResearch.activities.map((entry) => (
                              <div key={entry.id} className="rounded border hairline bg-black/20 px-2 py-1.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className={`font-mono text-[9px] ${entry.status === "error" ? "text-red-400" : entry.status === "ok" ? "text-emerald-400" : entry.status === "skipped" ? "text-slate-500" : "text-cyan-400"}`}>
                                    {entry.status === "error" ? "✕" : entry.status === "ok" ? "✓" : entry.status === "skipped" ? "–" : "…"} {entry.stage}
                                  </span>
                                  <span className="text-[10px] text-slate-300">{entry.message}</span>
                                </div>
                                {entry.detail && <div className="mt-0.5 break-words font-mono text-[9px] leading-relaxed text-[var(--muted)]">{entry.detail}</div>}
                              </div>
                            ))}
                            {m.webResearch.findings.map((finding) => (
                              <div key={finding.hit.url} className="rounded border hairline bg-black/10 px-2 py-1.5">
                                <div className="truncate font-mono text-[9px] text-cyan-400/80">{finding.hit.source} · {finding.hit.title}</div>
                                {finding.sentences.map((text, i) => <p key={i} className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">“{text}”</p>)}
                              </div>
                            ))}
                            {m.webResearch.errors.length > 0 && (
                              <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 font-mono text-[9px] text-amber-300/80">
                                Errors: {m.webResearch.errors.slice(0, 4).join(" · ")}
                              </div>
                            )}
                          </div>
                        </details>
                      </>
                    )}
                    {m.role === "assistant" && m.reasoning && (
                      <details className="luxe-details mt-2 border-t hairline pt-2">
                        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-wider text-cyan-400/80">Reasoning summary · {m.reasoning.selected}</summary>
                        <div className="mt-2 space-y-2 text-[10px] leading-relaxed text-[var(--muted)]">
                          {m.reasoning.concepts.length > 0 && <div><span className="mono-label">Concepts: </span>{m.reasoning.concepts.join(", ")}</div>}
                          <div><span className="mono-label">Considered: </span>{m.reasoning.approaches.map((a) => `${a.name}${a.selected ? " (selected)" : ""}`).join(" · ")}</div>
                          <div><span className="mono-label">Construction: </span>{m.reasoning.construction}</div>
                          {m.reasoning.uncertainties.length > 0 && <div className="text-amber-300/80"><span className="mono-label">Uncertainties: </span>{m.reasoning.uncertainties.join(" ")}</div>}
                          {m.traceId && <div className="font-mono text-[9px] text-slate-600">Trace {m.traceId} · view in AI Activity Monitor</div>}
                        </div>
                      </details>
                    )}
                    {m.role === "assistant" && (m.understanding || m.reasoningPlan || m.verification) && (
                      <details className="luxe-details mt-2 border-t hairline pt-2">
                        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-wider text-cyan-400/80">Understanding &amp; verification</summary>
                        <div className="mt-2 space-y-2 text-[10px] leading-relaxed text-[var(--muted)]">
                          {m.understanding && (
                            <>
                              <div><span className="mono-label">Interpreted as: </span>{m.understanding.intent}/{m.understanding.questionKind} · confidence {m.understanding.confidence.toFixed(2)}</div>
                              {m.understanding.normalized !== m.understanding.original && <div><span className="mono-label">Normalized: </span>{m.understanding.normalized}</div>}
                              {m.understanding.corrections.length > 0 && <div><span className="mono-label">Corrected: </span>{m.understanding.corrections.map((c) => `${c.from} → ${c.to}`).join(", ")}</div>}
                              {m.understanding.contextTerms.length > 0 && <div><span className="mono-label">Context: </span>{m.understanding.contextTerms.join(", ")}</div>}
                              {m.understanding.ambiguities.length > 0 && <div className="text-amber-300/80"><span className="mono-label">Ambiguities: </span>{m.understanding.ambiguities.join(" ")}</div>}
                            </>
                          )}
                          {m.reasoningPlan && (
                            <>
                              {m.reasoningPlan.subquestions.length > 0 && <div><span className="mono-label">Plan: </span>{m.reasoningPlan.subquestions.join(" · ")}</div>}
                              {m.reasoningPlan.calculation && <div><span className="mono-label">Calculation: </span>{m.reasoningPlan.calculation.expression} = {m.reasoningPlan.calculation.value} <span className="text-slate-600">(parser, not the model)</span></div>}
                              {m.reasoningPlan.contradictions.length > 0 && <div className="text-amber-300/80"><span className="mono-label">Contradictions: </span>{m.reasoningPlan.contradictions.join(" ")}</div>}
                            </>
                          )}
                          {m.verification && (
                            <div><span className="mono-label">Verification: </span>{m.verification.ok ? "passed" : "not fully supported"} · evidence support {Math.round(m.verification.support * 100)}% · question coverage {Math.round(m.verification.coverage * 100)}%{m.verification.reasons.length ? ` · ${m.verification.reasons.join(" ")}` : ""}</div>
                          )}
                        </div>
                      </details>
                    )}
                    {m.role === "user" && !busy && (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-1 border-t hairline pt-2">
                        <button onClick={() => { setEditingMessageId(m.id); setEditText(m.content); }} className="focus-ring rounded px-1 font-mono text-[10px] text-[var(--muted)] hover:text-cyan-300">Edit</button>
                        <button onClick={() => {
                          if (!activeConversationId) return;
                          const index = chatMessages.findIndex((item) => item.id === m.id);
                          setConversations((prev) => prev.map((c) => c.id === activeConversationId
                            ? { ...c, updatedAt: new Date().toISOString(), messages: c.messages.slice(0, index) } : c));
                        }} className="focus-ring rounded px-1 font-mono text-[10px] text-[var(--muted)] hover:text-red-300">Delete</button>
                      </div>
                    )}
                    {m.role === "user" && editingMessageId === m.id && (
                      <div className="mt-2 space-y-2 border-t hairline pt-2">
                        <Textarea rows={3} value={editText} onChange={(e) => setEditText(e.target.value)} className="text-xs" />
                        <div className="flex gap-2">
                          <Button size="sm" variant="primary" disabled={!editText.trim() || busy} onClick={() => resendEdited(m.id)}>Save &amp; resend</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingMessageId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                    {m.role === "assistant" && m.content && (
                      <div className="mt-2 flex flex-wrap items-center gap-1 border-t hairline pt-2">
                        {FEEDBACK_OPTIONS.map((option) => (
                          <button key={option.rating} onClick={() => openFeedback(m.id, option.rating)}
                            className="focus-ring rounded border hairline px-1.5 py-0.5 font-mono text-[10px] text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300">
                            {option.label}
                          </button>
                        ))}
                        <button onClick={() => {
                          if (!navigator.clipboard?.writeText) {
                            setError("Clipboard access was blocked by the browser.");
                            return;
                          }
                          void navigator.clipboard.writeText(m.content)
                            .then(() => setNotice("Response copied to clipboard."))
                            .catch(() => setError("Clipboard access was blocked by the browser."));
                        }} className="focus-ring rounded px-1 font-mono text-[10px] text-[var(--muted)] hover:text-cyan-300">Copy</button>
                        <button onClick={() => regenerateAnswer(m.id)} disabled={busy} className="focus-ring rounded px-1 font-mono text-[10px] text-[var(--muted)] hover:text-cyan-300 disabled:opacity-40">Regenerate</button>
                        <button onClick={() => { if (activeConversationId) deleteMessage(activeConversationId, m.id); }} disabled={busy} className="focus-ring rounded px-1 font-mono text-[10px] text-[var(--muted)] hover:text-red-300 disabled:opacity-40">Delete</button>
                        {feedbackRecord && (
                          <Badge tone={feedbackRecord.rating === "helpful" ? "green" : "red"}>
                            {feedbackRecord.rating === "helpful" ? "recorded +" : feedbackRecord.correction ? `correction ${feedbackRecord.status}` : "recorded −"}
                          </Badge>
                        )}
                      </div>
                    )}
                    {m.role === "assistant" && isDraft && (
                      <div className="mt-2 space-y-2 border-t hairline pt-2">
                        <Field label={`Feedback: ${FEEDBACK_LABELS[feedbackDraft.rating]}`} hint="Write custom feedback. Corrections like “Enormous means very large” become reviewable dictionary entries.">
                          <Textarea rows={2} value={feedbackDraft.explanation} onChange={(e) => setFeedbackDraft({ ...feedbackDraft, explanation: e.target.value })} placeholder="What worked or what went wrong?" className="text-xs" />
                        </Field>
                        <Field label="Suggested correction" hint="Only reviewed and approved corrections become training examples.">
                          <Textarea rows={2} value={feedbackDraft.correction} onChange={(e) => setFeedbackDraft({ ...feedbackDraft, correction: e.target.value })} placeholder="What should DavidAI have answered?" className="text-xs" />
                        </Field>
                        <div className="flex gap-2">
                          <Button size="sm" variant="primary" onClick={submitFeedbackDraft}>Save Feedback</Button>
                          <Button size="sm" variant="ghost" onClick={() => setFeedbackDraft(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {busy && <div className="thinking-line font-mono text-[11px]">{offlineNowBadge ? "offline · retrieving local memory / running Qwen…" : settings.webSearch ? "checking local memory, then real web sources if needed…" : "retrieving local memory / running Qwen…"}</div>}
            <div ref={endRef} />
          </div>

          <div className="border-t hairline p-4">
            <input
              ref={fileInputRef} type="file" multiple className="hidden"
              accept=".txt,.md,.markdown,.json,.csv,.log,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.java,.c,.cpp,.h,.rs,.go,.php,.rb,.sh,.sql,.html,.css,.pdf"
              onChange={(e) => { if (e.target.files?.length) void uploadAttachments(e.target.files); }}
            />
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy || uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? "Indexing…" : "📎 Attach file"}
              </Button>
              <span className="font-mono text-[9px] text-[var(--muted)]">TXT · PDF · Markdown · JSON · CSV · code files are indexed into the local brain</span>
            </div>
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((item) => (
                  <span key={item.id} className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[9px] ${
                    item.status === "indexed" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                      : item.status === "error" ? "border-red-500/30 bg-red-500/5 text-red-300" : "hairline text-slate-300"
                  }`} title={item.error}>
                    📎 {item.name} · {item.status === "indexed" ? `${item.chunkCount ?? 0} chunks` : item.status}
                    <button onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== item.id))} className="focus-ring hover:text-red-300" aria-label={`Remove ${item.name}`}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy) void runGeneration(prompt); } }}
                rows={2}
                placeholder="Ask DavidAI anything (Enter to send, Shift+Enter for newline)"
                className="focus-ring chat-composer composer-input luxe-field flex-1 rounded-lg px-3 py-2 text-xs"
              />
              <div className="flex flex-col gap-2 self-end">
                <Button variant="primary" onClick={() => void runGeneration(prompt)} disabled={busy || !prompt.trim()}>Send</Button>
                {busy ? (
                  <Button variant="danger" onClick={() => controllerRef.current?.abort()}>Stop</Button>
                ) : (
                  <Button variant="outline" disabled={!lastUser || !lastAssistant} onClick={() => { if (lastUser && lastAssistant) void runGeneration(lastUser.content, lastAssistant.id, recentTurns(chatMessages.slice(0, lastUserIndex))); }}>Regenerate</Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {settings.researchMode && (
            <Card title="Live Research Activity" subtitle="Real searches, pages and extracted statements">
              {activities.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  {settings.webSearch ? "Ask a question to see each research operation here." : "Web Search is off. If local data cannot answer, the automatic web fallback appears here."}
                </p>
              ) : (
                <div className="max-h-[340px] space-y-1.5 overflow-y-auto pr-1">
                  {activities.map((entry) => (
                    <div key={entry.id} className="rounded border hairline bg-black/20 px-2 py-1.5">
                      <div className="flex items-start gap-1.5">
                        <span className={`font-mono text-[10px] ${entry.status === "error" ? "text-red-400" : entry.status === "ok" ? "text-emerald-400" : entry.status === "skipped" ? "text-slate-500" : "text-cyan-400"}`}>
                          {entry.status === "error" ? "✕" : entry.status === "ok" ? "✓" : entry.status === "skipped" ? "–" : "…"}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[10px] leading-snug text-slate-200">{entry.message}</div>
                          <div className="font-mono text-[8px] uppercase tracking-wide text-cyan-500/70">{entry.stage}</div>
                          {entry.detail && <div className="mt-0.5 break-words font-mono text-[9px] leading-relaxed text-[var(--muted)]">{entry.detail}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {lastResearch && (
                    <div className="rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-1.5 font-mono text-[9px] text-cyan-300/90">
                      {lastResearch.usedWeb ? `${lastResearch.findings.length} finding(s) · ${lastResearch.citations.length} source(s)` : "Research was not needed for this question."}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
          <Card
            title="Conversations"
            subtitle={`${conversations.length} local · ${brainStatus?.stats.conversations ?? 0} in the permanent brain`}
            action={<Button size="sm" variant="outline" onClick={startConversation}>New</Button>}
          >
            <div className="space-y-2">
              <Input value={conversationSearch} onChange={(e) => setConversationSearch(e.target.value)} placeholder="Search titles and message text…" className="text-xs" />
              <div className="flex items-center justify-between font-mono text-[9px] text-[var(--muted)]">
                <span>{filteredConversations.length} shown</span>
                <label className="flex cursor-pointer items-center gap-1">
                  <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="luxe-checkbox" />
                  Show archived
                </label>
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {filteredConversations.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">No conversations match this search.</p>
                ) : filteredConversations.map((conversation) => (
                  <div key={conversation.id} className={`rounded border px-2 py-1.5 ${conversation.id === activeConversationId ? "border-cyan-500/40 bg-cyan-500/[0.07]" : "hairline bg-black/10"}`}>
                    <div className="flex items-center gap-0.5">
                      {renameDraft?.id === conversation.id ? (
                        <div className="flex min-w-0 flex-1 gap-1">
                          <Input autoFocus value={renameDraft.title} onChange={(e) => setRenameDraft({ id: conversation.id, title: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") { renameConversation(conversation.id, renameDraft.title); setRenameDraft(null); } if (e.key === "Escape") setRenameDraft(null); }}
                            className="py-1 text-xs" />
                          <Button size="sm" variant="primary" onClick={() => { renameConversation(conversation.id, renameDraft.title); setRenameDraft(null); }}>Save</Button>
                        </div>
                      ) : (
                        <button onClick={() => switchConversation(conversation.id)} className="min-w-0 flex-1 text-left">
                          <div className="truncate text-xs">
                            {conversation.pinned && <span className="mr-1">📌</span>}
                            {conversation.archived && <span className="mr-1 opacity-60">📦</span>}
                            {conversation.title}
                          </div>
                          <div className="truncate font-mono text-[9px] text-[var(--muted)]">
                            {conversation.folderId ? `${conversation.folderId} · ` : ""}{conversation.messages.length} messages · {timeAgo(conversation.updatedAt)}
                          </div>
                        </button>
                      )}
                      <button onClick={() => togglePinConversation(conversation.id)} className="focus-ring rounded px-1 font-mono text-[10px] text-amber-300/70 hover:text-amber-300" title={conversation.pinned ? "Unpin" : "Pin"}>{conversation.pinned ? "★" : "☆"}</button>
                      <button onClick={() => setRenameDraft({ id: conversation.id, title: conversation.title })} className="focus-ring rounded px-1 font-mono text-[10px] text-[var(--muted)] hover:text-cyan-300" title="Rename">✎</button>
                      <button onClick={() => { setFolderEditor(conversation.id); setFolderText(conversation.folderId ?? ""); }} className="focus-ring rounded px-1 font-mono text-[10px] text-[var(--muted)] hover:text-cyan-300" title="Move to folder">📁</button>
                      <button onClick={() => setConversationArchived(conversation.id, !conversation.archived)} className="focus-ring rounded px-1 font-mono text-[10px] text-[var(--muted)] hover:text-slate-100" title={conversation.archived ? "Unarchive" : "Archive"}>📦</button>
                      <button onClick={() => setDeleteDraft({ id: conversation.id, title: conversation.title })} className="focus-ring rounded px-1 font-mono text-[10px] text-[var(--muted)] hover:text-red-300" title="Delete">×</button>
                    </div>
                    {folderEditor === conversation.id && (
                      <div className="mt-1.5 flex gap-1">
                        <Input autoFocus list="conversation-folders" value={folderText} onChange={(e) => setFolderText(e.target.value)}
                          placeholder="Folder name (empty = none)" className="py-1 text-xs"
                          onKeyDown={(e) => { if (e.key === "Enter") applyFolder(); if (e.key === "Escape") setFolderEditor(null); }} />
                        <Button size="sm" variant="primary" onClick={applyFolder}>Set</Button>
                        <Button size="sm" variant="ghost" onClick={() => setFolderEditor(null)}>✕</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <datalist id="conversation-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
            </div>
          </Card>

          <Card title="Response Settings">
            <div className="space-y-4">
              <Field label={`Temperature: ${temperature.toFixed(2)}`} hint="Lower is more focused; higher is more varied">
                <input type="range" min="0" max="2" step="0.05" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="focus-ring w-full luxe-checkbox" />
              </Field>
              <Field label="Maximum response tokens" hint="Local engine supports up to 512 per reply">
                <Input type="number" min="1" max="512" value={maxTokens} onChange={(e) => setMaxTokens(Math.max(1, Math.min(512, Number(e.target.value) || 1)))} className="font-mono text-xs" />
              </Field>
              <label className="flex cursor-pointer items-start gap-2 rounded border hairline bg-black/20 p-2.5">
                <input type="checkbox" checked={settings.webSearch} onChange={(e) => updateSettings({ webSearch: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Web Search</span><span className="block font-mono text-[9px] text-[var(--muted)]">Search when a question appears to need current web information. Off by default; no web request is made while offline.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border hairline bg-black/20 p-2.5">
                <input type="checkbox" checked={settings.researchMode} onChange={(e) => updateSettings({ researchMode: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Research Mode</span><span className="block font-mono text-[9px] text-[var(--muted)]">Show every real search, page read and extracted statement live; inspect more sources.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border border-cyan-500/20 bg-cyan-500/[0.04] p-2.5">
                <input type="checkbox" checked={settings.useLocalLlm} onChange={(e) => updateSettings({ useLocalLlm: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Use installed Qwen model</span><span className="block font-mono text-[9px] text-[var(--muted)]">Generate offline answers with llama.cpp and the local GGUF weights.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border border-cyan-500/20 bg-cyan-500/[0.04] p-2.5">
                <input type="checkbox" checked={settings.brainAutoSave} onChange={(e) => updateSettings({ brainAutoSave: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Save every conversation to SQLite</span><span className="block font-mono text-[9px] text-[var(--muted)]">Permanent local storage, separate from this browser cache.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border border-cyan-500/20 bg-cyan-500/[0.04] p-2.5">
                <input type="checkbox" checked={settings.useSemanticRetrieval} onChange={(e) => updateSettings({ useSemanticRetrieval: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Semantic memory retrieval</span><span className="block font-mono text-[9px] text-[var(--muted)]">Adds local MiniLM embeddings when the model is installed.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border border-cyan-500/20 bg-cyan-500/[0.04] p-2.5">
                <input type="checkbox" checked={settings.strictOfflineMemory} onChange={(e) => updateSettings({ strictOfflineMemory: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Strict memory answers</span><span className="block font-mono text-[9px] text-[var(--muted)]">With no relevant saved memory, say so instead of guessing.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border hairline bg-black/20 p-2.5">
                <input type="checkbox" checked={settings.useKnowledge} onChange={(e) => updateSettings({ useKnowledge: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Use uploaded knowledge</span><span className="block font-mono text-[9px] text-[var(--muted)]">Retrieve excerpts from datasets and knowledge entries.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border hairline bg-black/20 p-2.5">
                <input type="checkbox" checked={settings.useMemory} onChange={(e) => updateSettings({ useMemory: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Use long-term memory</span><span className="block font-mono text-[9px] text-[var(--muted)]">Recall relevant user facts and preferences.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border hairline bg-black/20 p-2.5">
                <input type="checkbox" checked={settings.useCorrections} onChange={(e) => updateSettings({ useCorrections: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Use approved corrections</span><span className="block font-mono text-[9px] text-[var(--muted)]">Apply reviewed corrections to similar questions.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border hairline bg-black/20 p-2.5">
                <input type="checkbox" checked={settings.useGroundedAnswers} onChange={(e) => updateSettings({ useGroundedAnswers: e.target.checked })} className="focus-ring mt-0.5 luxe-checkbox" />
                <span><span className="block text-xs">Retrieval fallback</span><span className="block font-mono text-[9px] text-[var(--muted)]">Quote real local evidence when the word model is untrained. The generative engine is enabled separately in Settings.</span></span>
              </label>
              <div className="rounded border hairline bg-black/20 p-2 font-mono text-[10px] text-[var(--muted)]">
                {knowledgePreview.length + memoryPreview.length + correctionPreview.length} relevant local context item(s) for this message
              </div>
              <Button variant="secondary" onClick={() => setConfirmClear(true)} disabled={!chatMessages.length} className="w-full">Clear Conversation</Button>
            </div>
          </Card>

          <Card title="Persistent Brain Retrieval" subtitle="SQLite/FTS/semantic matches for the current draft or latest answer">
            <div className="mb-3 rounded border hairline bg-black/20 px-2 py-1.5 font-mono text-[9px] text-[var(--muted)]">
              {brainStatus ? `${brainStatus.stats.knowledgeEntries} knowledge · ${brainStatus.stats.conversations} conversations · ${brainStatus.stats.messages} messages · embedding ${brainStatus.localModel.embeddingReady ? "ready" : "not installed"}` : "Reading local brain status…"}
            </div>
            {visibleBrainContext.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">{previewingDraft ? "No relevant saved memory for this draft." : "No relevant saved memory was used for the latest answer."} With strict offline memory on, DavidAI will not invent an answer.</p>
            ) : (
              <div className="space-y-1.5">
                {visibleBrainContext.map((item) => <SourceChip key={`${item.sourceType}-${item.id}`} label={`${item.sourceType} · ${item.title} · ${item.score.toFixed(3)}`} text={item.content} />)}
              </div>
            )}
          </Card>

          <Card title="Retrieval Preview" subtitle="Legacy in-browser context, kept for the trained word model">
            {knowledgePreview.length + memoryPreview.length + correctionPreview.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">No relevant legacy local context for this message.</p>
            ) : (
              <div className="space-y-1.5">
                {memoryPreview.map((item) => <SourceChip key={item.id} label={item.title} text={item.content} />)}
                {correctionPreview.map((item) => <SourceChip key={item.id} label={item.title} text={item.content} />)}
                {knowledgePreview.map((chunk) => <SourceChip key={chunk.id} label={chunk.sourceTitle} text={chunk.text} />)}
              </div>
            )}
          </Card>

          <Card title="Model &amp; System" subtitle="Live facts from installed files and status checks">
            <ModelInfoPanel compact />
          </Card>

          <Card title="Engine Note">
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              The primary answer engine is Qwen2.5 1.5B Instruct Q4_K_M running through llama.cpp on this CPU. It receives retrieved SQLite memory, indexed attachments and recent turns; with strict memory on and no relevant evidence, DavidAI says so instead of inventing facts. The older trained word model remains available as a fallback. Web text is untrusted data, never executed, and is only searched when Web Search is on or Research mode is explicitly chosen. No external AI model, account, subscription or API key is used.
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear conversation?"
        description="This clears the current conversation from the browser view. The permanent SQLite record is kept; use the conversation list to delete it permanently."
        confirmLabel="Clear"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => { clearChat(); setConfirmClear(false); }}
      />
      <ConfirmDialog
        open={Boolean(deleteDraft)}
        title="Delete conversation?"
        description={deleteDraft ? `“${deleteDraft.title}” will be removed from this browser and the permanent SQLite brain. This cannot be undone.` : undefined}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteDraft(null)}
        onConfirm={confirmDeleteConversation}
      />
    </>
  );
}

function SourceChip({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded border hairline bg-black/10 px-2 py-1.5">
      <div className="truncate text-[11px]">{label}</div>
      <p className="mt-1 line-clamp-2 font-mono text-[9px] text-[var(--muted)]">{text}</p>
    </div>
  );
}
