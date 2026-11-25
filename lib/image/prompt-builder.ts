import type {
  ImageGenerationSettings,
  ScopedCorrection,
  VisualConcept,
  VisualFeedbackNote,
  VisualResearchResult,
  VisualSubject,
} from "./types";
import type { EnhancedPrompt } from "./prompt-enhancer";
import { cueConflictsWithRequest, parsePromptIntent } from "./prompt-enhancer";
import {
  detectAnatomy,
  hasAirplaneSceneOverride,
  hasCleanBackdropRequest,
  hasExplicitScene,
  type AnatomyProfile,
} from "./visual-anatomy";
import {
  deriveCorrection,
  deriveStructuralCorrection,
  extractAttributes,
  structuralRules,
  type CorrectionContext,
} from "./visual-knowledge";

export interface BuildDescriptionInput {
  prompt: string;
  subjects: VisualSubject[];
  concepts: VisualConcept[];
  research: VisualResearchResult | null;
  feedbackNotes: VisualFeedbackNote[];
  settings: ImageGenerationSettings;
  recentCorrections?: Array<string | ScopedCorrection>;
  /** Optional structured expansion from the Prompt Enhancement Engine. */
  enhancement?: EnhancedPrompt | null;
}

export interface BuiltDescription {
  finalPrompt: string;
  negativePrompt: string;
  usedConcepts: string[];
  adjustments: string[];
}

// SD 1.5's CLIP encoder truncates at 77 tokens (including BOS/EOS). Leaving a
// margin keeps every important phrase inside that window.
const TOKEN_BUDGET = 68;
const NEGATIVE_TOKEN_BUDGET = 76;

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[;:,]+$/, "");
}

function estimateTokens(text: string): number {
  return tidy(text).split(/[\s,.;:!?()[\]{}"']+/).filter(Boolean).length + 1;
}

/** Never leave a half-word or half-phrase at the end of a machine prompt. */
function capText(value: string, max: number): string {
  const text = tidy(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const comma = cut.lastIndexOf(",");
  const space = cut.lastIndexOf(" ");
  const boundary = Math.max(comma, space);
  return tidy(boundary > max * 0.6 ? cut.slice(0, boundary) : cut);
}

/**
 * Learned corrections often arrive as comma-separated bundles ("flat nose,
 * blunt truncated nose") that overlap with structural rules. Split bundles and
 * dedupe individual phrases so the 77-token CLIP window is not spent twice on
 * the same failure.
 */
function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    for (const part of tidy(value).split(",").map(tidy)) {
      const key = part.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(part);
    }
  }
  return result;
}

/**
 * Adds phrases by priority until the CLIP budget is full. Lower-priority
 * phrases (captions mined from the web) are silently dropped rather than
 * pushing structural facts past the truncation point.
 */
/**
 * Word-level containment removes "mirror-like metal" once "mirror-like metal
 * surfaces" is present, without the old substring bug where "bus" suppressed
 * the different "busy background" rule. Single words are never collapsed.
 */
function semanticallyDuplicate(candidate: string, existing: string): boolean {
  const a = tidy(candidate).toLowerCase().split(/\s+/).filter(Boolean);
  const b = tidy(existing).toLowerCase().split(/\s+/).filter(Boolean);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2) return false;
  return short.every((word) => long.includes(word));
}

function wordCount(value: string): number {
  return tidy(value).split(/\s+/).filter(Boolean).length;
}

