"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { useModalFocus } from "@/lib/use-modal-focus";
import { parsePromptIntent, promptWeaknesses } from "@/lib/image/prompt-enhancer";
import type {
  GeneratedImage, ImageActivity, ImageAsset, ImageEditMode, ImageEngineStatus,
  ImageEvaluation, ImageGenerationSettings, ImageOutpaintDirection,
} from "@/lib/image/types";

const STAGE_LABELS: Record<ImageActivity["stage"], string> = {
  queued: "Queue",
  understanding: "Request understanding",
  "enhancing-prompt": "Prompt enhancement",
  enhancing: "4× restoration",
  identifying: "Subject identification",
  researching: "Open research",
  analyzing: "Reference analysis",
  knowledge: "Visual knowledge",
  description: "Prompt composition",
  composing: "Pro controls",
  model: "Model selection",
  preparing: "Engine preparation",
  generating: "Diffusion",
  evaluating: "Evaluation",
  validating: "PNG validation",
  saving: "Persistence",
  done: "Completion",
  error: "Failure",
};

/** Category-spanning prompts used by the prompt lab. They never generate images by themselves. */
export const PROMPT_TESTS = [
  { category: "Animals", prompt: "A golden retriever sitting in a snowy pine forest at golden hour, close-up, shallow depth of field, photorealistic" },
  { category: "People", prompt: "Portrait of an elderly ship captain in a weathered navy coat, standing on a foggy deck, soft natural light, realistic anatomy" },
  { category: "Vehicles", prompt: "A vintage silver sports car on a wet city street at night, three quarter view, neon reflections, cinematic product photography" },
  { category: "Architecture", prompt: "A modern glass skyscraper viewed from below against a cloudy sky, symmetrical composition, wide angle, detailed facade" },
  { category: "Landscapes", prompt: "A wide alpine valley at dawn, mist over a mountain lake, layered ridges, high detail, panoramic landscape photography" },
  { category: "Food", prompt: "Overhead macro shot of a steaming bowl of ramen on a dark wooden table, chopsticks, warm lighting, premium food photography" },
  { category: "Products", prompt: "A chrome wristwatch on a dark wooden desk, extreme close-up, controlled studio lighting, mirror-like metal, highly detailed" },
  { category: "Sci-fi", prompt: "A lone astronaut walking across a red desert plain beneath two moons, low angle, cinematic atmosphere, intricate suit details" },
  { category: "Fantasy", prompt: "An ancient stone bridge covered in glowing runes spanning a misty canyon at twilight, ethereal atmosphere, detailed carving" },
  { category: "Realistic photography", prompt: "Candid street photograph of a cyclist passing a flower market in the rain, rule of thirds, natural light, 35mm lens" },
  { category: "Complex scenes", prompt: "A busy railway station at evening with travelers, hanging signs, steam, warm window light, deep focus, highly detailed" },
  { category: "Abstract art", prompt: "An abstract watercolor composition of teal and amber shapes flowing across textured paper, soft edges, negative space" },
];

export function PromptLab({ onUse }: { onUse: (prompt: string) => void }) {
  const [index, setIndex] = useState(0);
  const selected = PROMPT_TESTS[index];
  const intent = useMemo(() => parsePromptIntent(selected.prompt), [selected.prompt]);
  const weaknesses = useMemo(() => promptWeaknesses(selected.prompt), [selected.prompt]);
  const categories = [...new Set(PROMPT_TESTS.map((item) => item.category))];

  return (
    <Card title="Prompt lab" subtitle="A local test collection across animals, people, vehicles, architecture, landscapes, food, products, sci-fi, fantasy, photography, complex scenes and abstract art.">
      <div className="grid gap-3 sm:grid-cols-[190px_minmax(0,1fr)]">
        <Field label="Test category">
          <Select value={selected.category} onChange={(event) => {
            const next = PROMPT_TESTS.findIndex((item) => item.category === event.target.value);
            if (next >= 0) setIndex(next);
          }}>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </Select>
        </Field>
        <Field label="Test prompt" hint="Analysis only. Load it into the workspace when you want to generate.">
          <Textarea value={selected.prompt} rows={3} readOnly />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="cyan">{intent.subject.slice(0, 60)}</Badge>
        {intent.categories.map((category) => <Badge key={category}>{category}</Badge>)}
        {intent.negations.map((negative) => <Badge key={negative} tone="amber">no {negative}</Badge>)}
      </div>
      <div className="mt-3 rounded border hairline bg-black/20 p-3">
        <div className="mono-label mb-1.5">Prompt weaknesses</div>
        {weaknesses.length ? (
          <ul className="space-y-1 text-[11px] leading-relaxed text-[var(--muted)]">
            {weaknesses.map((weakness) => <li key={weakness}>· {weakness}</li>)}
          </ul>
        ) : <p className="text-[11px] text-emerald-300">No obvious gaps. Subject, lighting, framing and surface are described.</p>}
      </div>
      <Button size="sm" variant="primary" className="mt-3" onClick={() => onUse(selected.prompt)}>Load test prompt</Button>
    </Card>
  );
}

