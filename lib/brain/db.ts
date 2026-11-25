import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataRoot } from "../runtime-paths";
import { BRAIN_CATEGORIES, type BrainCategory, type BrainConversation, type BrainCorrection, type BrainDocumentChunk, type BrainKnowledgeEntry, type BrainMessage, type BrainResearchRecord, type BrainStats } from "./types";

const SCHEMA_VERSION = 2;

export function brainRoot(): string {
  return join(dataRoot(), "brain");
}

export function brainDbPath(): string {
  return join(brainRoot(), "brain.sqlite");
}

export function backupsDir(): string {
  return join(brainRoot(), "backups");
}

/** On Vercel the writable root is temporary; seed it once from the committed snapshot. */
function seedBrainDatabase(path: string): void {
  if (existsSync(path) || !process.env.VERCEL) return;
  const seed = join(process.cwd(), "data", "brain", "brain.sqlite");
  if (!existsSync(seed)) return;
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(seed, path);
}

export function hashBrainText(text: string): string {
  return createHash("sha1").update(text.trim().toLowerCase()).digest("hex");
}

/** Content identity for version metadata. Unlike the legacy hash, this is case-sensitive. */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

let singleton: DatabaseSync | null = null;
let openingDb: DatabaseSync | null = null;

export function getBrainDb(options?: { path?: string; autoBackup?: boolean }): DatabaseSync {
  const path = options?.path ?? brainDbPath();
  if (!options?.path && singleton) return singleton;
  // Opening and migrating are synchronous, but a re-entrant call during setup
  // must not open a second handle to the live database.
  if (!options?.path && openingDb) return openingDb;
  mkdirSync(dirname(path), { recursive: true });
  seedBrainDatabase(path);
  mkdirSync(backupsDir(), { recursive: true });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  if (!options?.path) openingDb = db;
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    migrate(db, path);
    if (options?.autoBackup !== false && !options?.path) maybeBackup(db, path);
    if (!options?.path) singleton = db;
    return db;
  } finally {
    if (!options?.path) openingDb = null;
  }
}

/** Named savepoints are safe to use inside or outside an existing transaction. */
let transactionSequence = 0;
function withSavepoint<T>(db: DatabaseSync, label: string, work: () => T): T {
  const name = `davidai_${label}_${++transactionSequence}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = work();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    try { db.exec(`ROLLBACK TO ${name}`); } catch { /* keep the original error */ }
    try { db.exec(`RELEASE ${name}`); } catch { /* keep the original error */ }
    throw error;
  }
}

function migrate(db: DatabaseSync, dbPath = brainDbPath()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seq INTEGER NOT NULL,
      metadata TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, seq);

    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      keywords TEXT NOT NULL,
      source TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      confidence REAL NOT NULL,
      verification TEXT NOT NULL,
      related_ids TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      retrieval_count INTEGER NOT NULL DEFAULT 0,
      source_url TEXT,
      source_title TEXT,
      source_service TEXT,
      source_version TEXT,
      retrieved_at TEXT,
      last_modified TEXT,
      etag TEXT,
      valid_from TEXT,
      valid_to TEXT,
      supersedes_id TEXT,
      content_sha256 TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
    CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge(source_type, source_id);
    CREATE TABLE IF NOT EXISTS corrections (
      id TEXT PRIMARY KEY,
      knowledge_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      original TEXT NOT NULL,
      corrected TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS research (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_url TEXT,
      source_title TEXT,
      source_service TEXT,
      retrieved_at TEXT,
      published_at TEXT,
      last_modified TEXT,
      etag TEXT,
      content_sha256 TEXT,
      keywords TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      keywords TEXT NOT NULL,
      source TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      path TEXT,
      section TEXT,
      symbol TEXT,
      language TEXT,
      doc_version TEXT,
      doc_sha256 TEXT,
      retrieved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      weight REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(from_id, to_id, kind)
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      vector BLOB NOT NULL,
      dim INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Model-versioned vectors. The legacy table is kept for rollback and old exports.
    CREATE TABLE IF NOT EXISTS embeddings_v2 (
      id TEXT NOT NULL,
      model TEXT NOT NULL,
      vector BLOB NOT NULL,
      dim INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, model)
    );

    CREATE TABLE IF NOT EXISTS retrieval_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      result_id TEXT NOT NULL,
      result_type TEXT NOT NULL,
      score REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      integrity TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_corrections_created ON corrections(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_research_created ON research(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_embeddings_model_created ON embeddings(model, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_embeddings_v2_model_created ON embeddings_v2(model, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_retrieval_log_created ON retrieval_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      keywords,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
      id UNINDEXED,
      conversation_id UNINDEXED,
      content,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      id UNINDEXED,
      name,
      content,
      keywords,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS research_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      keywords,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  const versionRow = db.prepare("SELECT value FROM brain_meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
  // A missing version row means a freshly created v2 database. An existing v1
  // row is the only case that needs an additive migration and safety snapshot.
  const currentVersion = versionRow ? Number(versionRow.value) : SCHEMA_VERSION;
  if (!Number.isFinite(currentVersion) || currentVersion < SCHEMA_VERSION) {
    const backupRoot = join(dirname(dbPath), "backups");
    mkdirSync(backupRoot, { recursive: true });
    createBackup(db, "schema-v2", backupRoot);
    withSavepoint(db, "migrate_v2", () => {
      const addColumns = (table: string, columns: Record<string, string>) => {
        const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
        for (const [name, declaration] of Object.entries(columns)) {
          if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
        }
      };
      addColumns("knowledge", {
        source_url: "TEXT", source_title: "TEXT", source_service: "TEXT", source_version: "TEXT",
        retrieved_at: "TEXT", last_modified: "TEXT", etag: "TEXT", valid_from: "TEXT",
        valid_to: "TEXT", supersedes_id: "TEXT", content_sha256: "TEXT",
      });
      addColumns("research", {
        source_service: "TEXT", retrieved_at: "TEXT", published_at: "TEXT",
        last_modified: "TEXT", etag: "TEXT", content_sha256: "TEXT",
      });
      addColumns("documents", {
        path: "TEXT", section: "TEXT", symbol: "TEXT", language: "TEXT",
        doc_version: "TEXT", doc_sha256: "TEXT", retrieved_at: "TEXT",
      });
      // Backfill only facts already present in v1. retrieved_at is intentionally
      // left empty: a database insertion time is not a verified source fetch.
      for (const row of db.prepare("SELECT id, source, content FROM knowledge").all() as Array<{ id: string; source: string; content: string }>) {
        const sourceUrl = /^https?:\/\//i.test(row.source) ? row.source : null;
        db.prepare("UPDATE knowledge SET source_url = COALESCE(source_url, ?), content_sha256 = COALESCE(content_sha256, ?) WHERE id = ?")
          .run(sourceUrl, sha256Text(row.content), row.id);
      }
      for (const row of db.prepare("SELECT id, content FROM research").all() as Array<{ id: string; content: string }>) {
        db.prepare("UPDATE research SET content_sha256 = COALESCE(content_sha256, ?) WHERE id = ?").run(sha256Text(row.content), row.id);
      }
      for (const row of db.prepare("SELECT id, content FROM documents").all() as Array<{ id: string; content: string }>) {
        db.prepare("UPDATE documents SET doc_sha256 = COALESCE(doc_sha256, ?) WHERE id = ?").run(sha256Text(row.content), row.id);
      }
      // Preserve every legacy vector. The new table allows multiple models for
      // the same record without overwriting prior embeddings.
      db.exec(`INSERT OR IGNORE INTO embeddings_v2(id, model, vector, dim, created_at)
        SELECT id, model, vector, dim, created_at FROM embeddings`);
    });
  }
  db.exec(`INSERT OR IGNORE INTO embeddings_v2(id, model, vector, dim, created_at)
    SELECT id, model, vector, dim, created_at FROM embeddings`);
  db.prepare("INSERT INTO brain_meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(SCHEMA_VERSION));
}

export interface BrainBackupRecord {
  id: number;
  path: string;
  size: number;
  integrity: string;
  createdAt: string;
}

/** Backup labels are filenames, not paths or SQL. Keep them to a safe whitelist. */
export function sanitizeBackupReason(reason: unknown): string {
  const cleaned = String(reason ?? "").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return cleaned || "manual";
}

export function createBackup(db: DatabaseSync, reason = "automatic", backupRoot = backupsDir()): BrainBackupRecord {
  mkdirSync(backupRoot, { recursive: true });
  const safeReason = sanitizeBackupReason(reason);
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeReason}`;
  const target = resolve(backupRoot, `brain-${stamp}.sqlite`);
  const root = resolve(backupRoot);
  if (!target.startsWith(`${root}${sep}`)) throw new Error("Backup path escaped the backup directory.");
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const integrity = integrityCheck(db);
  const createdAt = new Date().toISOString();
  const result = db.prepare("INSERT INTO backups(path, size, integrity, created_at) VALUES (?, ?, ?, ?)").run(target, statSync(target).size, integrity, createdAt);
  return { id: Number(result.lastInsertRowid), path: target, size: statSync(target).size, integrity, createdAt };
}