function assemble(tiers: string[][], budget = TOKEN_BUDGET): string[] {
  const chosen: string[] = [];
  let tokens = 0;
  for (const tier of tiers) {
    for (const raw of tier) {
      const value = tidy(raw);
      const key = value.toLowerCase();
      if (!value) continue;
      const duplicateIndex = chosen.findIndex((item) => item.toLowerCase() === key || semanticallyDuplicate(value, item));
      if (duplicateIndex >= 0) {
        // Keep the more specific wording when a later cue is a richer form of
        // an earlier one, e.g. "mirror-like metal surfaces" over "mirror-like metal".
        const existing = chosen[duplicateIndex];
        if (wordCount(value) > wordCount(existing)) {
          const delta = estimateTokens(value) - estimateTokens(existing);
          if (tokens + delta <= budget) {
            chosen[duplicateIndex] = value;
            tokens += delta;
          }
        }
        continue;
      }
      const cost = estimateTokens(value);
      if (chosen.length && tokens + cost > budget) continue;
      chosen.push(value);
      tokens += cost;
    }
  }
  return chosen;
}

/**
 * Normalises ambiguous everyday words into the canonical SD 1.5 vocabulary.
 * Explicit hangars, runways, night scenes and cutaways are preserved instead of
 * being overwritten with the old automatic "clear blue sky" rewrite.
 */
function canonicalRequest(
  prompt: string,
  matched: VisualConcept[],
  adjustments: string[],
): string {
  let text = tidy(prompt).replace(/[.?!]+$/, "");
  if (!matched.some((concept) => concept.name === "airplane")) return text.slice(0, 240);

  text = text.replace(/\b(plane|jet|aeroplane|aircraft)\b/gi, "airplane");
  text = text.replace(/\bcool grey\b/gi, "grey");
  text = text.replace(/\bguns\b/gi, "wing-mounted cannons");
  adjustments.push("airplane wording normalised for the local SD 1.5 vocabulary");

  const sceneOverride = hasAirplaneSceneOverride(text);
  const alreadyOutdoor = /\b(sky|flying|airborne|flight|exterior|outdoor|outside)\b/i.test(text);
  if (!sceneOverride && !alreadyOutdoor) {
    text += ", flying in a clear blue sky, full exterior view";
    adjustments.push("clear blue sky added because no explicit scene was requested");
  } else if (sceneOverride) {
    adjustments.push("explicit airplane scene preserved; no automatic sky rewrite");
  }
  return text.slice(0, 240);
}

function subjectConcepts(subjects: VisualSubject[], concepts: VisualConcept[]): VisualConcept[] {
  const seen = new Set<string>();
  const found: VisualConcept[] = [];
  for (const subject of subjects) {
    const match = concepts.find((concept) =>
      concept.name.toLowerCase() === subject.name.toLowerCase() && !seen.has(concept.id));
    if (match) {
      seen.add(match.id);
      found.push(match);
    }
  }
  return found;
}

// Caption text often mentions incidental colours, lighting or framing from an
// unrelated photograph. Those guesses contradict each other and damage SD 1.5
// results, so they stay in the knowledge store but never enter the prompt.
const UNRELIABLE_RESEARCH = /\b(colou?r|palette|accent|tonal|tones?|silver|grey|gray|golden|blue|red|green|bright|dark|high-key|low-key|neon|night|daytime|daylight|lighting|sunlight|warm|cool|shadow|render|rendering|mood|atmosphere|framing|composition)\b/i;

const NON_PHOTO_STYLE = /\b(watercolor|watercolour|painting|painterly|oil|anime|cartoon|illustration|sketch|3d render)\b/i;

function isPhotographic(prompt: string, style: string): boolean {
  if (NON_PHOTO_STYLE.test(prompt)) return false;
  return /^(photorealistic|realistic|photo|photograph|auto)$/i.test(style.trim());
}

function photoTerms(prompt: string, anatomy: AnatomyProfile): string[] {
  const terms = ["photograph", "highly detailed", "sharp focus"];
  if (anatomy.person) terms.push("realistic human anatomy", "natural skin texture");
  if (anatomy.animal) terms.push("realistic animal anatomy", "natural surface texture");
  if (anatomy.vehicle) terms.push("physically plausible engineering", "correct mechanical layout");
  if (!/\b(light|lighting|sun|studio|night|shadow|neon|golden hour|moon|dark|bright|dawn|dusk)\b/i.test(prompt)) {
    terms.push("soft natural light");
  }
  return terms;
}

