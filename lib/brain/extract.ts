import { ftsTerms, hashBrainText, insertCorrection, markDisputed, randomUUID, saveConversation, searchFts, upsertKnowledge, upsertResearch } from "./db";
import type { BrainCategory, BrainConversation, BrainExtractionResult, BrainKnowledgeEntry, BrainResearchRecord } from "./types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "can", "could", "would", "should", "will", "shall", "may", "might", "must", "what", "which", "who", "whom", "whose", "where", "when", "why", "how",
  "with", "without", "from", "into", "onto", "about", "above", "below", "over", "under", "for", "to", "of", "in", "on", "at", "by", "as", "it", "its", "you", "your", "i", "me", "my", "we", "our", "they", "their", "he", "she", "his", "her", "not", "no", "yes",
  "please", "tell", "explain", "give", "know", "want", "need", "help", "answer", "question", "something", "anything", "nothing", "there", "here",
]);

const CATEGORY_RULES: Array<[BrainCategory, RegExp]> = [
  ["artificial intelligence", /\b(ai|artificial intelligence|machine learning|neural|model|llm|diffusion|embedding|rag)\b/i],
  ["programming", /\b(code|program|programming|javascript|typescript|python|function|algorithm|api|software|database|sqlite)\b/i],
  ["technology", /\b(computer|device|machine|internet|network|hardware|software|raspberry pi|sensor|robot)\b/i],
  ["electronics", /\b(circuit|voltage|current|resistor|capacitor|battery|electronic|electric|led|chip)\b/i],
  ["engineering", /\b(engine|mechanical|gear|spring|rotor|mainspring|movement|lever|design|manufacture)\b/i],
  ["science", /\b(science|physics|chemistry|biology|energy|photosynthesis|plant|cell|atom|gravity|light|heat)\b/i],
  ["mathematics", /\b(math|mathematics|equation|number|calculate|algorithm|fraction|algebra|geometry|probability)\b/i],
  ["history", /\b(history|historical|ancient|century|war|empire|dynasty|past)\b/i],
  ["geography", /\b(country|city|river|mountain|ocean|continent|capital|location|geography)\b/i],
  ["animals", /\b(animal|dog|cat|bird|fish|mammal|insect|reptile|species|pet|horse|retriever)\b/i],
  ["nature", /\b(nature|forest|snow|tree|flower|weather|winter|summer|sky|snowfall|environment)\b/i],
  ["food", /\b(food|cook|recipe|ingredient|meal|bread|coffee|fruit|vegetable)\b/i],
  ["sports", /\b(sport|football|basketball|tennis|running|game|team|score|olympic)\b/i],
  ["everyday objects", /\b(watch|clock|chair|table|phone|key|tool|object|device|umbrella)\b/i],
  ["brands", /\b(apple|nike|sony|samsung|tesla|coca.?cola|microsoft|google|brand)\b/i],
  ["research findings", /\b(study|research|paper|source|article|wikipedia|arxiv|finding)\b/i],
];

export function tokenizeBrainText(text: string): string[] {
  return Array.from(new Set(String(text).toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) ?? []))
    .filter((word) => !STOPWORDS.has(word) && word.length < 40);
}

export function classifyBrainCategory(text: string, fallback: BrainCategory = "general"): BrainCategory {
  for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(text)) return category;
  return fallback;
}

function splitSentences(text: string): string[] {
  return String(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 320);
}

function cleanText(text: string): string {
  return String(text).replace(/\s+/g, " ").trim();
}

function isCorrection(text: string): boolean {
  return /\b(that is (wrong|incorrect)|is incorrect|not correct|actually[, ]|the correct answer is|correction:|you are wrong|i meant|instead of)\b/i.test(text);
}

function isSmallTalk(text: string): boolean {
  return /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|good|bye|test)\b/i.test(cleanText(text)) && cleanText(text).length < 40;
}