function maybeBackup(db: DatabaseSync, _dbPath: string): void {
  try {
    const existing = db.prepare("SELECT created_at FROM backups ORDER BY id DESC LIMIT 1").get() as { created_at?: string } | undefined;
    const fresh = existing?.created_at && Date.now() - new Date(existing.created_at).getTime() < 24 * 60 * 60 * 1000;
    if (!fresh) createBackup(db, "auto");
  } catch {
    // A backup failure must never block startup; the live database is untouched.
  }
}

export function integrityCheck(db: DatabaseSync): string {
  const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
  return String(row?.integrity_check ?? "unknown");
}

export function saveConversation(db: DatabaseSync, conversation: BrainConversation): { savedMessages: number } {
  const now = new Date().toISOString();
  return withSavepoint(db, "save_conversation", () => {
    db.prepare(`INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`)
      .run(conversation.id, conversation.title.slice(0, 240), conversation.createdAt, conversation.updatedAt || now);
    let savedMessages = 0;
    conversation.messages.forEach((message, index) => {
      const previous = db.prepare("SELECT content FROM messages WHERE id = ?").get(message.id) as { content: string } | undefined;
      db.prepare(`INSERT INTO messages(id, conversation_id, role, content, created_at, seq, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, role = excluded.role,
          content = excluded.content, seq = excluded.seq, metadata = excluded.metadata`)
        .run(message.id, conversation.id, message.role, message.content, message.createdAt, index, message.metadata ? JSON.stringify(message.metadata) : null);
      if (!previous || previous.content !== message.content) {
        db.prepare("DELETE FROM message_fts WHERE id = ?").run(message.id);
        db.prepare("INSERT INTO message_fts(id, conversation_id, content) VALUES (?, ?, ?)").run(message.id, conversation.id, message.content);
      }
      savedMessages += 1;
    });

    // Autosave sends the whole visible conversation. Remove messages that are no
    // longer present so a UI clear/regenerate cannot leave stale local memory.
    const keptIds = conversation.messages.map((message) => message.id);
    const staleCondition = keptIds.length
      ? `conversation_id = ? AND id NOT IN (${keptIds.map(() => "?").join(", ")})`
      : "conversation_id = ?";
    const staleParams = [conversation.id, ...keptIds];
    const stale = db.prepare(`SELECT id FROM messages WHERE ${staleCondition}`).all(...staleParams) as Array<{ id: string }>;
    for (const row of stale) {
      db.prepare("DELETE FROM message_fts WHERE id = ?").run(row.id);
      db.prepare("DELETE FROM embeddings WHERE id = ?").run(row.id);
      db.prepare("DELETE FROM embeddings_v2 WHERE id = ?").run(row.id);
    }
    db.prepare(`DELETE FROM messages WHERE ${staleCondition}`).run(...staleParams);
    return { savedMessages };
  });
}

