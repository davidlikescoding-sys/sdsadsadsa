"use client";

import { useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { PageHeader, Card, Button, Input, Textarea, Field, EmptyState, Badge, ConfirmDialog, formatNumber, timeAgo } from "@/components/ui";

export default function DatasetsPage() {
  const {
    datasets, addDataset, addFiles, updateDataset, deleteDataset, selectedDatasetIds, setSelectedDatasetIds,
    findDuplicateDataset, combineDatasets, exportDatasets, importDatasets,
    datasetStats, combinedStats, config,
  } = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => Array.from(new Set(datasets.map((d) => d.category || "General"))).sort(), [datasets]);
  const filtered = datasets.filter((d) =>
    (categoryFilter === "all" || (d.category || "General") === categoryFilter) &&
    `${d.name} ${d.description} ${d.category} ${d.content}`.toLowerCase().includes(search.toLowerCase())
  );
  const selected = datasets.filter((d) => selectedDatasetIds.includes(d.id));
  const totals = combinedStats(selectedDatasetIds, config.blockSize);

  const resetForm = () => { setName(""); setDescription(""); setCategory("General"); setText(""); setEditingId(null); };
  const loadEdit = (id: string) => {
    const d = datasets.find((x) => x.id === id);
    if (!d) return;
    setEditingId(id); setName(d.name); setDescription(d.description); setCategory(d.category || "General"); setText(d.content);
    setError(null); setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = () => {
    setError(null); setNotice(null);
    try {
      if (!text.trim()) throw new Error("Paste some text first.");
      const dup = findDuplicateDataset(text, editingId ?? undefined);
      if (dup) throw new Error(`Duplicate content: this text already exists as "${dup.name}".`);
      if (editingId) {
        updateDataset(editingId, { name, description, category, content: text });
        setNotice("Dataset updated. Reinitialize or restart training to include the new content.");
      } else {
        addDataset(name, description, text, category);
        setNotice("Dataset created and selected for training.");
      }
      resetForm();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError(null); setNotice(null);
    const txt = Array.from(files).filter((f) => /\.(txt|md|csv|json|log|text)$/i.test(f.name) || f.type.startsWith("text/"));
    if (!txt.length) { setError("Please choose text files (.txt, .md, .csv, .json, .log)."); setBusy(false); return; }
    try {
      const created = await addFiles(txt);
      setNotice(`${created.length} of ${txt.length} file(s) imported. Duplicates are skipped.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setNotice(null);
    if (file.size > 10 * 1024 * 1024) {
      setError("Backup file is too large (10 MB limit).");
      if (importRef.current) importRef.current.value = "";
      return;
    }
    try {
      const created = importDatasets(await file.text());
      setNotice(`${created.length} dataset(s) imported from backup.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    if (importRef.current) importRef.current.value = "";
  };

  const download = (content: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const toggle = (id: string) => setSelectedDatasetIds(selectedDatasetIds.includes(id) ? selectedDatasetIds.filter((x) => x !== id) : [...selectedDatasetIds, id]);
  const deleteTarget = datasets.find((d) => d.id === pendingDelete) ?? null;

  return (
    <>
      <PageHeader eyebrow="Data Pipeline" title="Datasets" description="Import, organize and select the exact text corpus the training engine will learn from. All statistics come from the stored content." />

      {error && <div className="mb-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">{error}</div>}
      {notice && <div className="mb-4 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.4fr)]">
        <div className="space-y-4">
          <Card title={editingId ? "Edit Dataset" : "Create Dataset"} subtitle="Pasted text is stored locally and can be selected for training">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Dataset name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Poetry corpus" /></Field>
                <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="General" list="dataset-categories" /></Field>
              </div>
              <datalist id="dataset-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes" /></Field>
              <Field label="Text content" hint={`${Array.from(text).length.toLocaleString()} characters · duplicates are rejected`}>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="Paste training text here..." className="font-mono text-xs" />
              </Field>
              <div className="flex gap-2">
                <Button variant="primary" onClick={submit} className="flex-1">{editingId ? "Save Changes" : "Create Dataset"}</Button>
                {editingId && <Button variant="ghost" onClick={resetForm}>Cancel</Button>}
              </div>
            </div>
          </Card>

          <Card title="Import / Export" subtitle="Text files and dataset backups">
            <div className="space-y-3">
              <input
                ref={fileRef} type="file" multiple accept=".txt,.md,.csv,.json,.log,text/*"
                onChange={(e) => void handleFiles(e.target.files)}
                className="focus-ring w-full rounded border border-dashed hairline bg-black/20 p-3 text-xs text-slate-400 file:mr-3 file:rounded file:border file:border-cyan-500/40 file:bg-cyan-500/10 file:px-3 file:py-1.5 file:text-cyan-300"
              />
              {busy && <p className="font-mono text-[11px] text-cyan-400">Reading files…</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => download(exportDatasets(selectedDatasetIds), "davidai-datasets.json")} disabled={!selected.length}>Export selected</Button>
                <Button size="sm" variant="outline" onClick={() => download(exportDatasets(), "davidai-all-datasets.json")} disabled={!datasets.length}>Export all</Button>
                <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void handleImport(e.target.files?.[0])} />
                <Button size="sm" variant="outline" onClick={() => importRef.current?.click()}>Import backup</Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card
            title="Dataset Library"
            subtitle={`${datasets.length} dataset(s) · ${selected.length} selected · ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`}
            action={<div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setSelectedDatasetIds(datasets.map((d) => d.id))} disabled={!datasets.length}>Select all</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedDatasetIds([])} disabled={!selected.length}>Clear</Button>
            </div>}
          >
            <div className="mb-3 flex flex-wrap gap-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, notes or content…" className="min-w-[180px] flex-1 text-xs" />
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="focus-ring rounded border hairline bg-[var(--panel)] px-2 text-xs" aria-label="Filter by category">
                <option value="all">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button size="sm" variant="outline" disabled={selected.length < 2} onClick={() => {
                try { const d = combineDatasets(selectedDatasetIds, `Combined corpus ${new Date().toLocaleDateString()}`); setNotice(`Combined ${selected.length} datasets into "${d.name}".`); }
                catch (e) { setError(e instanceof Error ? e.message : String(e)); }
              }}>Combine selected</Button>
            </div>

            {filtered.length === 0 ? (
              <EmptyState title={datasets.length ? "No matching datasets" : "No datasets yet"} description={datasets.length ? "Try a different search or category." : "Upload a .txt file or paste text to create your first training corpus."} />
            ) : (
              <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {filtered.map((d) => {
                  const t = datasetStats(d, config.blockSize);
                  const checked = selectedDatasetIds.includes(d.id);
                  return (
                    <div key={d.id} className={`rounded border p-3 ${checked ? "border-cyan-500/30 bg-cyan-500/[0.04]" : "hairline bg-black/10"}`}>
                      <div className="flex flex-wrap items-start gap-3">
                        <input type="checkbox" checked={checked} onChange={() => toggle(d.id)} className="focus-ring mt-1 h-4 w-4 accent-cyan-500" aria-label={`Select ${d.name}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium" title={d.name}>{d.name}</span>
                            <Badge>{d.category || "General"}</Badge>
                            {checked && <Badge tone="cyan">selected</Badge>}
                          </div>
                          {d.description && <p className="mt-0.5 truncate text-xs text-[var(--muted)]" title={d.description}>{d.description}</p>}
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--muted)]">
                            <span>{formatNumber(t.chars)} chars</span><span>{formatNumber(t.tokens)} tokens</span>
                            <span>{formatNumber(t.windows)} windows</span><span>{timeAgo(d.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap shrink-0 gap-1">
                          <Button size="sm" variant="outline" onClick={() => setPreviewId(previewId === d.id ? null : d.id)}>{previewId === d.id ? "Hide" : "Preview"}</Button>
                          <Button size="sm" variant="outline" onClick={() => loadEdit(d.id)}>Edit</Button>
                          <Button size="sm" variant="danger" onClick={() => setPendingDelete(d.id)}>Delete</Button>
                        </div>
                      </div>
                      {previewId === d.id && (
                        <pre className="mt-3 max-h-56 overflow-auto rounded border hairline bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap break-words">{d.content.slice(0, 6000) || "(empty)"}{d.content.length > 6000 ? "\n… preview truncated" : ""}</pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Combined Training Set" subtitle="Exact corpus statistics from the engine's window builder">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded border hairline p-3"><div className="font-mono text-lg text-cyan-300">{formatNumber(totals.chars)}</div><div className="mono-label mt-1">characters</div></div>
              <div className="rounded border hairline p-3"><div className="font-mono text-lg text-cyan-300">{formatNumber(totals.tokens)}</div><div className="mono-label mt-1">tokens</div></div>
              <div className="rounded border hairline p-3"><div className="font-mono text-lg text-cyan-300">{formatNumber(totals.windows)}</div><div className="mono-label mt-1">training windows</div></div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
              Windows of length {config.blockSize} are sliced with stride {Math.max(1, Math.floor(config.blockSize / 2))}. Each window predicts the next character. With no selection, the training lab cannot start.
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete dataset?"
        description={`"${deleteTarget?.name ?? ""}" will be removed from this browser. Export a backup first if you may need it later.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) deleteDataset(pendingDelete); setPendingDelete(null); }}
      />
    </>
  );
}
