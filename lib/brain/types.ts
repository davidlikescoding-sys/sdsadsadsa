export const BRAIN_CATEGORIES = [
  "general",
  "science",
  "mathematics",
  "history",
  "geography",
  "technology",
  "programming",
  "animals",
  "nature",
  "food",
  "sports",
  "everyday objects",
  "brands",
  "engineering",
  "electronics",
  "artificial intelligence",
  "user-provided",
  "research findings",
] as const;

export type BrainCategory = (typeof BRAIN_CATEGORIES)[number];

export type KnowledgeSourceType =
  | "conversation"
  | "user_correction"
  | "web_research"
  | "document"
  | "manual"
  | "dataset";

export type VerificationStatus =
  | "unverified"
  | "user-reported"
  | "sourced"
  | "disputed"
  | "outdated";

export interface BrainMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface BrainConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: BrainMessage[];
}

export interface BrainKnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: BrainCategory;
  keywords: string[];
  source: string;
  sourceType: KnowledgeSourceType;
  sourceId?: string;
  confidence: number;
  verification: VerificationStatus;
  relatedIds: string[];
  hash: string;
  createdAt: string;
  updatedAt: string;
  retrievalCount: number;
  /** Additive v2 provenance. All fields are optional so v1 records keep working. */
  sourceUrl?: string;
  sourceTitle?: string;
  sourceService?: string;
  sourceVersion?: string;
  retrievedAt?: string;
  lastModified?: string;
  etag?: string;
  validFrom?: string;
  validTo?: string;
  supersedesId?: string;
  contentSha256?: string;
}

export interface BrainCorrection {
  id: string;
  knowledgeId: string;
  conversationId: string;
  messageId: string;
  original: string;
  corrected: string;
  source: string;
  confidence: number;
  createdAt: string;
}

export interface BrainResearchRecord {
  id: string;
  title: string;
  content: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceService?: string;
  retrievedAt?: string;
  publishedAt?: string;
  lastModified?: string;
  etag?: string;
  contentSha256?: string;
  keywords: string[];
  hash: string;
  createdAt: string;
}

export interface BrainDocumentChunk {
  id: string;
  name: string;
  content: string;
  category: BrainCategory;
  keywords: string[];
  source: string;
  hash: string;
  createdAt: string;
  path?: string;
  section?: string;
  symbol?: string;
  language?: string;
  docVersion?: string;
  docSha256?: string;
  retrievedAt?: string;
}

export interface BrainRetrievalItem {
  id: string;
  sourceType: "knowledge" | "conversation" | "document" | "research" | "correction";
  sourceId: string;
  title: string;
  content: string;
  score: number;
  reasons: string[];
  confidence?: number;
  verification?: VerificationStatus;
  category?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceService?: string;
  sourceVersion?: string;
  retrievedAt?: string;
  publishedAt?: string;
  validTo?: string;
  docVersion?: string;
  section?: string;
  symbol?: string;
  language?: string;
  staleReason?: string;
}

export interface BrainExtractionResult {
  conversationId: string;
  savedMessages: number;
  knowledgeIds: string[];
  correctionIds: string[];
  disputedIds: string[];
}

export interface BrainStats {
  conversations: number;
  messages: number;
  knowledgeEntries: number;
  extractedFacts: number;
  corrections: number;
  researchRecords: number;
  documents: number;
  categories: number;
  databaseBytes: number;
  lastBackupAt?: string;
  integrity: string;
  ftsErrors?: Array<{ table: string; message: string; at: string }>;
  schemaVersion: number;
  recentKnowledge: Array<Pick<BrainKnowledgeEntry, "id" | "title" | "content" | "category" | "createdAt" | "verification">>;
  frequent: Array<Pick<BrainKnowledgeEntry, "id" | "title" | "retrievalCount">>;
  growth: Array<{ date: string; conversations: number; knowledge: number }>;
}

export interface BrainStatus {
  databasePath: string;
  ready: boolean;
  stats: BrainStats;
  localModel: {
    executable: string;
    model: string;
    embeddingModel: string;
    executableReady: boolean;
    modelReady: boolean;
    embeddingReady: boolean;
    modelBytes: number;
    embeddingBytes: number;
  };
}
