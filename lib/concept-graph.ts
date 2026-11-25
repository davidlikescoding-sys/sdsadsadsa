import type { Correction, DictionaryWord, KnowledgeEntry } from "./types";

/** Raw lowercased words, kept unstemmed so graph IDs match conceptKey output. */
export function rawTerms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 1);
}

export type ConceptRelation = "synonym" | "related" | "topic" | "cooccurrence" | "learned";

export interface ConceptNode {
  id: string;
  label: string;
  kind: "word" | "topic" | "knowledge" | "learned";
  occurrences: number;
}

export interface ConceptEdge {
  from: string;
  to: string;
  relation: ConceptRelation;
  weight: number;
  source: string;
  updatedAt?: string;
}

export interface ConceptGraph {
  nodes: Record<string, ConceptNode>;
  edges: ConceptEdge[];
  adjacency: Record<string, ConceptEdge[]>;
}

export interface ConceptGraphInput {
  dictionary: DictionaryWord[];
  knowledge: KnowledgeEntry[];
  learned?: ConceptEdge[];
  maxDictionaryWords?: number;
}

const MAX_EDGES_PER_NODE = 6;
const MAX_KNOWLEDGE_TERMS = 5;

export function conceptKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "_");
}

export function conceptLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function ensureNode(
  graph: ConceptGraph,
  value: string,
  kind: ConceptNode["kind"],
  occurrences = 1,
): string {
  const id = conceptKey(value);
  if (!id) return "";
  const existing = graph.nodes[id];
  if (existing) {
    existing.occurrences += occurrences;
    if (existing.kind === "learned" && kind !== "learned") existing.kind = kind;
    return id;
  }
  graph.nodes[id] = { id, label: conceptLabel(id), kind, occurrences };
  return id;
}

function addEdge(
  graph: ConceptGraph,
  from: string,
  to: string,
  relation: ConceptRelation,
  weight: number,
  source: string,
): void {
  if (!from || !to || from === to) return;
  const push = (a: string, b: string) => {
    const forward = graph.adjacency[a] ?? [];
    const duplicate = forward.find((edge) => edge.to === b && edge.relation === relation);
    if (duplicate) {
      duplicate.weight = Math.min(1, duplicate.weight + weight * 0.1);
      duplicate.source = source;
      return;
    }
    if (forward.length >= MAX_EDGES_PER_NODE) return;
    const edge: ConceptEdge = { from: a, to: b, relation, weight: Math.max(0.05, Math.min(1, weight)), source };
    forward.push(edge);
    graph.adjacency[a] = forward;
    graph.edges.push(edge);
  };
  push(from, to);
  // Symmetric relationships must be traversable from either concept; a
  // dictionary synonym is useless to retrieval if only one direction exists.
  if (relation === "synonym" || relation === "related" || relation === "cooccurrence") push(to, from);
}

/**
 * Build a real concept network from local dictionary metadata, knowledge
 * entries and feedback-learned edges. Nothing here is a per-question rule: the
 * graph only records relationships that already exist in the user's data.
 */
export function buildConceptGraph(input: ConceptGraphInput): ConceptGraph {
  const graph: ConceptGraph = { nodes: {}, edges: [], adjacency: {} };
  const dictionary = input.dictionary.slice(0, input.maxDictionaryWords ?? 6000);

  for (const word of dictionary) {
    const id = ensureNode(graph, word.word, "word");
    if (!id) continue;
    for (const synonym of word.synonyms ?? []) {
      const target = ensureNode(graph, synonym, "word");
      addEdge(graph, id, target, "synonym", 0.95, `dictionary:${word.id}`);
    }
    for (const related of word.related ?? []) {
      const target = ensureNode(graph, related, "word");
      addEdge(graph, id, target, "related", 0.75, `dictionary:${word.id}`);
    }
    for (const topic of word.topics ?? []) {
      const target = ensureNode(graph, topic, "topic");
      addEdge(graph, id, target, "topic", 0.55, `dictionary:${word.id}`);
      addEdge(graph, target, id, "related", 0.4, `dictionary:${word.id}`);
    }
  }

  for (const entry of input.knowledge) {
    const entryId = ensureNode(graph, entry.title, "knowledge");
    const categoryId = ensureNode(graph, entry.category, "topic");
    addEdge(graph, entryId, categoryId, "topic", 0.5, `knowledge:${entry.id}`);
    const terms = Array.from(new Set(rawTerms(`${entry.title} ${entry.content}`))).slice(0, MAX_KNOWLEDGE_TERMS);
    for (const term of terms) {
      const termId = ensureNode(graph, term, "word", 1);
      addEdge(graph, termId, entryId, "related", 0.7, `knowledge:${entry.id}`);
      addEdge(graph, entryId, termId, "related", 0.65, `knowledge:${entry.id}`);
    }
    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        addEdge(graph, conceptKey(terms[i]), conceptKey(terms[j]), "cooccurrence", 0.35, `knowledge:${entry.id}`);
      }
    }
  }

  for (const edge of input.learned ?? []) {
    ensureNode(graph, conceptLabel(edge.from), edge.relation === "learned" ? "learned" : "word");
    ensureNode(graph, conceptLabel(edge.to), edge.relation === "learned" ? "learned" : "word");
    addEdge(graph, edge.from, edge.to, edge.relation, edge.weight, edge.source);
  }
  return graph;
}

