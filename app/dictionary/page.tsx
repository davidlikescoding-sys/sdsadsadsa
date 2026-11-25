"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { DICTIONARY_TOPICS, isNewWord, searchDictionary } from "@/lib/dictionary";
import type { DictionaryCategory, DictionaryWord } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Stat, Textarea } from "@/components/ui";

const CATEGORIES: Array<{ value: "all" | DictionaryCategory; label: string }> = [
  { value: "all", label: "All words" },
  { value: "noun", label: "Nouns" },
  { value: "verb", label: "Verbs" },
  { value: "adjective", label: "Adjectives" },
  { value: "adverb", label: "Adverbs" },
  { value: "pronoun", label: "Pronouns" },
  { value: "article", label: "Articles" },
  { value: "preposition", label: "Prepositions" },
  { value: "conjunction", label: "Conjunctions" },
  { value: "other", label: "Other" },
];

const EMPTY_FORM = { word: "", definition: "", partOfSpeech: "noun" as DictionaryCategory, example: "", related: "", synonyms: "", topics: "" };

export default function DictionaryPage() {
  const { dictionary, addDictionaryWord, updateDictionaryWord, deleteDictionaryWord, importDictionary, reviewDictionaryWord, settings } = useStore();
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | DictionaryCategory>("all");
  const [topic, setTopic] = useState("all");
  const [visibleCount, setVisibleCount] = useState(200);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...dictionary].sort((a, b) => a.word.localeCompare(b.word, "en", { sensitivity: "base" })),
    [dictionary],
  );
  const visible = useMemo(
    () => searchDictionary(sorted, search).filter((word) =>
      (category === "all" || word.partOfSpeech === category) &&
      (topic === "all" || (word.topics ?? []).includes(topic))),
    [sorted, search, category, topic],
  );
  const paged = useMemo(() => visible.slice(0, visibleCount), [visible, visibleCount]);
  const newlyLearnedWords = useMemo(
    () => dictionary.filter((word) => word.source !== "bundled" && isNewWord(word)).slice(0, 10),
    [dictionary],
  );
  const selected = dictionary.find((word) => word.id === selectedId) ?? null;
  const newlyLearned = dictionary.filter((word) => isNewWord(word)).length;
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const word of dictionary) map.set(word.partOfSpeech, (map.get(word.partOfSpeech) ?? 0) + 1);
    return map;
  }, [dictionary]);

  const startAdd = () => {
    setError(null);
    setEditingId("new");
    setForm(EMPTY_FORM);
  };

  const startEdit = (word: DictionaryWord) => {
    setError(null);
    setEditingId(word.id);
    setForm({
      word: word.word, definition: word.definition, partOfSpeech: word.partOfSpeech,
      example: word.example, related: word.related.join(", "),
      synonyms: (word.synonyms ?? []).join(", "), topics: (word.topics ?? []).join(", "),
    });
  };

  const save = () => {
    if (!form.word.trim()) { setError("A word is required."); return; }
    if (!form.definition.trim()) { setError("A definition is required."); return; }
    const related = form.related.split(",").map((item) => item.trim()).filter(Boolean);
    const synonyms = form.synonyms.split(",").map((item) => item.trim()).filter(Boolean);
    const topics = form.topics.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    const payload = { word: form.word, definition: form.definition, partOfSpeech: form.partOfSpeech,
      example: form.example, related, synonyms, topics };
    try {
      if (editingId === "new") {
        const created = addDictionaryWord(payload);
        setSelectedId(created.id);
      } else if (editingId) {
        updateDictionaryWord(editingId, payload);
        setSelectedId(editingId);
      }
      setEditingId(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = (word: DictionaryWord) => {
    deleteDictionaryWord(word.id);
    if (selectedId === word.id) setSelectedId(null);
    if (editingId === word.id) setEditingId(null);
  };

  const letterGroups = useMemo(() => {
    const groups = new Map<string, DictionaryWord[]>();
    for (const word of paged) {
      const letter = (word.word[0] ?? "#").toUpperCase();
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter)!.push(word);
    }
    return [...groups.entries()];
  }, [paged]);

  return (
    <>
      <PageHeader
        eyebrow="Language Learning"
        title="Dictionary"
        description="DavidAI's real stored vocabulary. Words are searched and injected into chat responses when the conversation actually mentions them. Changes here persist across refreshes and restart."
        actions={<Button variant="outline" onClick={() => setOpen((value) => !value)}>{open ? "Close dictionary" : "Open dictionary"}</Button>}
      />
      <ErrorBox message={error} />
      {notice && <div className="mb-4 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Known words" value={dictionary.length} />
        <Stat label="Newly learned" value={newlyLearned} tone="green" />
        <Stat label="Bundled dataset" value={dictionary.filter((word) => word.source === "bundled").length} />
        <Stat label="Nouns" value={counts.get("noun") ?? 0} />
        <Stat label="Verbs" value={counts.get("verb") ?? 0} />
      </div>

      {newlyLearnedWords.length > 0 && (
        <Card title="Newly learned words" subtitle="Your additions and corrections — retrievable in chat now" className="mb-4">
          <div className="flex flex-wrap gap-1.5">
            {newlyLearnedWords.map((word) => (
              <button key={word.id} type="button" onClick={() => setSelectedId(word.id)}
                className="focus-ring rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-xs text-emerald-200 hover:border-emerald-400/60">
                {word.word}
              </button>
            ))}
          </div>
        </Card>
      )}

      {!open ? (
        <Card>
          <EmptyState title="Dictionary closed" description="Use the Open dictionary button above to browse and edit DavidAI's words." />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card title="Words" subtitle={`${paged.length} of ${visible.length} matching · ${dictionary.length} stored · sorted A–Z`} action={<Button variant="primary" size="sm" onClick={startAdd}>+ Add word</Button>}>
            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(200); }} placeholder="Search words, definitions, examples…" />
              <Select value={category} onChange={(event) => { setCategory(event.target.value as "all" | DictionaryCategory); setVisibleCount(200); }}>
                {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </Select>
              <Select value={topic} onChange={(event) => { setTopic(event.target.value); setVisibleCount(200); }}>
                <option value="all">All topics</option>
                {DICTIONARY_TOPICS.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowImport((value) => !value)}>{showImport ? "Hide import" : "Import dictionary dataset"}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setCategory("all"); setTopic("all"); setVisibleCount(200); }}>Reset filters</Button>
            </div>
            {showImport && (
              <div className="mb-4 space-y-2 rounded border hairline bg-black/20 p-3">
                <Textarea rows={3} value={importText} onChange={(event) => setImportText(event.target.value)}
                  placeholder='Paste a JSON array of words or { "entries": [...] }' className="text-xs" />
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" disabled={!importText.trim()} onClick={() => {
                    try {
                      const added = importDictionary(importText);
                      setError(null);
                      setNotice(added.length ? `Imported ${added.length} word(s).` : "All entries already exist.");
                      setImportText("");
                    } catch (e) { setNotice(null); setError(e instanceof Error ? e.message : String(e)); }
                  }}>Import</Button>
                  <Button size="sm" variant="ghost" onClick={() => setImportText("")}>Clear</Button>
                </div>
              </div>
            )}
            {!visible.length ? (
              <EmptyState title="No words found" description="Try a different search or add a new word." />
            ) : (
              <div className="max-h-[620px] space-y-4 overflow-y-auto pr-1">
                {letterGroups.map(([letter, words]) => (
                  <div key={letter}>
                    <div className="mono-label mb-1 sticky top-0 bg-[#0b0f15]/95 py-1 text-cyan-400/80">{letter}</div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {words.map((word) => (
                        <button
                          key={word.id}
                          type="button"
                          onClick={() => setSelectedId(word.id)}
                          className={`focus-ring rounded border p-2.5 text-left transition-colors ${selectedId === word.id ? "border-cyan-500/50 bg-cyan-500/10" : "hairline bg-black/20 hover:border-cyan-500/30"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-slate-100">{word.word}</span>
                            <span className="font-mono text-[9px] uppercase text-slate-500">{word.partOfSpeech}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] text-[var(--muted)]">{word.definition}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {isNewWord(word) && <Badge tone="green">new</Badge>}
                            {word.useCount > 0 && <Badge tone="cyan">used {word.useCount}×</Badge>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {visible.length > paged.length && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setVisibleCount((value) => value + 200)}>
                Show 200 more of {visible.length - paged.length}
              </Button>
            )}
          </Card>

          <div className="space-y-4">
            {editingId && (
              <Card title={editingId === "new" ? "Add a word" : "Edit word"}>
                <div className="space-y-3">
                  <Field label="Word"><Input value={form.word} onChange={(event) => setForm({ ...form, word: event.target.value })} placeholder="e.g. Apple" /></Field>
                  <Field label="Definition"><Textarea rows={3} value={form.definition} onChange={(event) => setForm({ ...form, definition: event.target.value })} placeholder="What does it mean?" /></Field>
                  <Field label="Part of speech">
                    <Select value={form.partOfSpeech} onChange={(event) => setForm({ ...form, partOfSpeech: event.target.value as DictionaryCategory })}>
                      {CATEGORIES.filter((item) => item.value !== "all").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Example sentence"><Input value={form.example} onChange={(event) => setForm({ ...form, example: event.target.value })} placeholder="I learn English every day." /></Field>
                  <Field label="Synonyms" hint="Separate with commas"><Input value={form.synonyms} onChange={(event) => setForm({ ...form, synonyms: event.target.value })} placeholder="apple, fruit" /></Field>
                  <Field label="Topics" hint="e.g. nature, science, emotions"><Input value={form.topics} onChange={(event) => setForm({ ...form, topics: event.target.value })} placeholder="nature, food" /></Field>
                  <Field label="Related words" hint="Separate with commas"><Input value={form.related} onChange={(event) => setForm({ ...form, related: event.target.value })} placeholder="fruit, tree, red" /></Field>
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={save}>Save word</Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              </Card>
            )}

            <Card title="Word details" subtitle={selected ? "Retrievable by DavidAI during chat" : "Select a word to inspect it"}>
              {!selected ? (
                <EmptyState title="No word selected" description="Click any word in the list to see its definition, part of speech, example and related words." />
              ) : (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-xl font-semibold tracking-tight text-slate-50">{selected.word}</h3>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone="cyan">{selected.partOfSpeech}</Badge>
                      {isNewWord(selected) && <Badge tone="green">new</Badge>}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-200">{selected.definition}</p>
                  <div className="mt-4 border-t hairline pt-3">
                    <div className="mono-label mb-1">Example sentence</div>
                    <p className="text-sm italic text-slate-300">“{selected.example || "No example yet."}”</p>
                  </div>
                  <div className="mt-4 border-t hairline pt-3">
                    <div className="mono-label mb-1">Synonyms</div>
                    {selected.synonyms?.length ? (
                      <div className="flex flex-wrap gap-1">{selected.synonyms.map((value) => <Badge key={value}>{value}</Badge>)}</div>
                    ) : <p className="text-xs text-[var(--muted)]">none</p>}
                  </div>
                  <div className="mt-4 border-t hairline pt-3">
                    <div className="mono-label mb-1">Topics</div>
                    {selected.topics?.length ? (
                      <div className="flex flex-wrap gap-1">{selected.topics.map((value) => <Badge key={value} tone="cyan">{value}</Badge>)}</div>
                    ) : <p className="text-xs text-[var(--muted)]">none</p>}
                  </div>
                  <div className="mt-4 border-t hairline pt-3">
                    <div className="mono-label mb-1">Related words</div>
                    {selected.related.length ? (
                      <div className="flex flex-wrap gap-1">
                        {selected.related.map((related) => <Badge key={related}>{related}</Badge>)}
                      </div>
                    ) : <p className="text-xs text-[var(--muted)]">none</p>}
                  </div>
                  <div className="mt-4 border-t hairline pt-3 font-mono text-[10px] text-[var(--muted)]">
                    ADDED {new Date(selected.createdAt).toLocaleString()} · USED {selected.useCount}× · SOURCE {selected.source ?? "user"}
                    {settings.useGroundedAnswers ? " · GROUNDED ANSWERS ON" : ""}
                  </div>
                  {selected.reviewStatus === "pending" && (
                    <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                      <p className="mb-2 text-[11px] text-amber-200">User correction — retrievable now, not yet verified.</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => reviewDictionaryWord(selected.id, "approved")}>Approve</Button>
                        <Button size="sm" variant="ghost" onClick={() => reviewDictionaryWord(selected.id, "rejected")}>Reject</Button>
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => startEdit(selected)}>Edit</Button>
                    <Button variant="danger" size="sm" onClick={() => remove(selected)}>Delete</Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
