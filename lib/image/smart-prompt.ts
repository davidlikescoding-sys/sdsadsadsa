/**
 * Short, subject-first prompt compiler for SD 1.5.
 *
 * The old structured compiler pushed 50-70 words of anatomy and dataset rules
 * through CLIP's 77-token window. On this machine that produced fragmented,
 * unrecognizable images. SD 1.5 responds far better to a compact request plus
 * two holistic constraints. This compiler deliberately keeps the user's own
 * sentence dominant and records every change as an honest adjustment.
 */
import type { EnhancedPrompt } from "./prompt-enhancer";
import { cueConflictsWithRequest, parsePromptIntent } from "./prompt-enhancer";
import { detectAnatomy } from "./visual-anatomy";
import { deriveCorrection, deriveStructuralCorrection } from "./visual-knowledge";
import type {
  ImageGenerationSettings,
  ScopedCorrection,
  VisualConcept,
  VisualFeedbackNote,
  VisualSubject,
} from "./types";

export interface SmartDescriptionInput {
  prompt: string;
  subjects: VisualSubject[];
  concepts: VisualConcept[];
  feedbackNotes: VisualFeedbackNote[];
  settings: ImageGenerationSettings;
  recentCorrections?: Array<string | ScopedCorrection>;
  enhancement?: EnhancedPrompt | null;
}

export interface SmartDescription {
  finalPrompt: string;
  negativePrompt: string;
  usedConcepts: string[];
  adjustments: string[];
}