/** One-hop and two-hop related concepts, with weaker weight at greater depth. */
export function expandConcepts(terms: string[], graph: ConceptGraph, max = 10): string[] {
  const seeds = Array.from(new Set(terms.map(conceptKey).filter(Boolean)));
  const seedSet = new Set(seeds);
  const found = new Map<string, number>();
  for (const seed of seeds) {
    for (const edge of graph.adjacency[seed] ?? []) {
      if (seedSet.has(edge.to)) continue;
      found.set(edge.to, Math.max(found.get(edge.to) ?? 0, edge.weight));
    }
  }
  for (const first of Array.from(found.keys())) {
    for (const edge of graph.adjacency[first] ?? []) {
      if (seedSet.has(edge.to) || found.has(edge.to)) continue;
      found.set(edge.to, (found.get(first) ?? 0) * edge.weight * 0.6);
    }
  }
  return Array.from(found.entries())
    .filter(([, weight]) => weight >= 0.2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([id]) => conceptLabel(id));
}

export function relatedConcepts(term: string, graph: ConceptGraph, limit = 6): Array<{ label: string; relation: ConceptRelation; weight: number }> {
  const id = conceptKey(term);
  return (graph.adjacency[id] ?? [])
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((edge) => ({ label: conceptLabel(edge.to), relation: edge.relation, weight: edge.weight }));
}

/**
 * Feedback creates associations between the question's subject words and the
 * corrected answer's words. These are stored separately from model weights:
 * approving a correction changes concept memory immediately, but never claims
 * to have retrained the neural model.
 */
export function edgesFromCorrection(correction: Correction): ConceptEdge[] {
  const questionTerms = Array.from(new Set(rawTerms(correction.question))).slice(0, 4);
  const answerTerms = Array.from(new Set(rawTerms(correction.correctedAnswer))).slice(0, 4);
  const explanationTerms = Array.from(new Set(rawTerms(correction.explanation))).slice(0, 3);
  const edges: ConceptEdge[] = [];
  const stamp = correction.updatedAt || new Date().toISOString();
  for (const from of questionTerms) {
    for (const to of [...answerTerms, ...explanationTerms]) {
      const fromId = conceptKey(from);
      const toId = conceptKey(to);
      if (!fromId || !toId || fromId === toId) continue;
      edges.push({
        from: fromId,
        to: toId,
        relation: "learned",
        weight: 0.7,
        source: `correction:${correction.id}`,
        updatedAt: stamp,
      });
    }
  }
  return edges;
}

export function mergeConceptEdges(existing: ConceptEdge[], incoming: ConceptEdge[]): ConceptEdge[] {
  const merged = new Map<string, ConceptEdge>();
  for (const edge of [...existing, ...incoming]) {
    if (!edge.from || !edge.to) continue;
    const key = `${edge.from}|${edge.to}|${edge.relation}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...edge, weight: Math.max(0.05, Math.min(1, edge.weight)) });
      continue;
    }
    current.weight = Math.min(1, Math.max(current.weight, edge.weight) + 0.05);
    current.updatedAt = edge.updatedAt ?? current.updatedAt;
    current.source = edge.source;
  }
  return Array.from(merged.values()).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function conceptGraphStats(graph: ConceptGraph): { nodes: number; edges: number; learned: number } {
  return {
    nodes: Object.keys(graph.nodes).length,
    edges: graph.edges.length,
    learned: graph.edges.filter((edge) => edge.relation === "learned").length,
  };
}