export function PromptPreview({ prompt, enabled, onToggle, strengths, weaknesses }: {
  prompt: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  strengths: string[];
  weaknesses: string[];
}) {
  const [view, setView] = useState<"original" | "enhanced">("enhanced");
  const enhancement = useMemo(() => (enabled ? parsePromptIntent(prompt) : null), [prompt, enabled]);
  const additions = useMemo(() => (enhancement
    ? Object.values(enhancement.details).flat().filter((value, index, list) => list.indexOf(value) === index)
    : []), [enhancement]);
  const visibleText = view === "original" || !enhancement
    ? prompt
    : [enhancement.request, ...additions].filter(Boolean).join(", ");

  return (
    <Card
      title="Prompt enhancement"
      subtitle="Original intent stays first. Detected cues are appended as short visual phrases; negations move to the negative prompt."
      action={<div className="flex rounded border hairline bg-black/30 p-0.5 text-[11px]">
        <button type="button" onClick={() => setView("original")} className={`rounded px-2 py-1 ${view === "original" ? "bg-slate-600/50 text-slate-100" : "text-slate-500"}`}>Original</button>
        <button type="button" onClick={() => setView("enhanced")} className={`rounded px-2 py-1 ${view === "enhanced" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500"}`}>Enhanced</button>
      </div>}
    >
      <label className="mb-3 flex items-start gap-2 rounded border hairline bg-black/20 p-2.5 text-[11px] text-slate-300">
        <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} className="mt-0.5 accent-cyan-400" />
        <span>Use structured enhancement for generation. Turning it off uses only your words plus saved visual knowledge, without discarding any intent.</span>
      </label>
      <p className="whitespace-pre-wrap rounded border hairline bg-black/25 p-3 text-xs leading-relaxed text-slate-200">{visibleText || "Enter a request to preview the enhancement."}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mono-label mb-1.5">Detected cues</div>
          <div className="flex flex-wrap gap-1.5">
            {additions.length ? additions.slice(0, 14).map((item) => <Badge key={item} tone="cyan">{item}</Badge>) : <span className="text-[11px] text-[var(--muted)]">None yet.</span>}
          </div>
        </div>
        <div>
          <div className="mono-label mb-1.5">Before generating</div>
          <ul className="space-y-1 text-[11px] leading-relaxed text-[var(--muted)]">
            {strengths.length ? strengths.slice(0, 4).map((item) => <li key={item} className="text-emerald-300">✓ {item}</li>) : null}
            {weaknesses.slice(0, 4).map((item) => <li key={item}>· {item}</li>)}
          </ul>
        </div>
      </div>
    </Card>
  );
}

const SAMPLERS = [
  "auto", "dpm++2mv2", "dpm++2m", "dpm++2m_sde", "dpm++2m_sde_bt", "dpm++2s_a",
  "er_sde", "euler", "euler_a", "heun", "dpm2", "ipndm", "ipndm_v",
  "lcm", "ddim_trailing", "tcd", "res_multistep", "res_2s", "lms",
];
const SCHEDULERS = ["auto", "karras", "discrete", "exponential", "ays", "gits", "sgm_uniform", "simple", "smoothstep", "kl_optimal", "lcm"];