export function listConversations(db: DatabaseSync, limit = 100): BrainConversation[] {
  const rows = db.prepare("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ?").all(limit) as Array<{ id: string; title: string; created_at: string; updated_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: listMessages(db, row.id),
  }));
}

export function getConversation(db: DatabaseSync, id: string): BrainConversation | null {
  const row = db.prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?").get(id) as { id: string; title: string; created_at: string; updated_at: string } | undefined;
  if (!row) return null;
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at, messages: listMessages(db, row.id) };
}

export function deleteConversation(db: DatabaseSync, id: string): boolean {
  return withSavepoint(db, "delete_conversation", () => {
    db.prepare("DELETE FROM message_fts WHERE conversation_id = ?").run(id);
    const result = db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  });
}

function listMessages(db: DatabaseSync, conversationId: string): BrainMessage[] {
  const rows = db.prepare("SELECT id, role, content, created_at, metadata FROM messages WHERE conversation_id = ? ORDER BY seq ASC").all(conversationId) as Array<{ id: string; role: string; content: string; created_at: string; metadata: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    role: row.role === "assistant" || row.role === "system" ? row.role : "user",
    content: row.content,
    createdAt: row.created_at,
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
  }));
}

const VERIFY_RANK: Record<string, number> = { unverified: 0, disputed: 1, outdated: 1, "user-reported": 2, sourced: 3 };

const KNOWLEDGE_META_COLUMNS = [
  "source_url", "source_title", "source_service", "source_version", "retrieved_at",
  "last_modified", "etag", "valid_from", "valid_to", "supersedes_id", "content_sha256",
] as const;

type KnowledgeMetaInput = Pick<BrainKnowledgeEntry,
  "sourceUrl" | "sourceTitle" | "sourceService" | "sourceVersion" | "retrievedAt" |
  "lastModified" | "etag" | "validFrom" | "validTo" | "supersedesId" | "contentSha256">;

function knowledgeMetaValues(entry: Partial<KnowledgeMetaInput>): Array<string | null> {
  return [
    entry.sourceUrl ?? null,
    entry.sourceTitle ?? null,
    entry.sourceService ?? null,
    entry.sourceVersion ?? null,
    entry.retrievedAt ?? null,
    entry.lastModified ?? null,
    entry.etag ?? null,
    entry.validFrom ?? null,
    entry.validTo ?? null,
    entry.supersedesId ?? null,
    entry.contentSha256 ?? null,
  ];
}

function knowledgeMetaAssignments(): string {
  return KNOWLEDGE_META_COLUMNS.map((column) => `${column} = ?`).join(", ");
}

export function upsertKnowledge(db: DatabaseSync, entry: Omit<BrainKnowledgeEntry, "id" | "createdAt" | "updatedAt" | "retrievalCount"> & { id?: string }): BrainKnowledgeEntry | null {
  const now = new Date().toISOString();
  const id = entry.id ?? randomUUID();
  const hash = entry.hash || hashBrainText(entry.content);
  const existing = db.prepare("SELECT * FROM knowledge WHERE hash = ?").get(hash) as Record<string, unknown> | undefined;
  if (existing) {
    const oldVerification = String(existing.verification ?? "unverified");
    const verification = (VERIFY_RANK[entry.verification] ?? 0) >= (VERIFY_RANK[oldVerification] ?? 0) ? entry.verification : oldVerification as BrainKnowledgeEntry["verification"];
    const related = mergeIds(String(existing.related_ids ?? ""), entry.relatedIds);
    db.prepare(`UPDATE knowledge SET title = ?, content = ?, category = ?, keywords = ?, source = ?, source_type = ?, source_id = ?, confidence = ?, verification = ?, related_ids = ?, updated_at = ?, ${knowledgeMetaAssignments()} WHERE id = ?`)
      .run(entry.title.slice(0, 240), entry.content.slice(0, 2000), entry.category, JSON.stringify(entry.keywords), entry.source, entry.sourceType, entry.sourceId ?? null, entry.confidence, verification, JSON.stringify(related), now, ...knowledgeMetaValues(entry), existing.id);
    syncKnowledgeFts(db, String(existing.id), false);
    syncKnowledgeFts(db, String(existing.id), true);
    return getKnowledge(db, String(existing.id));
  }
  db.prepare(`INSERT INTO knowledge(id, title, content, category, keywords, source, source_type, source_id, confidence, verification, related_ids, hash, created_at, updated_at, retrieval_count, ${KNOWLEDGE_META_COLUMNS.join(", ")})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ${KNOWLEDGE_META_COLUMNS.map(() => "?").join(", ")})`)
    .run(id, entry.title.slice(0, 240), entry.content.slice(0, 2000), entry.category, JSON.stringify(entry.keywords), entry.source, entry.sourceType, entry.sourceId ?? null, entry.confidence, entry.verification, JSON.stringify(entry.relatedIds), hash, now, now, ...knowledgeMetaValues(entry));
  syncKnowledgeFts(db, id, true);
  return getKnowledge(db, id);
}

function mergeIds(current: string, incoming: string[]): string[] {
  let existing: string[] = [];
  try { existing = JSON.parse(current || "[]") as string[]; } catch { existing = []; }
  return Array.from(new Set([...existing, ...incoming])).slice(0, 50);
}

function syncKnowledgeFts(db: DatabaseSync, id: string, insert: boolean): void {
  if (!insert) {
    db.prepare("DELETE FROM brain_fts WHERE id = ?").run(id);
    return;
  }
  const row = db.prepare("SELECT id, title, content, keywords FROM knowledge WHERE id = ?").get(id) as { id: string; title: string; content: string; keywords: string } | undefined;
  if (!row) return;
  db.prepare("INSERT INTO brain_fts(id, title, content, keywords) VALUES (?, ?, ?, ?)").run(row.id, row.title, row.content, row.keywords);
}