function normaliseScope(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").trim().replace(/\bs$/g, "");
}

function scopeMatches(candidate: string, scopes: Set<string>): boolean {
  const value = normaliseScope(candidate);
  if (!value) return false;
  for (const scope of scopes) {
    const normalised = normaliseScope(scope);
    if (value === normalised || value.includes(normalised) || normalised.includes(value)) return true;
  }
  return false;
}

function correctionContext(name: string, subjects: VisualSubject[], concepts: VisualConcept[]): CorrectionContext {
  const concept = concepts.find((item) => item.name.toLowerCase() === name.toLowerCase());
  const subject = subjects.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return {
    name,
    category: concept?.category ?? subject?.category,
    attributes: concept?.attributes,
    constraints: concept?.constraints,
  };
}

function isBackgroundRule(rule: { positive: string; negative: string } | null): boolean {
  return Boolean(rule && /\b(background|backdrop|sky|behind|busy|empty sky)\b/i.test(rule.positive));
}

/**
 * Structural constraints often already state the anatomy fact in stronger
 * language. Repeating it wastes the 77-token CLIP window and delayed concrete
 * subject details such as "tailored jacket" in earlier builds.
 */
function uniqueAnatomyRules(anatomyRules: string[], structuralPositive: string[]): string[] {
  return anatomyRules.filter((rule) => {
    const words = tidy(rule).toLowerCase().split(/\s+/);
    const prefix = words.slice(0, 3).join(" ");
    if (!prefix) return false;
    return !structuralPositive.some((existing) => tidy(existing).toLowerCase().includes(prefix));
  });
}

/**
 * Compiles a compact, subject-first prompt for the local diffusion model.
 * Priority order is deliberate: the user's negation-free request, structural
 * and anatomy facts, photographic rendering, details named by the user,
 * structured knowledge, scoped feedback, and finally captioned research.
 */