function titleFrom(text: string): string {
  const clean = cleanText(text).replace(/[?.!]+$/, "");
  const words = clean.split(" ").slice(0, 12).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface FactDraft {
  title: string;
  content: string;
  confidence: number;
  verification: BrainKnowledgeEntry["verification"];
  sourceType: BrainKnowledgeEntry["sourceType"];
  source: string;
  sourceId: string;
  keywords: string[];
  category: BrainCategory;
}

function definitionDrafts(answer: string, sourceId: string): FactDraft[] {
  const drafts: FactDraft[] = [];
  for (const sentence of splitSentences(answer).slice(0, 8)) {
    const definition = /^([A-Z][\w\s-]{1,60}?)\s+(is|are|refers to|means|stores|uses|is powered by|is designed to)\s+(.+)$/.exec(sentence);
    if (!definition) continue;
    const subject = cleanText(definition[1]);
    if (subject.length < 2 || subject.split(" ").length > 8) continue;
    drafts.push({
      title: `${subject} — definition`,
      content: sentence,
      confidence: 0.76,
      verification: "unverified",
      sourceType: "conversation",
      source: `conversation:${sourceId}`,
      sourceId,
      keywords: tokenizeBrainText(sentence),
      category: classifyBrainCategory(sentence),
    });
  }
  return drafts.slice(0, 4);
}

function relatedIdsFor(db: Parameters<typeof searchFts>[0], draft: FactDraft): string[] {
  const query = draft.keywords.slice(0, 8).join(" ");
  if (!query) return [];
  const hits = searchFts(db, "brain_fts", query, 8);
  return hits.filter((hit) => hit.id !== draft.sourceId).map((hit) => hit.id);
}

function persistDraft(db: Parameters<typeof upsertKnowledge>[0], draft: FactDraft, relationKind = "related"): BrainKnowledgeEntry | null {
  const contentHash = hashBrainText(draft.content);
  const relatedIds = relatedIdsFor(db, draft);
  const entry = upsertKnowledge(db, {
    title: draft.title,
    content: draft.content,
    category: draft.category,
    keywords: draft.keywords,
    source: draft.source,
    sourceType: draft.sourceType,
    sourceId: draft.sourceId,
    confidence: draft.confidence,
    verification: draft.verification,
    relatedIds,
    hash: contentHash,
  });
  if (!entry) return null;
  for (const relatedId of relatedIds.slice(0, 6)) {
    db.prepare(`INSERT INTO relations(id, from_id, to_id, kind, weight, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(from_id, to_id, kind) DO UPDATE SET weight = excluded.weight`)
      .run(randomUUID(), entry.id, relatedId, relationKind, 0.6, new Date().toISOString());
  }
  return entry;
}

export function saveAndExtractConversation(db: Parameters<typeof saveConversation>[0], conversation: BrainConversation): BrainExtractionResult {
  const { savedMessages } = saveConversation(db, conversation);
  const knowledgeIds: string[] = [];
  const correctionIds: string[] = [];
  const disputedIds: string[] = [];
  const messages = conversation.messages;

  for (let index = 1; index < messages.length; index += 1) {
    const user = messages[index - 1];
    const assistant = messages[index];
    if (user.role !== "user" || assistant.role !== "assistant") continue;
    const question = cleanText(user.content);
    const answer = cleanText(assistant.content);
    if (!question || !answer || isSmallTalk(question) || isSmallTalk(answer) || answer.length < 24) continue;

    if (isCorrection(question)) {
      const contextTerms = tokenizeBrainText(`${question} ${answer}`).slice(0, 10).join(" ");
      const matches = contextTerms ? searchFts(db, "brain_fts", contextTerms, 5) : [];
      const prior = matches.filter((match) => match.id !== assistant.id).slice(0, 3).map((match) => match.id);
      const disputedCount = markDisputed(db, prior);
      if (disputedCount > 0) disputedIds.push(...prior.slice(0, disputedCount));
      const corrected = answer.length > 320 ? `${answer.slice(0, 317)}...` : answer;
      const draft: FactDraft = {
        title: `Correction: ${titleFrom(question)}`,
        content: `Correction from user: ${corrected}`,
        confidence: 0.82,
        verification: "user-reported",
        sourceType: "user_correction",
        source: `conversation:${conversation.id}:message:${user.id}`,
        sourceId: user.id,
        keywords: tokenizeBrainText(`${question} ${corrected}`),
        category: classifyBrainCategory(`${question} ${corrected}`),
      };
      const entry = persistDraft(db, draft, "corrects");
      if (entry) {
        knowledgeIds.push(entry.id);
        const correction = insertCorrection(db, {
          knowledgeId: prior[0] ?? entry.id,
          conversationId: conversation.id,
          messageId: user.id,
          original: question.slice(0, 1000),
          corrected: corrected.slice(0, 1000),
          source: "user",
          confidence: 0.82,
        });
        correctionIds.push(correction.id);
      }
      continue;
    }

    const qaContent = `Q: ${question.slice(0, 220)} A: ${answer.slice(0, 320)}`;
    const qaDraft: FactDraft = {
      title: titleFrom(question),
      content: qaContent,
      confidence: 0.62,
      verification: "unverified",
      sourceType: "conversation",
      source: `conversation:${conversation.id}:message:${assistant.id}`,
      sourceId: assistant.id,
      keywords: tokenizeBrainText(`${question} ${answer}`),
      category: classifyBrainCategory(`${question} ${answer}`),
    };
    const qaEntry = persistDraft(db, qaDraft, "answers");
    if (qaEntry) knowledgeIds.push(qaEntry.id);

    for (const draft of definitionDrafts(answer, assistant.id)) {
      const entry = persistDraft(db, draft, "explains");
      if (entry && !knowledgeIds.includes(entry.id)) knowledgeIds.push(entry.id);
    }
  }

  return { conversationId: conversation.id, savedMessages, knowledgeIds: Array.from(new Set(knowledgeIds)), correctionIds, disputedIds: Array.from(new Set(disputedIds)) };
}

export interface ResearchFindingInput {
  title?: string;
  content: string;
  sourceUrl?: string;
  /** Actual page/result title. Service names are stored separately. */
  sourceTitle?: string;
  sourceService?: string;
  retrievedAt?: string;
  publishedAt?: string;
  lastModified?: string;
  etag?: string;
  keywords?: string[];
}

function validatedSourceUrl(input?: string): string | undefined {
  if (!input) return undefined;
  try {
    const parsed = new URL(input);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? input : undefined;
  } catch {
    return undefined;
  }
}

const SERVICE_NAMES = new Set(["wikipedia", "duckduckgo", "google-news", "hacker-news", "arxiv"]);

export function absorbResearchFinding(db: Parameters<typeof upsertResearch>[0], finding: ResearchFindingInput): { research: BrainResearchRecord | null; knowledgeId?: string } {
  if (!finding.content || finding.content.length < 24) return { research: null };
  const sourceUrl = validatedSourceUrl(finding.sourceUrl);
  const rawTitle = finding.sourceTitle?.trim() || undefined;
  // A service name is provenance about where a result came from, not a page
  // title. It must not by itself make quoted web text look externally sourced.
  const sourceTitle = rawTitle && !SERVICE_NAMES.has(rawTitle.toLowerCase()) ? rawTitle : undefined;
  const sourceService = finding.sourceService?.trim() || (rawTitle && SERVICE_NAMES.has(rawTitle.toLowerCase()) ? rawTitle : undefined);
  const hasVerifiedSource = Boolean(sourceUrl && sourceTitle);
  const keywords = Array.from(new Set([...(finding.keywords ?? []), ...tokenizeBrainText(`${finding.title ?? ""} ${finding.content}`)])).slice(0, 40);
  const research = upsertResearch(db, {
    title: titleFrom(finding.title ?? finding.content),
    content: finding.content,
    sourceUrl,
    sourceTitle,
    sourceService,
    retrievedAt: finding.retrievedAt,
    publishedAt: finding.publishedAt,
    lastModified: finding.lastModified,
    etag: finding.etag,
    keywords,
  });
  if (!research) return { research: null };
  const entry = upsertKnowledge(db, {
    title: research.title,
    content: research.content.slice(0, 1200),
    category: classifyBrainCategory(`${research.title} ${research.content}`, "research findings"),
    keywords,
    source: sourceUrl ?? "manual research note",
    sourceType: hasVerifiedSource ? "web_research" : "manual",
    sourceId: hasVerifiedSource ? research.id : undefined,
    confidence: hasVerifiedSource ? 0.78 : 0.45,
    verification: hasVerifiedSource ? "sourced" : "unverified",
    relatedIds: searchFts(db, "brain_fts", keywords.slice(0, 8).join(" "), 6).map((hit) => hit.id),
    hash: hashBrainText(`research:${research.content}`),
    sourceUrl: research.sourceUrl,
    sourceTitle: research.sourceTitle,
    sourceService: research.sourceService,
    retrievedAt: research.retrievedAt,
    lastModified: research.lastModified,
    etag: research.etag,
    contentSha256: research.contentSha256,
  });
  return { research, knowledgeId: entry?.id };
}

export function queryCoversKnowledge(question: string, content: string): number {
  const questionTerms = tokenizeBrainText(question);
  const contentTerms = new Set(tokenizeBrainText(content));
  if (!questionTerms.length) return 0;
  return questionTerms.filter((term) => contentTerms.has(term)).length / questionTerms.length;
}

export { ftsTerms };