export function getKnowledge(db: DatabaseSync, id: string): BrainKnowledgeEntry | null {
  const row = db.prepare("SELECT * FROM knowledge WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapKnowledge(row) : null;
}

export function listKnowledge(db: DatabaseSync, options?: { category?: string; search?: string; limit?: number }): BrainKnowledgeEntry[] {
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
  let rows: Record<string, unknown>[];
  if (options?.search) {
    const terms = ftsTerms(options.search);
    if (!terms.length) return [];
    rows = db.prepare(`SELECT k.* FROM brain_fts f JOIN knowledge k ON k.id = f.id WHERE f MATCH ? ORDER BY bm25(f) ASC LIMIT ?`).all(terms, limit) as Record<string, unknown>[];
  } else if (options?.category && options.category !== "all") {
    rows = db.prepare("SELECT * FROM knowledge WHERE category = ? ORDER BY updated_at DESC LIMIT ?").all(options.category, limit) as Record<string, unknown>[];
  } else {
    rows = db.prepare("SELECT * FROM knowledge ORDER BY updated_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
  }
  return rows.map(mapKnowledge);
}

function mapKnowledge(row: Record<string, unknown>): BrainKnowledgeEntry {
  const parseList = (value: unknown): string[] => {
    try { return JSON.parse(String(value ?? "[]")) as string[]; } catch { return []; }
  };
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    category: (BRAIN_CATEGORIES.includes(String(row.category) as BrainCategory) ? row.category : "general") as BrainCategory,
    keywords: parseList(row.keywords),
    source: String(row.source),
    sourceType: row.source_type as BrainKnowledgeEntry["sourceType"],
    sourceId: row.source_id ? String(row.source_id) : undefined,
    confidence: Number(row.confidence),
    verification: row.verification as BrainKnowledgeEntry["verification"],
    relatedIds: parseList(row.related_ids),
    hash: String(row.hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    retrievalCount: Number(row.retrieval_count ?? 0),
    sourceUrl: row.source_url ? String(row.source_url) : undefined,
    sourceTitle: row.source_title ? String(row.source_title) : undefined,
    sourceService: row.source_service ? String(row.source_service) : undefined,
    sourceVersion: row.source_version ? String(row.source_version) : undefined,
    retrievedAt: row.retrieved_at ? String(row.retrieved_at) : undefined,
    lastModified: row.last_modified ? String(row.last_modified) : undefined,
    etag: row.etag ? String(row.etag) : undefined,
    validFrom: row.valid_from ? String(row.valid_from) : undefined,
    validTo: row.valid_to ? String(row.valid_to) : undefined,
    supersedesId: row.supersedes_id ? String(row.supersedes_id) : undefined,
    contentSha256: row.content_sha256 ? String(row.content_sha256) : undefined,
  };
}

export function updateKnowledge(db: DatabaseSync, id: string, patch: {
  title?: string; content?: string; category?: string; keywords?: string[];
  confidence?: number; verification?: string;
} & Partial<KnowledgeMetaInput>): BrainKnowledgeEntry | null {
  const current = getKnowledge(db, id);
  if (!current) return null;
  const next = {
    title: (patch.title ?? current.title).slice(0, 240),
    content: (patch.content ?? current.content).slice(0, 2000),
    category: patch.category ?? current.category,
    keywords: patch.keywords ?? current.keywords,
    confidence: patch.confidence ?? current.confidence,
    verification: patch.verification ?? current.verification,
    sourceUrl: patch.sourceUrl ?? current.sourceUrl,
    sourceTitle: patch.sourceTitle ?? current.sourceTitle,
    sourceService: patch.sourceService ?? current.sourceService,
    sourceVersion: patch.sourceVersion ?? current.sourceVersion,
    retrievedAt: patch.retrievedAt ?? current.retrievedAt,
    lastModified: patch.lastModified ?? current.lastModified,
    etag: patch.etag ?? current.etag,
    validFrom: patch.validFrom ?? current.validFrom,
    validTo: patch.validTo ?? current.validTo,
    supersedesId: patch.supersedesId ?? current.supersedesId,
    contentSha256: patch.contentSha256 ?? current.contentSha256,
  };
  const nextHash = hashBrainText(next.content);
  const duplicate = db.prepare("SELECT id FROM knowledge WHERE hash = ? AND id != ?").get(nextHash, id) as { id: string } | undefined;
  if (duplicate) throw new Error("Another knowledge entry already has this exact content. Edit that entry or remove it before saving this change.");
  db.prepare(`UPDATE knowledge SET title = ?, content = ?, category = ?, keywords = ?, confidence = ?, verification = ?, hash = ?, updated_at = ?, ${knowledgeMetaAssignments()} WHERE id = ?`)
    .run(next.title, next.content, next.category, JSON.stringify(next.keywords), next.confidence, next.verification, nextHash, new Date().toISOString(), ...knowledgeMetaValues(next), id);
  syncKnowledgeFts(db, id, false);
  syncKnowledgeFts(db, id, true);
  return getKnowledge(db, id);
}

export function deleteKnowledge(db: DatabaseSync, id: string): boolean {
  const result = db.prepare("DELETE FROM knowledge WHERE id = ?").run(id);
  if (!result.changes) return false;
  db.prepare("DELETE FROM brain_fts WHERE id = ?").run(id);
  db.prepare("DELETE FROM embeddings WHERE id = ?").run(id);
  db.prepare("DELETE FROM embeddings_v2 WHERE id = ?").run(id);
  db.prepare("DELETE FROM relations WHERE from_id = ? OR to_id = ?").run(id, id);
  return true;
}

export function markDisputed(db: DatabaseSync, ids: string[]): number {
  let changed = 0;
  for (const id of ids) {
    const result = db.prepare("UPDATE knowledge SET verification = 'disputed', updated_at = ? WHERE id = ? AND verification != 'sourced'").run(new Date().toISOString(), id);
    changed += Number(result.changes);
  }
  return changed;
}

function mapCorrection(row: Record<string, unknown>): BrainCorrection {
  return {
    id: String(row.id),
    knowledgeId: String(row.knowledge_id),
    conversationId: String(row.conversation_id),
    messageId: String(row.message_id),
    original: String(row.original),
    corrected: String(row.corrected),
    source: String(row.source),
    confidence: Number(row.confidence),
    createdAt: String(row.created_at),
  };
}

export function insertCorrection(db: DatabaseSync, correction: Omit<BrainCorrection, "id" | "createdAt">): BrainCorrection {
  // Repeating the same feedback must not multiply correction context. The
  // conversation and corrected message identify one reviewable decision.
  const existing = db.prepare(`SELECT * FROM corrections
    WHERE conversation_id = ? AND message_id = ? AND corrected = ?
    ORDER BY created_at DESC LIMIT 1`)
    .get(correction.conversationId, correction.messageId, correction.corrected) as Record<string, unknown> | undefined;
  if (existing) return mapCorrection(existing);
  const record: BrainCorrection = { ...correction, id: randomUUID(), createdAt: new Date().toISOString() };
  db.prepare(`INSERT INTO corrections(id, knowledge_id, conversation_id, message_id, original, corrected, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(record.id, record.knowledgeId, record.conversationId, record.messageId, record.original, record.corrected, record.source, record.confidence, record.createdAt);
  return record;
}

export function upsertResearch(db: DatabaseSync, record: Omit<BrainResearchRecord, "id" | "createdAt" | "hash"> & { hash?: string }): BrainResearchRecord | null {
  const content = String(record.content).slice(0, 4000);
  const hash = record.hash || hashBrainText(content);
  const existing = db.prepare("SELECT id FROM research WHERE hash = ?").get(hash) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  const createdAt = existing ? String((db.prepare("SELECT created_at FROM research WHERE id = ?").get(id) as { created_at: string }).created_at) : new Date().toISOString();
  db.prepare(`INSERT INTO research(id, title, content, source_url, source_title, source_service, retrieved_at, published_at, last_modified, etag, content_sha256, keywords, hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, source_url = excluded.source_url,
      source_title = excluded.source_title, source_service = excluded.source_service, retrieved_at = excluded.retrieved_at,
      published_at = excluded.published_at, last_modified = excluded.last_modified, etag = excluded.etag,
      content_sha256 = excluded.content_sha256, keywords = excluded.keywords`)
    .run(
      id, record.title.slice(0, 240), content, record.sourceUrl ?? null, record.sourceTitle ?? null,
      record.sourceService ?? null, record.retrievedAt ?? null, record.publishedAt ?? null,
      record.lastModified ?? null, record.etag ?? null, record.contentSha256 ?? sha256Text(content),
      JSON.stringify(record.keywords), hash, createdAt,
    );
  syncResearchFts(db, String(id));
  const row = db.prepare("SELECT * FROM research WHERE id = ?").get(id) as Record<string, unknown>;
  return mapResearch(row);
}

function mapResearch(row: Record<string, unknown>): BrainResearchRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    sourceUrl: row.source_url ? String(row.source_url) : undefined,
    sourceTitle: row.source_title ? String(row.source_title) : undefined,
    sourceService: row.source_service ? String(row.source_service) : undefined,
    retrievedAt: row.retrieved_at ? String(row.retrieved_at) : undefined,
    publishedAt: row.published_at ? String(row.published_at) : undefined,
    lastModified: row.last_modified ? String(row.last_modified) : undefined,
    etag: row.etag ? String(row.etag) : undefined,
    contentSha256: row.content_sha256 ? String(row.content_sha256) : undefined,
    keywords: JSON.parse(String(row.keywords ?? "[]")) as string[],
    hash: String(row.hash),
    createdAt: String(row.created_at),
  };
}

export function upsertDocumentChunk(db: DatabaseSync, chunk: Omit<BrainDocumentChunk, "id" | "createdAt" | "hash"> & { hash?: string }): BrainDocumentChunk {
  const content = String(chunk.content).slice(0, 4000);
  const docSha256 = chunk.docSha256 ?? sha256Text(content);
  // A new source version, section or symbol must create a new chunk instead of
  // silently overwriting the previous documentation record.
  const hash = chunk.hash || hashBrainText(`document:${chunk.path ?? chunk.name}:${chunk.docVersion ?? ""}:${docSha256}:${chunk.section ?? ""}:${chunk.symbol ?? ""}:${content}`);
  const existing = db.prepare("SELECT id FROM documents WHERE hash = ?").get(hash) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  db.prepare(`INSERT INTO documents(id, name, content, category, keywords, source, hash, created_at, path, section, symbol, language, doc_version, doc_sha256, retrieved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content, category = excluded.category,
      keywords = excluded.keywords, path = excluded.path, section = excluded.section, symbol = excluded.symbol,
      language = excluded.language, doc_version = excluded.doc_version, doc_sha256 = excluded.doc_sha256,
      retrieved_at = excluded.retrieved_at`)
    .run(
      id, chunk.name.slice(0, 240), content, chunk.category, JSON.stringify(chunk.keywords), chunk.source, hash,
      existing ? String((db.prepare("SELECT created_at FROM documents WHERE id = ?").get(id) as { created_at: string }).created_at) : new Date().toISOString(),
      chunk.path ?? null, chunk.section ?? null, chunk.symbol ?? null, chunk.language ?? null,
      chunk.docVersion ?? null, docSha256, chunk.retrievedAt ?? null,
    );
  syncDocumentFts(db, String(id));
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown>;
  return mapDocument(row);
}

function mapDocument(row: Record<string, unknown>): BrainDocumentChunk {
  return {
    id: String(row.id),
    name: String(row.name),
    content: String(row.content),
    category: (BRAIN_CATEGORIES.includes(String(row.category) as BrainCategory) ? row.category : "general") as BrainCategory,
    keywords: JSON.parse(String(row.keywords ?? "[]")) as string[],
    source: String(row.source),
    hash: String(row.hash),
    createdAt: String(row.created_at),
    path: row.path ? String(row.path) : undefined,
    section: row.section ? String(row.section) : undefined,
    symbol: row.symbol ? String(row.symbol) : undefined,
    language: row.language ? String(row.language) : undefined,
    docVersion: row.doc_version ? String(row.doc_version) : undefined,
    docSha256: row.doc_sha256 ? String(row.doc_sha256) : undefined,
    retrievedAt: row.retrieved_at ? String(row.retrieved_at) : undefined,
  };
}

function syncResearchFts(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM research_fts WHERE id = ?").run(id);
  const row = db.prepare("SELECT id, title, content, keywords FROM research WHERE id = ?").get(id) as { id: string; title: string; content: string; keywords: string } | undefined;
  if (row) db.prepare("INSERT INTO research_fts(id, title, content, keywords) VALUES (?, ?, ?, ?)").run(row.id, row.title, row.content, row.keywords);
}

function syncDocumentFts(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM document_fts WHERE id = ?").run(id);
  const row = db.prepare("SELECT id, name, content, keywords FROM documents WHERE id = ?").get(id) as { id: string; name: string; content: string; keywords: string } | undefined;
  if (row) db.prepare("INSERT INTO document_fts(id, name, content, keywords) VALUES (?, ?, ?, ?)").run(row.id, row.name, row.content, row.keywords);
}

export function getDocument(db: DatabaseSync, id: string): BrainDocumentChunk | null {
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : null;
}

export function listDocuments(db: DatabaseSync, limit = 500): BrainDocumentChunk[] {
  const rows = db.prepare("SELECT * FROM documents ORDER BY created_at DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 2000)) as Array<Record<string, unknown>>;
  return rows.map(mapDocument);
}

export function getResearch(db: DatabaseSync, id: string): BrainResearchRecord | null {
  const row = db.prepare("SELECT * FROM research WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapResearch(row) : null;
}

export function listResearch(db: DatabaseSync, limit = 200): BrainResearchRecord[] {
  const rows = db.prepare("SELECT * FROM research ORDER BY created_at DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 1000)) as Array<Record<string, unknown>>;
  return rows.map(mapResearch);
}

export interface BrainFtsError {
  table: string;
  message: string;
  at: string;
}

const FTS_ERROR_LIMIT = 20;
const ftsErrors: BrainFtsError[] = [];

/** Exposed through brain status so a failed FTS query is never silent. */
export function getFtsErrors(): BrainFtsError[] {
  return ftsErrors.map((error) => ({ ...error }));
}

export function clearFtsErrors(): void {
  ftsErrors.splice(0, ftsErrors.length);
}

export function ftsTerms(query: string): string {
  // Unicode letters/numbers keep CJK and accented documentation searchable.
  // Quoting each term preserves the previous FTS5 MATCH shape for ASCII input.
  return Array.from(new Set(String(query).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []))
    .slice(0, 12)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" OR ");
}

export type BrainFtsTable = "brain_fts" | "message_fts" | "document_fts" | "research_fts";

export function searchFts(db: DatabaseSync, table: BrainFtsTable, query: string, limit = 20): Array<{ id: string; score: number }> {
  const terms = ftsTerms(query);
  if (!terms) return [];
  try {
    const rows = db.prepare(`SELECT id, bm25(${table}) AS score FROM ${table} WHERE ${table} MATCH ? ORDER BY score ASC LIMIT ?`).all(terms, limit) as Array<{ id: string; score: number }>;
    return rows.map((row) => ({ id: String(row.id), score: Number(row.score) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ftsErrors.unshift({ table, message: message.slice(0, 300), at: new Date().toISOString() });
    if (ftsErrors.length > FTS_ERROR_LIMIT) ftsErrors.length = FTS_ERROR_LIMIT;
    return [];
  }
}

export function storeEmbedding(db: DatabaseSync, id: string, model: string, vector: number[]): void {
  const buffer = Buffer.from(new Float32Array(vector).buffer);
  const createdAt = new Date().toISOString();
  withSavepoint(db, "store_embedding", () => {
    db.prepare(`INSERT INTO embeddings(id, model, vector, dim, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET model = excluded.model, vector = excluded.vector, dim = excluded.dim, created_at = excluded.created_at`)
      .run(id, model, buffer, vector.length, createdAt);
    db.prepare(`INSERT INTO embeddings_v2(id, model, vector, dim, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id, model) DO UPDATE SET vector = excluded.vector, dim = excluded.dim, created_at = excluded.created_at`)
      .run(id, model, buffer, vector.length, createdAt);
  });
}

function vectorFromRow(row: { vector: Buffer } | undefined): number[] | null {
  if (!row) return null;
  return Array.from(new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength)));
}

export function getEmbedding(db: DatabaseSync, id: string, model: string): number[] | null {
  const versioned = db.prepare("SELECT vector FROM embeddings_v2 WHERE id = ? AND model = ?").get(id, model) as { vector: Buffer } | undefined;
  if (versioned) return vectorFromRow(versioned);
  const legacy = db.prepare("SELECT vector FROM embeddings WHERE id = ? AND model = ?").get(id, model) as { vector: Buffer } | undefined;
  return vectorFromRow(legacy);
}

export function getEmbeddingModel(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT model FROM embeddings_v2 ORDER BY created_at DESC LIMIT 1").get() as { model?: string } | undefined;
  return row?.model ?? null;
}

/** Removes vectors whose source record was deleted, freeing local disk space. */
export function cleanupOrphanedEmbeddings(db: DatabaseSync): number {
  const orphanClause = `id NOT IN (
    SELECT id FROM knowledge UNION SELECT id FROM messages UNION SELECT id FROM documents
    UNION SELECT id FROM research UNION SELECT id FROM corrections
  )`;
  return withSavepoint(db, "cleanup_embeddings", () => {
    const legacy = Number(db.prepare(`DELETE FROM embeddings WHERE ${orphanClause}`).run().changes);
    const versioned = Number(db.prepare(`DELETE FROM embeddings_v2 WHERE ${orphanClause}`).run().changes);
    return legacy + versioned;
  });
}

export function logRetrieval(db: DatabaseSync, query: string, items: Array<{ id: string; type: string; score: number }>): void {
  const now = new Date().toISOString();
  const stmt = db.prepare("INSERT INTO retrieval_log(query, result_id, result_type, score, created_at) VALUES (?, ?, ?, ?, ?)");
  withSavepoint(db, "retrieval_log", () => {
    for (const item of items.slice(0, 10)) stmt.run(query.slice(0, 500), item.id, item.type, item.score, now);
    // Keep telemetry bounded; the log is for inspection, not an audit archive.
    db.prepare("DELETE FROM retrieval_log WHERE id NOT IN (SELECT id FROM retrieval_log ORDER BY id DESC LIMIT 5000)").run();
    for (const item of items) {
      if (item.type === "knowledge") db.prepare("UPDATE knowledge SET retrieval_count = retrieval_count + 1 WHERE id = ?").run(item.id);
    }
  });
}

export function brainStats(
  db: DatabaseSync,
  dbPath = brainDbPath(),
  integrity: string = integrityCheck(db),
): BrainStats {
  const count = (table: string): number => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  const categories = Number((db.prepare("SELECT COUNT(DISTINCT category) AS n FROM knowledge").get() as { n: number }).n);
  const databaseBytes = existsSync(/* turbopackIgnore: true */ dbPath) ? statSync(/* turbopackIgnore: true */ dbPath).size : 0;
  const recent = db.prepare("SELECT id, title, content, category, created_at, verification FROM knowledge ORDER BY created_at DESC LIMIT 8").all() as Array<Record<string, unknown>>;
  const frequent = db.prepare("SELECT id, title, retrieval_count FROM knowledge ORDER BY retrieval_count DESC, updated_at DESC LIMIT 8").all() as Array<Record<string, unknown>>;
  const growth = db.prepare(`SELECT substr(created_at, 1, 10) AS date,
      SUM(CASE WHEN kind = 'conversation' THEN 1 ELSE 0 END) AS conversations,
      SUM(CASE WHEN kind = 'knowledge' THEN 1 ELSE 0 END) AS knowledge
    FROM (
      SELECT created_at, 'conversation' AS kind FROM conversations
      UNION ALL
      SELECT created_at, 'knowledge' AS kind FROM knowledge
    ) GROUP BY substr(created_at, 1, 10) ORDER BY date DESC LIMIT 30`).all() as Array<{ date: string; conversations: number; knowledge: number }>;
  const lastBackup = db.prepare("SELECT created_at FROM backups ORDER BY id DESC LIMIT 1").get() as { created_at?: string } | undefined;
  return {
    conversations: count("conversations"),
    messages: count("messages"),
    knowledgeEntries: count("knowledge"),
    extractedFacts: count("knowledge"),
    corrections: count("corrections"),
    researchRecords: count("research"),
    documents: count("documents"),
    categories,
    databaseBytes,
    lastBackupAt: lastBackup?.created_at,
    integrity,
    ftsErrors: getFtsErrors(),
    schemaVersion: SCHEMA_VERSION,
    recentKnowledge: recent.map((row) => ({ id: String(row.id), title: String(row.title), content: String(row.content), category: (BRAIN_CATEGORIES.includes(String(row.category) as BrainCategory) ? row.category : "general") as BrainCategory, createdAt: String(row.created_at), verification: String(row.verification) as BrainKnowledgeEntry["verification"] })),
    frequent: frequent.map((row) => ({ id: String(row.id), title: String(row.title), retrievalCount: Number(row.retrieval_count) })),
    growth: growth.map((row) => ({ date: String(row.date), conversations: Number(row.conversations), knowledge: Number(row.knowledge) })),
  };
}

export function listBackups(db: DatabaseSync): Array<{ id: number; path: string; size: number; integrity: string; createdAt: string }> {
  const rows = db.prepare("SELECT id, path, size, integrity, created_at FROM backups ORDER BY id DESC").all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({ id: Number(row.id), path: String(row.path), size: Number(row.size), integrity: String(row.integrity), createdAt: String(row.created_at) }));
}

export function listLocalBackupFiles(): string[] {
  if (!existsSync(backupsDir())) return [];
  return readdirSync(backupsDir()).filter((name) => name.endsWith(".sqlite")).map((name) => join(backupsDir(), name));
}

export interface BrainExportEnvelope {
  format: "davidai-brain";
  /** v1 envelopes remain importable; v2 adds version/attribution metadata. */
  version: 1 | 2;
  kind: "full" | "knowledge" | "conversations";
  exportedAt: string;
  data: {
    conversations?: BrainConversation[];
    knowledge?: BrainKnowledgeEntry[];
    corrections?: BrainCorrection[];
    research?: BrainResearchRecord[];
    documents?: BrainDocumentChunk[];
  };
}

export function exportBrainData(db: DatabaseSync, kind: "full" | "knowledge" | "conversations" = "full"): BrainExportEnvelope {
  const envelope: BrainExportEnvelope = { format: "davidai-brain", version: 2, kind, exportedAt: new Date().toISOString(), data: {} };
  if (kind === "full" || kind === "conversations") envelope.data.conversations = listConversations(db, 1000);
  if (kind === "full" || kind === "knowledge") {
    envelope.data.knowledge = listKnowledge(db, { limit: 1000 });
    if (kind === "full") {
      envelope.data.corrections = listCorrections(db);
      envelope.data.research = listResearch(db);
      envelope.data.documents = listDocuments(db);
    }
  }
  return envelope;
}

export function listCorrections(db: DatabaseSync, limit = 500): BrainCorrection[] {
  const rows = db.prepare("SELECT * FROM corrections ORDER BY created_at DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 2000)) as Array<Record<string, unknown>>;
  return rows.map(mapCorrection);
}

export function importBrainData(db: DatabaseSync, envelope: unknown): BrainStats {
  if (!envelope || typeof envelope !== "object") throw new Error("The import file is not a DavidAI brain export.");
  const data = envelope as Partial<BrainExportEnvelope>;
  if (data.format !== "davidai-brain" || (data.version !== 1 && data.version !== 2) || !data.data || typeof data.data !== "object") {
    throw new Error("Unsupported brain export format.");
  }
  const payload = data.data;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  // Hashes are content identities, not trusted input. Recompute them from the
  // same normalized text that will actually be stored, even on imported files.
  // One savepoint also makes a partial or invalid import impossible.
  return withSavepoint(db, "brain_import", () => {
    for (const conversation of list(payload.conversations)) {
      if (!conversation || typeof conversation !== "object") continue;
      const item = conversation as Partial<BrainConversation>;
      if (!item.id || !Array.isArray(item.messages)) continue;
      saveConversation(db, item as BrainConversation);
    }
    for (const value of list(payload.knowledge)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Partial<BrainKnowledgeEntry>;
      if (!entry.content) continue;
      const { createdAt: _createdAt, updatedAt: _updatedAt, retrievalCount: _retrievalCount, hash: _hash, id, ...rest } = entry;
      if (id && getKnowledge(db, id)) continue;
      const content = String(entry.content).slice(0, 2000);
      const category = BRAIN_CATEGORIES.includes(entry.category as BrainCategory) ? entry.category as BrainCategory : "general";
      const verification: BrainKnowledgeEntry["verification"] = ["unverified", "user-reported", "sourced", "disputed", "outdated"].includes(String(entry.verification))
        ? entry.verification as BrainKnowledgeEntry["verification"]
        : "unverified";
      const sourceType: BrainKnowledgeEntry["sourceType"] = ["conversation", "user_correction", "web_research", "document", "manual", "dataset"].includes(String(entry.sourceType))
        ? entry.sourceType as BrainKnowledgeEntry["sourceType"]
        : "manual";
      upsertKnowledge(db, {
        ...rest,
        id,
        title: String(entry.title ?? "Imported knowledge").slice(0, 240),
        content,
        category,
        keywords: Array.isArray(entry.keywords) ? entry.keywords.map(String).slice(0, 40) : [],
        source: String(entry.source ?? "import"),
        sourceType,
        confidence: Number.isFinite(entry.confidence) ? Number(entry.confidence) : 0.6,
        verification,
        relatedIds: Array.isArray(entry.relatedIds) ? entry.relatedIds.map(String).slice(0, 50) : [],
        hash: hashBrainText(content),
      });
    }
    const seenCorrections = new Set<string>();
    for (const value of list(payload.corrections)) {
      if (!value || typeof value !== "object") continue;
      const correction = value as Partial<BrainCorrection>;
      if (!correction.corrected) continue;
      const conversationId = String(correction.conversationId ?? "");
      const messageId = String(correction.messageId ?? "");
      const original = String(correction.original ?? "").slice(0, 1000);
      const corrected = String(correction.corrected).slice(0, 1000);
      const key = `${conversationId}\u0000${messageId}\u0000${original}\u0000${corrected}`;
      if (seenCorrections.has(key)) continue;
      const exists = db.prepare("SELECT 1 FROM corrections WHERE conversation_id = ? AND message_id = ? AND original = ? AND corrected = ? LIMIT 1")
        .get(conversationId, messageId, original, corrected);
      if (exists) continue;
      seenCorrections.add(key);
      insertCorrection(db, {
        knowledgeId: String(correction.knowledgeId ?? ""),
        conversationId,
        messageId,
        original,
        corrected,
        source: String(correction.source ?? "import"),
        confidence: Number.isFinite(correction.confidence) ? Number(correction.confidence) : 0.5,
      });
    }
    for (const value of list(payload.research)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Partial<BrainResearchRecord>;
      if (!record.content) continue;
      const { hash: _hash, ...rest } = record;
      upsertResearch(db, {
        ...rest,
        title: String(record.title ?? "Imported research"),
        content: String(record.content),
        sourceUrl: record.sourceUrl,
        sourceTitle: record.sourceTitle,
        keywords: Array.isArray(record.keywords) ? record.keywords : [],
      });
    }
    for (const value of list(payload.documents)) {
      if (!value || typeof value !== "object") continue;
      const chunk = value as Partial<BrainDocumentChunk>;
      if (!chunk.content) continue;
      const { hash: _hash, ...rest } = chunk;
      upsertDocumentChunk(db, {
        ...rest,
        name: String(chunk.name ?? "Imported document"),
        content: String(chunk.content),
        category: chunk.category ?? "general",
        keywords: Array.isArray(chunk.keywords) ? chunk.keywords : [],
        source: String(chunk.source ?? "import"),
      });
    }
    return brainStats(db);
  });
}

export function closeBrainDb(): void {
  if (!singleton) return;
  try { singleton.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* ignore */ }
  singleton.close();
  singleton = null;
}

export function restoreBrainBackup(backupPath: string, options?: { backupRoot?: string; livePath?: string }): BrainStats {
  const root = resolve(/* turbopackIgnore: true */ options?.backupRoot ?? backupsDir());
  const target = resolve(/* turbopackIgnore: true */ backupPath);
  if (!target.startsWith(`${root}${sep}`)) throw new Error("Restores are only allowed from the local brain backup folder.");
  if (!existsSync(target)) throw new Error("That backup file no longer exists.");
  const verifier = new DatabaseSync(target, { readOnly: true });
  let integrity = "unknown";
  try {
    integrity = String((verifier.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined)?.integrity_check ?? "unknown");
  } finally {
    verifier.close();
  }
  if (integrity !== "ok") throw new Error(`Backup integrity check failed: ${integrity}`);
  const livePath = options?.livePath ?? brainDbPath();
  if (livePath === brainDbPath()) closeBrainDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const staged = `${livePath}.restore-${stamp}`;
  copyFileSync(target, staged);
  try {
    copyFileSync(staged, livePath);
    for (const suffix of ["-wal", "-shm"]) {
      try { unlinkSync(`${livePath}${suffix}`); } catch { /* ignore */ }
    }
  } finally {
    rmSync(staged, { force: true });
  }
  const reopened = livePath === brainDbPath()
    ? getBrainDb({ autoBackup: false })
    : getBrainDb({ path: livePath, autoBackup: false });
  return brainStats(reopened, livePath);
}

export { randomUUID };