export function ModelPanel({ engine, settings, onChange, disabled }: {
  engine: ImageEngineStatus | null;
  settings: ImageGenerationSettings;
  onChange: (patch: Partial<ImageGenerationSettings>) => void;
  disabled: boolean;
}) {
  const models = engine?.models ?? [];
  const backends = engine?.backends ?? [];
  return (
    <Card title="Model and backend" subtitle="Only weights installed on this machine can be selected. Unavailable families are shown with their real reason.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Checkpoint" hint="Auto uses Realistic Vision for people and full-precision SD 1.5 for animals, vehicles and objects. Selecting DreamShaper LCM also switches steps, CFG and cache to its tested fast settings; leaving it restores the detailed defaults.">
          <Select value={settings.modelId ?? "auto"} onChange={(event) => {
            const modelId = event.target.value as ImageGenerationSettings["modelId"];
            if (modelId === "dreamshaper-lcm") {
              onChange({ modelId, sampler: "lcm", scheduler: "lcm", steps: 6, guidance: 1.5, speed: "quality", hires: false });
            } else if (settings.modelId === "dreamshaper-lcm") {
              onChange({ modelId, sampler: "auto", scheduler: "auto", steps: 20, guidance: 7, speed: "balanced", hires: false });
            } else {
              onChange({ modelId });
            }
          }} disabled={disabled}>
            <option value="auto">Auto — subject-aware</option>
            {models.filter((model) => model.available).map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Sampler" hint="Auto resolves to Euler + Karras for SD 1.5 checkpoints, or LCM + LCM for the fused LCM checkpoint. Euler was the most colour-stable sampler in local A/B tests; the resolved sampler is recorded in history.">
          <Select value={settings.sampler ?? "auto"} onChange={(event) => onChange({ sampler: event.target.value })} disabled={disabled}>
            {SAMPLERS.map((sampler) => <option key={sampler} value={sampler}>{sampler === "auto" ? "auto — model-dependent" : sampler}</option>)}
          </Select>
        </Field>
        <Field label="Sigma scheduler" hint="Auto follows the checkpoint: Karras for SD 1.5, LCM for the fast LCM model.">
          <Select value={settings.scheduler ?? "auto"} onChange={(event) => onChange({ scheduler: event.target.value })} disabled={disabled}>
            {SCHEDULERS.map((scheduler) => <option key={scheduler} value={scheduler}>{scheduler === "auto" ? "auto — model-dependent" : scheduler}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-3 space-y-1.5">
        {models.map((model) => (
          <div key={model.id} className="flex flex-wrap items-start gap-2 rounded border hairline bg-black/20 px-2.5 py-2 text-[11px]">
            <Badge tone={model.available ? "green" : "red"}>{model.available ? "installed" : "missing"}</Badge>
            <span className="font-medium text-slate-200">{model.name}</span>
            <span className="text-[var(--muted)]">{model.note}</span>
          </div>
        ))}
        {backends.map((backend) => (
          <div key={backend.id} className="flex flex-wrap items-start gap-2 rounded border hairline bg-black/20 px-2.5 py-2 text-[11px]">
            <Badge tone={backend.available ? "cyan" : "neutral"}>{backend.available ? "active" : "unavailable"}</Badge>
            <span className="font-medium text-slate-200">{backend.name}</span>
            <span className="text-[var(--muted)]">{backend.note}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const CTRL_FIELDS: Array<{ key: keyof ImageGenerationSettings; label: string; placeholder: string }> = [
  { key: "lighting", label: "Lighting", placeholder: "soft studio lighting" },
  { key: "camera", label: "Camera / framing", placeholder: "macro close-up" },
  { key: "perspective", label: "Perspective", placeholder: "three quarter view" },
  { key: "composition", label: "Composition", placeholder: "rule of thirds" },
  { key: "colorPalette", label: "Color palette", placeholder: "teal and amber" },
  { key: "depthOfField", label: "Depth of field", placeholder: "shallow depth, soft bokeh" },
  { key: "texture", label: "Surface texture", placeholder: "weathered wood grain" },
  { key: "atmosphere", label: "Atmosphere", placeholder: "cinematic" },
  { key: "weather", label: "Weather", placeholder: "light rain" },
  { key: "timeOfDay", label: "Time of day", placeholder: "golden hour" },
  { key: "detailLevel", label: "Detail level", placeholder: "highly detailed" },
  { key: "realism", label: "Realism", placeholder: "anatomically correct" },
];

export function ProControls({ settings, onChange, disabled }: {
  settings: ImageGenerationSettings;
  onChange: (patch: Partial<ImageGenerationSettings>) => void;
  disabled: boolean;
}) {
  return (
    <Card title="Visual controls" subtitle="Every field here is compiled into the final prompt or into the local engine arguments. Empty means the model decides.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CTRL_FIELDS.map((field) => (
          <Field key={field.key} label={field.label}>
            <Input
              value={typeof settings[field.key] === "string" ? settings[field.key] as string : ""}
              onChange={(event) => onChange({ [field.key]: event.target.value })}
              placeholder={field.placeholder}
              maxLength={80}
              disabled={disabled}
            />
          </Field>
        ))}
      </div>
    </Card>
  );
}

const EDIT_MODES: Array<{ value: ImageEditMode; label: string; note: string }> = [
  { value: "text", label: "Text to image", note: "Pure diffusion from words. No image input." },
  { value: "img2img", label: "Image to image", note: "Real -i/--strength input. The uploaded pixels seed the latent; they are never returned as the result." },
  { value: "mask", label: "Mask-guided edit", note: "Real --mask guidance: white is regenerated, black is preserved. Uses SD 1.5 guidance because no inpaint weights are installed." },
  { value: "outpaint", label: "Outpaint extension", note: "Builds a larger canvas and mask locally, then regenerates the new border. No dedicated outpaint model is installed." },
  { value: "remove", label: "Object removal", note: "Paint the object white in a mask. The local model regenerates that region from context; results depend on the mask." },
  { value: "background", label: "Background replacement", note: "Keep the subject black in the mask and paint the old background white. The model regenerates the masked area." },
];

export function AssetManager({ assets, busy, generating, settings, onUpload, onDelete, onToggleReference, onSelectEdit, onSelectMask, onChange }: {
  assets: ImageAsset[];
  busy: string | null;
  generating: boolean;
  settings: ImageGenerationSettings;
  onUpload: (file: File, kind: ImageAsset["kind"]) => void;
  onDelete: (id: string) => void;
  onToggleReference: (id: string) => void;
  onSelectEdit: (id: string) => void;
  onSelectMask: (id: string) => void;
  onChange: (patch: Partial<ImageGenerationSettings>) => void;
}) {
  const [kind, setKind] = useState<ImageAsset["kind"]>("reference");
  const fileRef = useRef<HTMLInputElement>(null);
  const mode = settings.editMode ?? "text";
  const modeNote = EDIT_MODES.find((item) => item.value === mode)?.note ?? "";
  const referenceIds = settings.referenceIds ?? [];

  const renderAssets = (filter: ImageAsset["kind"], selectedId: string | undefined, onSelect: (id: string) => void, multi = false) => {
    const list = assets.filter((asset) => asset.kind === filter);
    if (!list.length) return <p className="text-[11px] text-[var(--muted)]">No {filter} images uploaded yet.</p>;
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((asset) => {
          const selected = multi ? referenceIds.includes(asset.id) : selectedId === asset.id;
          return (
            <div key={asset.id} className={`overflow-hidden rounded border ${selected ? "border-cyan-500/60" : "hairline"} bg-black/25`}>
              <img src={asset.url} alt={asset.name} className="h-20 w-full bg-black object-contain" />
              <div className="p-2">
                <div className="truncate text-[11px] text-slate-200" title={asset.name}>{asset.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {asset.colors.slice(0, 4).map((color) => (
                    <span key={color.hex} title={`${color.hex} · ${Math.round(color.share * 100)}%`} className="h-3 w-3 rounded-sm border border-white/20" style={{ background: color.hex }} />
                  ))}
                  <Badge>{asset.width}×{asset.height}</Badge>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--muted)]">{asset.note}</p>
                <div className="mt-2 flex gap-1">
                  <Button size="sm" variant={selected ? "primary" : "outline"} className="flex-1" onClick={() => onSelect(asset.id)} disabled={generating}>
                    {selected ? "Selected" : multi ? "Add cue" : "Use"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(asset.id)} disabled={generating}>Remove</Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Card title="References and editing" subtitle="Local uploads only. References influence palette language; edit images and masks are real diffusion inputs where the engine supports them.">
      <div className="flex flex-wrap items-end gap-2 rounded border hairline bg-black/20 p-2.5">
        <Field label="Upload type">
          <Select value={kind} onChange={(event) => setKind(event.target.value as ImageAsset["kind"])} disabled={generating}>
            <option value="reference">Reference — inspiration only</option>
            <option value="edit">Source — img2img / mask / outpaint</option>
            <option value="mask">Mask — white edits, black keeps</option>
          </Select>
        </Field>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file, kind);
            event.target.value = "";
          }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={generating || busy !== null}>{busy ? "Saving…" : "Choose image"}</Button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Editing mode" hint={modeNote}>
          <Select value={mode} onChange={(event) => onChange({ editMode: event.target.value as ImageEditMode })} disabled={generating}>
            {EDIT_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>
        </Field>
        {mode !== "text" && (
          <Field label="Outpaint direction" hint="Used by the outpaint canvas to place the original pixels and regenerate the new border.">
            <Select value={settings.outpaintDirection ?? "all"} onChange={(event) => onChange({ outpaintDirection: event.target.value as ImageOutpaintDirection })} disabled={generating}>
              {["all", "left", "right", "top", "bottom"].map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </Field>
        )}
      </div>
      {mode !== "text" && (
        <div className="mt-3">
          <Field label={`Transform strength: ${Math.round((settings.strength ?? 0.55) * 100)}%`} hint="Low values keep the source close; high values let the local model change more of it.">
            <input type="range" min={5} max={100} value={Math.round((settings.strength ?? 0.55) * 100)} onChange={(event) => onChange({ strength: Number(event.target.value) / 100 })} disabled={generating} className="w-full accent-cyan-400" />
          </Field>
        </div>
      )}

      <div className="mt-4 space-y-4">
        <div>
          <div className="mono-label mb-1.5">Reference inspiration ({referenceIds.length})</div>
          {renderAssets("reference", undefined, onToggleReference, true)}
        </div>
        {mode !== "text" && (
          <>
            <div>
              <div className="mono-label mb-1.5">Edit source</div>
              {renderAssets("edit", settings.initImageId, onSelectEdit)}
            </div>
            {(mode === "mask" || mode === "remove" || mode === "background") && (
              <div>
                <div className="mono-label mb-1.5">Mask image</div>
                {renderAssets("mask", settings.maskImageId, onSelectMask)}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

const STAGE_GROUPS: Array<{ title: string; stages: ImageActivity["stage"][]; open?: boolean }> = [
  { title: "1 · Understanding and prompt enhancement", stages: ["queued", "understanding", "enhancing-prompt"], open: true },
  { title: "2 · Visual research and analysis", stages: ["researching", "analyzing"] },
  { title: "3 · Subject identification and visual knowledge", stages: ["identifying", "knowledge"] },
  { title: "4 · Prompt composition and pro controls", stages: ["description", "composing"] },
  { title: "5 · Model selection", stages: ["model"] },
  { title: "6 · Engine preparation", stages: ["preparing"] },
  { title: "7 · Local diffusion", stages: ["generating"], open: true },
  { title: "8 · Validation, restoration, save", stages: ["validating", "enhancing", "evaluating", "saving", "done", "error"] },
];

export function GenerationDetails({ activities, image, displayModel }: {
  activities: ImageActivity[];
  image: GeneratedImage | null;
  displayModel: string;
}) {
  return (
    <Card title="Generation details" subtitle="Expandable provenance for every real stage, plus the exact prompts and settings used.">
      <div className="space-y-2">
        {STAGE_GROUPS.map((group) => {
          const items = activities.filter((activity) => group.stages.includes(activity.stage));
          return (
            <details key={group.title} open={group.open} className="rounded border hairline bg-black/20">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-200">
                {group.title} <span className="ml-1 font-mono text-[10px] text-slate-500">{items.length} event{items.length === 1 ? "" : "s"}</span>
              </summary>
              <div className="space-y-1.5 border-t hairline px-3 py-2">
                {items.length ? items.map((activity) => (
                  <div key={activity.id} className="rounded bg-black/30 px-2 py-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={activity.status === "ok" ? "green" : activity.status === "error" ? "red" : "cyan"}>{STAGE_LABELS[activity.stage]}</Badge>
                      <span className="text-slate-200">{activity.message}</span>
                      <span className="ml-auto font-mono text-[10px] text-slate-600">{new Date(activity.at).toLocaleTimeString()}</span>
                    </div>
                    {activity.detail && <p className="mt-1 leading-relaxed text-[var(--muted)]">{activity.detail}</p>}
                    {typeof activity.progress === "number" && <div className="mt-1.5"><div className="luxe-track h-1 w-full overflow-hidden rounded-full"><div className="luxe-fill h-full rounded-full" style={{ width: `${activity.progress}%` }} /></div></div>}
                  </div>
                )) : <p className="text-[11px] text-[var(--muted)]">No events in this stage for the last run.</p>}
              </div>
            </details>
          );
        })}
      </div>
      {image && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded border hairline bg-black/20 p-3">
            <div className="mono-label mb-1.5">Provenance</div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="green">{displayModel}</Badge>
              <Badge>{image.render?.final.width ?? image.settings.width}×{image.render?.final.height ?? image.settings.height} final</Badge>
              {image.render?.diffusion && <Badge>{image.render.diffusion.width}×{image.render.diffusion.height} diffusion</Badge>}
              <Badge>{image.render?.diffusion?.steps ?? image.settings.steps} steps</Badge>
              <Badge>CFG {image.render?.diffusion?.cfg ?? image.settings.guidance}</Badge>
              <Badge>{image.render?.diffusion?.sampler ?? image.settings.sampler ?? "auto (legacy)"}</Badge>
              <Badge>{image.render?.diffusion?.scheduler ?? image.settings.scheduler ?? "karras"}</Badge>
              {image.render?.diffusion && <Badge>seed {image.render.diffusion.seed >= 0 ? image.render.diffusion.seed : "unknown"}</Badge>}
              {image.render?.diffusion && <Badge>{image.render.diffusion.cacheMode} cache</Badge>}
              {image.settings.batchCount && image.settings.batchCount > 1 && <Badge tone="cyan">{image.batchIndex ?? 1}/{image.settings.batchCount}</Badge>}
              {image.edit && <Badge tone="amber">{image.edit.mode}</Badge>}
              {image.render?.final.upscaler && <Badge tone="amber">{image.render.final.upscaler.name}</Badge>}
              {image.upscaleSourceId && !image.render?.final.upscaler && <Badge tone="amber">4× restored</Badge>}
            </div>
            {image.render?.diffusion?.modelFile && <p className="mt-2 break-all text-[10px] leading-relaxed text-slate-500">Weights: {image.render.diffusion.modelFile}{image.render.diffusion.engine ? ` · ${image.render.diffusion.engine}` : ""}</p>}
            {image.render?.final.upscaler && <p className="mt-1 break-all text-[10px] leading-relaxed text-slate-500">Restorer: {image.render.final.upscaler.file} · {(image.render.final.upscaler.durationMs / 1000).toFixed(1)}s</p>}
            {image.edit?.note && <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">{image.edit.note}</p>}
            {Boolean(image.pipelineNotes?.length) && (
              <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-amber-300">
                {image.pipelineNotes!.map((note) => <li key={note}>{note}</li>)}
              </ul>
            )}
          </div>
          <div className="rounded border hairline bg-black/20 p-3">
            <div className="mono-label mb-1.5">Research summary</div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              {image.researchSummary.skipped ? `Skipped — ${image.researchSummary.reason ?? "knowledge sufficient"}` : `${image.researchSummary.references} openly licensed reference(s).`}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {image.researchSummary.subjects.map((subject) => <Badge key={subject}>{subject}</Badge>)}
            </div>
          </div>
          <div className="rounded border hairline bg-black/20 p-3 sm:col-span-2">
            <div className="mono-label mb-1">Original / enhanced / final prompt</div>
            <p className="text-[11px] leading-relaxed text-slate-400">Original: {image.originalPrompt}</p>
            {image.enhancedPrompt && <p className="mt-1 text-[11px] leading-relaxed text-cyan-300">Enhanced: {image.enhancedPrompt}</p>}
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-200">Final: {image.finalPrompt}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-red-300">Negative: {image.negativePrompt}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

export function ImageViewer({ image, onClose }: { image: GeneratedImage; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const frameRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onClose();
  }, [onClose]);
  useModalFocus(true, dialogRef, close);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(4, value + 0.25));
      if (event.key === "-") setZoom((value) => Math.max(0.5, value - 0.25));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[120] flex flex-col bg-black/95 p-3" role="dialog" aria-modal="true" aria-label="Image viewer">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{image.originalPrompt}</span>
        <Button size="sm" variant="outline" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</Button>
        <span className="w-14 text-center font-mono text-xs text-cyan-300">{Math.round(zoom * 100)}%</span>
        <Button size="sm" variant="outline" onClick={() => setZoom((value) => Math.min(4, value + 0.25))}>+</Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>Reset</Button>
        <Button size="sm" variant="outline" onClick={() => {
          const target = frameRef.current;
          if (!target) return;
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else void target.requestFullscreen?.().catch(() => undefined);
        }}>Fullscreen</Button>
        <Button size="sm" variant="danger" onClick={close}>Close</Button>
      </div>
      <div ref={frameRef} className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black">
        <img
          src={image.imageUrl ?? ""}
          alt={image.originalPrompt}
          className="max-w-none select-none object-contain transition-[width] duration-150"
          style={{ width: `${zoom * 100}%` }}
        />
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">Scroll to inspect · + / − to zoom · Esc to close</p>
    </div>
  );
}

const WEAKNESS_OPTIONS = [
  "wrong anatomy", "extra limbs", "distorted face", "incorrect text", "wrong composition",
  "background too busy", "lighting mismatch", "style drift", "blurry detail", "subject not centered",
];

export function EvaluationPanel({ image, evaluation, suggestions, onSave }: {
  image: GeneratedImage;
  evaluation?: ImageEvaluation;
  suggestions: string[];
  onSave: (value: Omit<ImageEvaluation, "id" | "createdAt" | "updatedAt">) => void;
}) {
  const blank = { quality: 0, promptAccuracy: 0, realism: 0, styleAccuracy: 0, weaknesses: [] as string[], note: "" };
  const [draft, setDraft] = useState(blank);
  useEffect(() => {
    setDraft(evaluation
      ? { quality: evaluation.quality, promptAccuracy: evaluation.promptAccuracy, realism: evaluation.realism, styleAccuracy: evaluation.styleAccuracy, weaknesses: [...evaluation.weaknesses], note: evaluation.note }
      : blank);
  }, [image.id, evaluation]);

  const options = [...new Set([...suggestions, ...WEAKNESS_OPTIONS])].slice(0, 12);
  const scoreFields: Array<{ key: keyof typeof blank; label: string }> = [
    { key: "quality", label: "Overall quality" },
    { key: "promptAccuracy", label: "Prompt accuracy" },
    { key: "realism", label: "Realism" },
    { key: "styleAccuracy", label: "Style accuracy" },
  ];

  return (
    <Card title="Evaluation and weaknesses" subtitle="Scores describe this one image. Weakness notes can become structural rules, but no blind retraining is performed.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scoreFields.map((field) => (
          <Field key={field.key} label={field.label}>
            <Select
              value={draft[field.key]}
              onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: Number(event.target.value) }))}
            >
              {[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value === 0 ? "Not scored" : `${value} / 5`}</option>)}
            </Select>
          </Field>
        ))}
      </div>
      <div className="mono-label mb-1.5 mt-3">Observed weaknesses</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const checked = draft.weaknesses.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => setDraft((prev) => ({
                ...prev,
                weaknesses: checked ? prev.weaknesses.filter((value) => value !== option) : [...prev.weaknesses, option],
              }))}
              className={`rounded border px-2 py-1 text-[11px] ${checked ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "hairline bg-black/20 text-slate-400"}`}
            >
              {checked ? "✓ " : ""}{option}
            </button>
          );
        })}
      </div>
      <Textarea
        className="mt-3"
        rows={2}
        maxLength={800}
        value={draft.note}
        onChange={(event) => setDraft((prev) => ({ ...prev, note: event.target.value }))}
        placeholder="What worked, what failed, and what should change next time?"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => onSave({ imageId: image.id, ...draft })}>Save evaluation</Button>
        {evaluation && <Badge tone="green">saved {new Date(evaluation.updatedAt).toLocaleDateString()}</Badge>}
      </div>
    </Card>
  );
}
