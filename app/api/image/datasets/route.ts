import { normalizeConcept, seedConcepts } from "@/lib/image/visual-knowledge";
import { VISUAL_DATASET_PACKS, visualDatasetStats } from "@/lib/image/visual-dataset";
import type { VisualConcept } from "@/lib/image/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists the bundled, locally stored visual knowledge packs. */
export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    stats: visualDatasetStats(),
    seeds: seedConcepts().length,
    packs: VISUAL_DATASET_PACKS.map((pack) => ({
      id: pack.id,
      name: pack.name,
      description: pack.description,
      source: pack.source,
      license: pack.license,
      concepts: pack.concepts.length,
      positiveRules: pack.concepts.reduce((total, concept) => total + (concept.constraints?.length ?? 0), 0),
      negativeRules: pack.concepts.reduce((total, concept) => total + (concept.negativeConstraints?.length ?? 0), 0),
    })),
  });
}

/** Validates a user-supplied visual knowledge pack and returns clean concepts. */
export async function POST(request: Request): Promise<Response> {
  let body: { packId?: unknown; concepts?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "A JSON body is required." }, { status: 400 }); }

  const bundled = VISUAL_DATASET_PACKS.find((pack) => pack.id === body.packId);
  const source = bundled?.concepts ?? (Array.isArray(body.concepts) ? body.concepts : null);
  if (!source) return Response.json({ error: "Choose a bundled pack or supply a concepts array." }, { status: 400 });

  const stamp = new Date().toISOString();
  const concepts: VisualConcept[] = source.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<VisualConcept>;
    if (typeof raw.name !== "string" || !raw.name.trim()) return [];
    const normalized = normalizeConcept({
      ...raw,
      id: `dataset:${bundled?.id ?? "custom"}:${raw.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.82,
      createdAt: stamp,
      updatedAt: stamp,
    });
    return normalized ? [normalized] : [];
  }).slice(0, 400);

  if (!concepts.length) return Response.json({ error: "No valid concepts were found in that pack." }, { status: 422 });
  return Response.json({
    ok: true,
    packId: bundled?.id ?? "custom",
    concepts,
    stats: {
      concepts: concepts.length,
      positiveRules: concepts.reduce((total, concept) => total + (concept.constraints?.length ?? 0), 0),
      negativeRules: concepts.reduce((total, concept) => total + (concept.negativeConstraints?.length ?? 0), 0),
    },
  });
}