export function buildVisualDescription(input: BuildDescriptionInput): BuiltDescription {
  const { prompt, subjects, concepts, research, feedbackNotes, settings, recentCorrections, enhancement } = input;
  const adjustments: string[] = [];
  const usedConcepts: string[] = [];

  // Explicit "no/without/avoid" clauses belong in the negative prompt. Compiling
  // from the stripped request prevents phrases such as "no extra fingers" from
  // becoming positive anatomy instructions or research subjects.
  const effectiveRequest = tidy(enhancement?.intent.request ?? parsePromptIntent(prompt).request) || tidy(prompt);
  const strippedNegations = enhancement?.intent.negations ?? parsePromptIntent(prompt).negations;
  if (strippedNegations.length) adjustments.push(`${strippedNegations.length} explicit negation(s) moved to the negative prompt`);

  const photographic = isPhotographic(effectiveRequest, settings.style);
  const matched = subjectConcepts(subjects, concepts);
  const cleanPrompt = canonicalRequest(effectiveRequest, matched, adjustments);
  let rules = structuralRules(matched);
  const anatomy = detectAnatomy(effectiveRequest, subjects);
  const anatomyRules = uniqueAnatomyRules(anatomy.positive, rules.positive);
  usedConcepts.push(...matched.map((concept) => concept.name));

  const explicitScene = hasExplicitScene(effectiveRequest);
  const airplaneScene = hasAirplaneSceneOverride(effectiveRequest);
  const explicitCleanBackdrop = hasCleanBackdropRequest(effectiveRequest);
  const sceneOverride = explicitScene || airplaneScene;
  const wantsCleanBackground = !sceneOverride || explicitCleanBackdrop;
  if (sceneOverride && !explicitCleanBackdrop) {
    // Aircraft seed knowledge includes sky, landing-gear and full-exterior
    // rules. A requested hangar, runway, night scene or cutaway must not be
    // silently rewritten into a daylight outdoor airplane.
    const before = rules.positive.length + rules.negative.length;
    const groundedOrInside = /\b(hangar|runway|airport|airfield|tarmac|parked|grounded|museum|display|exhibit|indoor|interior|inside|cutaway|cross.section)\b/i.test(effectiveRequest);
    rules = {
      positive: rules.positive.filter((rule) => {
        if (/\b(clear blue sky|isolated against|empty sky|full exterior)\b/i.test(rule)) return false;
        if (groundedOrInside && /\b(landing gear|flying|airborne)\b/i.test(rule)) return false;
        return true;
      }),
      negative: rules.negative.filter((rule) => {
        if (/\b(bus|truck|trees|forest|smoke|buildings)(,|$)/i.test(rule)) return false;
        if (groundedOrInside && /\b(missing landing gear|car interior|dashboard|steering wheel)\b/i.test(rule)) return false;
        return true;
      }),
    };
    if (before !== rules.positive.length + rules.negative.length) {
      adjustments.push("scene-specific background and aircraft rules relaxed for the requested setting");
    }
    adjustments.push("explicit scene preserved; no generic clean-background or sky rewrite");
  }

  if (anatomy.person || anatomy.animal) {
    adjustments.push(`semantic ${anatomy.person && anatomy.animal ? "person and animal" : anatomy.person ? "person" : "animal"} anatomy rules applied`);
  }
  if (anatomyRules.length) adjustments.push(`${anatomyRules.length} anatomy contract(s) enforced`);

  const scopeNames = new Set([
    ...subjects.map((subject) => subject.name),
    ...matched.map((concept) => concept.name),
  ]);
  if (anatomy.person) { scopeNames.add("person"); scopeNames.add("human"); }
  if (anatomy.animal) scopeNames.add("animal");
  if (anatomy.vehicle) scopeNames.add("vehicle");

  const notesWithSubject = feedbackNotes.map((note) => ({
    ...note,
    subject: note.subject ?? matched.find((concept) =>
      note.imageId && concept.feedbackNotes.some((item) => item.id === note.id))?.name ?? subjects[0]?.name,
  }));
  const relevantNotes = notesWithSubject.filter((note) => {
    if (note.kind === "preference") return false;
    if (note.kind === "visual-fact" && !note.id.startsWith("manual:")) return false;
    if (!note.subject) return true;
    return scopeMatches(note.subject, scopeNames);
  }).slice(-6);

  const scopedRecent: ScopedCorrection[] = (recentCorrections ?? []).map((item) =>
    typeof item === "string" ? { note: item, kind: "correction" } : item);
  const relevantRecent = scopedRecent.filter((item) => {
    if (item.kind === "preference") return false;
    if (item.kind === "visual-fact" && (!item.count || item.count < 2)) return false;
    const candidates = item.subjects?.length ? item.subjects : item.subject ? [item.subject] : [];
    return !candidates.length || candidates.some((name) => scopeMatches(name, scopeNames));
  }).slice(-4);

  const correctionEntries = [
    ...relevantRecent.map((item) => ({
      note: item.note,
      context: correctionContext(item.subject ?? item.subjects?.[0] ?? subjects[0]?.name ?? "", subjects, concepts),
      kind: item.kind,
    })),
    ...relevantNotes.map((note) => ({
      note: note.note,
      context: correctionContext(note.subject ?? "", subjects, concepts),
      kind: note.kind,
    })),
  ];
  const correctionRules = correctionEntries.map((entry) => deriveStructuralCorrection(entry.note, entry.context));
  const feedbackTier: string[] = [];
  const learnedNegatives: string[] = [];
  for (const [index, entry] of correctionEntries.entries()) {
    const rule = correctionRules[index];
    if (isBackgroundRule(rule) && !wantsCleanBackground) {
      adjustments.push("learned background correction withheld for the explicit scene");
      continue;
    }
    feedbackTier.push(rule?.positive ?? deriveCorrection(entry.note, entry.context.name));
    if (rule?.negative) learnedNegatives.push(rule.negative);
  }
  if (feedbackTier.length) adjustments.push(`${feedbackTier.length} scoped learned correction(s) applied`);

  const backgroundCorrectionIndex = correctionRules.findIndex((rule) => isBackgroundRule(rule));
  const backgroundCorrection = backgroundCorrectionIndex >= 0 ? correctionRules[backgroundCorrectionIndex] : null;
  const backgroundPositive = wantsCleanBackground
    ? [backgroundCorrection?.positive ?? "clean uncluttered background"]
    : [];
  const backgroundNegative = wantsCleanBackground
    ? [backgroundCorrection?.negative ?? "busy background, random objects"]
    : [];
  if (backgroundPositive.length) adjustments.push("clean background rule applied");

  const styleTier: string[] = [];
  if (photographic) {
    styleTier.push(...photoTerms(effectiveRequest, anatomy));
    adjustments.push("photographic rendering terms applied");
  } else if (settings.style && settings.style !== "auto") {
    const preset = concepts.find((concept) =>
      concept.name.toLowerCase() === settings.style.toLowerCase() && concept.category === "style");
    if (preset) {
      styleTier.push(...preset.attributes.slice(0, 4));
      usedConcepts.push(preset.name);
    } else {
      styleTier.push(settings.style);
    }
  }

  const promptAttributes = extractAttributes(effectiveRequest, 5);
  if (promptAttributes.length) adjustments.push(`${promptAttributes.length} detail(s) detected directly in the request`);

  // Enhancement cues are inserted after the user's own details and before
  // generic knowledge, so a tight CLIP budget never discards explicit intent.
  // Cues rejected by the reference filter are removed again here as a safety
  // net, and their exclusion is disclosed rather than hidden.
  const rejectedCues = new Set((enhancement?.cueProvenance?.rejected ?? []).map((cue) => cue.toLowerCase()));
  const enhancementTier = uniqueTerms((enhancement?.additions ?? []).filter((cue) => !rejectedCues.has(cue.toLowerCase())));
  if (enhancementTier.length) adjustments.push(`${enhancementTier.length} structured prompt enhancement cue(s) applied`);
  if (enhancement?.cueProvenance?.applied.length) {
    adjustments.push(`${enhancement.cueProvenance.applied.length} uploaded-reference palette cue(s) labelled as inspiration`);
  }
  if (enhancement?.cueProvenance?.rejected.length) {
    adjustments.push(`${enhancement.cueProvenance.rejected.length} reference cue(s) withheld as conflicting with the explicit request`);
  }
  const enhancementNegatives = uniqueTerms([
    ...(enhancement?.negativeSuggestions ?? []),
    ...strippedNegations.map((phrase) => `no ${phrase}`),
  ]);

  // Camera, lighting, composition, colour and material concepts are knowledge,
  // not subjects. The concise object branch used to discard them entirely, so
  // a request like "macro shot of a watch" lost the very terms that make it a
  // macro shot. Keep them as a small dedicated tier.
  const sceneCategories = new Set(["camera", "lighting", "composition", "color", "material"]);
  const sceneTier: string[] = [];
  for (const concept of matched) {
    if (!sceneCategories.has(concept.category)) continue;
    for (const attribute of concept.attributes.slice(0, 2)) sceneTier.push(attribute);
    if (sceneTier.length >= 4) break;
  }
  if (sceneTier.length) adjustments.push(`${sceneTier.length} cinematography detail(s) applied`);

  const knowledgeTier: string[] = [];
  const conceptAttributes = matched.map((concept) => concept.attributes.slice(0, 4));
  // Interleave subjects so a concrete clothing detail ("tailored jacket") is
  // not crowded out by a long list of generic person attributes.
  for (let index = 0; index < 4 && knowledgeTier.length < 8; index++) {
    for (const attributes of conceptAttributes) {
      if (knowledgeTier.length >= 8) break;
      const attribute = attributes[index];
      if (attribute) knowledgeTier.push(attribute);
    }
  }
  if (knowledgeTier.length) adjustments.push(`${knowledgeTier.length} structured subject detail(s) applied`);
  if (rules.positive.length) adjustments.push(`${rules.positive.length} structural rule(s) enforced`);

  // Research captions are only useful when local structured knowledge is too
  // thin to describe the subject. For known subjects they add contradictions
  // such as "bright high-key tones" beside "night-time lighting".
  let researchTier: string[] = [];
  if (research && !research.skipped) {
    if (rules.positive.length || anatomy.positive.length) {
      adjustments.push("research captions withheld: structured visual rules already cover the subject");
    } else {
      const explicitCues = [effectiveRequest, ...promptAttributes, ...sceneTier, ...enhancementTier].join(" ");
      const candidates = research.characteristics.filter((characteristic) =>
        !UNRELIABLE_RESEARCH.test(characteristic) && !cueConflictsWithRequest(characteristic, explicitCues));
      const rejected = research.characteristics.length - candidates.length;
      researchTier = uniqueTerms(candidates).slice(0, 2);
      if (researchTier.length) {
        adjustments.push(`${researchTier.length} caption-derived cue(s) applied from openly licensed metadata`);
      }
      if (rejected) adjustments.push(`${rejected} caption-derived cue(s) withheld as unverified or conflicting`);
    }
  }

  // Objects and machines drift more easily when a long list of abstract rules
  // competes with the subject. Keep those prompts short and canonical; people
  // and animals still get the full structured treatment.
  const hasPeopleOrAnimals = anatomy.person || anatomy.animal
    || subjects.some((subject) => subject.category === "person" || subject.category === "animal");
  const conciseObject = !hasPeopleOrAnimals && matched.length > 0;
  // When structural rules already describe a machine, generic attributes such
  // as "long cylindrical fuselage" add drift rather than accuracy. Objects
  // without structural rules still receive their concrete material knowledge.
  const objectKnowledge = rules.positive.length ? [] : knowledgeTier.slice(0, 3);
  const finalPrompt = conciseObject
    ? capText(assemble([
        [cleanPrompt],
        // User corrections outrank generic rules: a learned "clean empty sky"
        // or "visible landing gear" fix must survive the 77-token CLIP window.
        feedbackTier.slice(0, 4),
        rules.positive.slice(0, 5),
        backgroundPositive,
        anatomyRules.slice(0, 4),
        objectKnowledge,
        sceneTier.slice(0, 3),
        enhancementTier.slice(0, 5),
        photographic ? ["photograph", "highly detailed", "soft natural light"] : [styleTier[0] ?? ""],
      ]).join(", "), 600)
    : capText(assemble([
        [cleanPrompt],
        feedbackTier.slice(0, 4),
        rules.positive.slice(0, 5),
        backgroundPositive,
        anatomyRules.slice(0, 8),
        // Style precedes the long knowledge list for non-photographic looks;
        // otherwise "watercolor" could be squeezed out before it is seen.
        styleTier.slice(0, 3),
        knowledgeTier,
        promptAttributes,
        sceneTier,
        enhancementTier,
        researchTier,
      ]).join(", "), 1000);
  if (conciseObject) adjustments.push("concise object prompt compiled to avoid subject drift");

  const negativeRules = rules.negative.slice(0, 16);
  if (negativeRules.length) adjustments.push(`${negativeRules.length} structural failure(s) excluded`);
  const negativePrompt = capText(assemble(
    [
      // The user's own negative prompt is highest priority so a long list of
      // learned rules can never push it out of the CLIP window.
      uniqueTerms(tidy(settings.negativePrompt).split(",")),
      enhancementNegatives,
      uniqueTerms(anatomy.negative),
      uniqueTerms(learnedNegatives),
      uniqueTerms(backgroundNegative),
      uniqueTerms(negativeRules),
    ],
    NEGATIVE_TOKEN_BUDGET,
  ).join(", "), 700);

  return { finalPrompt, negativePrompt, usedConcepts: [...new Set(usedConcepts)], adjustments };
}