const PROMPT_CHARS = 300;
const NEGATIVE_CHARS = 240;

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[;:,]+$/, "");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = tidy(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function cap(value: string, max: number): string {
  const text = tidy(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf(","), cut.lastIndexOf(" "));
  return tidy(boundary > max * 0.6 ? cut.slice(0, boundary) : cut);
}

function correctionContext(name: string, concepts: VisualConcept[]) {
  const concept = concepts.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return {
    name,
    category: concept?.category,
    attributes: concept?.attributes,
    constraints: concept?.constraints,
  };
}

function scopeMatches(name: string, scope: Set<string>): boolean {
  const value = name.toLowerCase().replace(/\s+$/, "");
  for (const item of scope) {
    if (value === item || value.includes(item) || item.includes(value)) return true;
  }
  return false;
}

/** Negative prompts list the thing to suppress, not another negation word. */
function bareNegative(phrase: string): string {
  return tidy(phrase).replace(/^(?:no|without|avoid|excluding|not)\s+/i, "");
}

/**
 * Compiles a short prompt that keeps the user's request, two holistic subject
 * anchors, and only corrections that were actually learned for this subject.
 */
export function buildSmartDescription(input: SmartDescriptionInput): SmartDescription {
  const { prompt, subjects, concepts, feedbackNotes, settings, recentCorrections, enhancement } = input;
  const adjustments: string[] = [];
  const intent = enhancement?.intent ?? parsePromptIntent(prompt);
  const request = cap(tidy(intent.request) || tidy(prompt), 240);
  if (intent.negations.length) {
    adjustments.push(`${intent.negations.length} explicit negation(s) moved to the negative prompt`);
  }

  const anatomy = detectAnatomy(request, subjects);
  const subjectNames = new Set(subjects.map((subject) => subject.name.toLowerCase()));
  if (anatomy.person) subjectNames.add("person");
  if (anatomy.animal) subjectNames.add("animal");
  if (anatomy.vehicle) subjectNames.add("vehicle");

  const positive: string[] = [request];
  const negative: string[] = [];

  // Two holistic anchors beat a dozen part-count rules at 256-512px. They give
  // the model a structural target without spending CLIP tokens on "one head",
  // "two eyes" style instructions that fragment the silhouette.
  if (anatomy.person) {
    positive.push("natural human proportions", "anatomically correct hands");
    negative.push("extra limbs", "malformed hands", "deformed face");
    adjustments.push("compact human anatomy anchors applied");
  } else if (anatomy.animal) {
    positive.push("natural animal anatomy", "correct silhouette");
    negative.push("extra limbs", "deformed anatomy", "mutated shape");
    adjustments.push("compact animal anatomy anchors applied");
  } else if (anatomy.vehicle) {
    positive.push("recognizable silhouette", "correct mechanical layout");
    negative.push("broken geometry", "floating parts", "duplicated parts");
    adjustments.push("compact vehicle structure anchors applied");
  }

  // Learned feedback is still respected, but only for the subject it belongs
  // to and only as a short positive construction rule.
  const corrections: ScopedCorrection[] = (recentCorrections ?? []).map((item) =>
    typeof item === "string" ? { note: item, kind: "correction" } : item);
  for (const item of corrections.slice(-3)) {
    if (item.kind === "preference") continue;
    const candidates = item.subjects?.length ? item.subjects : item.subject ? [item.subject] : [];
    const matched = candidates.find((name) => scopeMatches(name, subjectNames));
    if (candidates.length && !matched) continue;
    const subjectName = matched ?? "";
    const rule = deriveStructuralCorrection(item.note, correctionContext(subjectName, concepts));
    const phrase = rule?.positive ?? deriveCorrection(item.note, subjectName || undefined);
    if (phrase) positive.push(cap(phrase, 90));
    if (rule?.negative) negative.push(cap(rule.negative, 90));
  }
  if (positive.length > 1 + (anatomy.person || anatomy.animal || anatomy.vehicle ? 2 : 0)) {
    adjustments.push("scoped learned corrections applied");
  }

  for (const note of feedbackNotes.filter((item) => item.kind === "visual-fact").slice(-2)) {
    if (note.subject && !scopeMatches(note.subject, subjectNames)) continue;
    const rule = deriveStructuralCorrection(note.note, correctionContext(note.subject ?? "", concepts));
    if (rule?.positive) positive.push(cap(rule.positive, 90));
    if (rule?.negative) negative.push(cap(rule.negative, 90));
  }

  // Colour and lighting cues are prioritised over generic environment phrases.
  // Low-step SD 1.5 otherwise invents its own palette and produces muddy,
  // over-saturated renders even when the subject and layout are correct.
  const rejected = new Set((enhancement?.cueProvenance?.rejected ?? []).map((cue) => cue.toLowerCase()));
  const priorityKeys = ["lighting", "colors", "time", "weather", "environment", "composition", "camera", "depth", "style"] as const;
  const userCues = priorityKeys.flatMap((key) => enhancement?.intent.details[key] ?? []);
  const allowed = (cue: string) => !rejected.has(cue.toLowerCase()) && !cueConflictsWithRequest(cue, request);
  // Snow needs its own white/cool-shadow cue: without it SD 1.5 paints snow as
  // grey or orange under golden-hour light. This cue comes from the user's own
  // words, so the reference-cue conflict filter must not discard it merely
  // because the scene is also warm. An explicit rejection of blue/cool still wins.
  const snowy = /\b(snow|snowy|winter|frost|frosty|ice|icy|blizzard)\b/i.test(request)
    || userCues.some((cue) => /\b(snow|winter|frost|ice)\b/i.test(cue));
  const rejectsCool = intent.negations.some((note) => /\b(blue|cool|cold)\b/i.test(note));
  const snowCue = snowy && !rejectsCool ? "bright white snow with cool blue shadows" : null;
  const lightingCues = [
    ...(enhancement?.intent.details.lighting ?? []),
    ...(enhancement?.intent.details.colors ?? []),
  ];
  const supportingKeys = priorityKeys.filter((key) => key !== "lighting" && key !== "colors");
  const supportingCues = supportingKeys.flatMap((key) => enhancement?.intent.details[key] ?? []);
  const redundantForSnow = (cue: string) => !!snowCue && /\b(snow|winter|forest environment)\b/i.test(cue);
  const cues = unique([
    ...lightingCues.filter(allowed),
    ...(snowCue ? [snowCue] : []),
    ...supportingCues.filter((cue) => allowed(cue) && !redundantForSnow(cue)),
    ...(enhancement?.additions ?? []).filter((cue) => allowed(cue) && !redundantForSnow(cue)),
  ].map((cue) => cap(cue, 80))).slice(0, 3);
  if (cues.length) {
    positive.push(...cues);
    adjustments.push(`${cues.length} non-conflicting enhancement cue(s) applied`);
  }

  const userNegative = unique(tidy(settings.negativePrompt).split(","));
  const finalPrompt = cap(unique(positive).join(", "), PROMPT_CHARS);
  const finalNegative = cap(unique([
    ...userNegative,
    ...intent.negations,
    ...(enhancement?.negativeSuggestions ?? []).map(bareNegative),
    "low quality",
    "blurry",
    "distorted",
    "watermark",
    "text",
    "unnatural colors",
    "color cast",
    "oversaturated",
    "discolored",
    ...negative,
  ]).join(", "), NEGATIVE_CHARS);

  return {
    finalPrompt,
    negativePrompt: finalNegative,
    usedConcepts: [...subjectNames],
    adjustments,
  };
}
