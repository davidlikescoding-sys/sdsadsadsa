/**
 * Prompt Enhancement Engine.
 *
 * The user's sentence is always the first and most important part of the final
 * prompt. This module only adds short, machine-readable visual cues and moves
 * explicit negations into the negative prompt; it never replaces the request or
 * invents a different subject.
 */
import type { ImageGenerationSettings } from "./types";

export type IntentKey =
  | "environment"
  | "lighting"
  | "camera"
  | "perspective"
  | "composition"
  | "colors"
  | "materials"
  | "textures"
  | "atmosphere"
  | "weather"
  | "time"
  | "depth"
  | "style"
  | "realism"
  | "details";

export interface PromptIntent {
  /** The original sentence with negation clauses removed. */
  request: string;
  subject: string;
  details: Record<IntentKey, string[]>;
  /** Explicit "no/without/avoid" clauses, moved to the negative prompt. */
  negations: string[];
  emphasis: string[];
  categories: IntentKey[];
}

interface LexiconEntry {
  key: IntentKey;
  pattern: RegExp;
  phrase: string;
}

// Each pattern maps everyday language to a short phrase SD 1.5 reliably
// understands. Phrases are deliberately conservative: they augment, never
// override, what the user wrote.
const LEXICON: LexiconEntry[] = [
  // Environment / background
  { key: "environment", pattern: /\b(indoor|inside|interior|room|studio|warehouse|hangar)\b/i, phrase: "indoor setting" },
  { key: "environment", pattern: /\b(outdoor|outside|exterior|open air)\b/i, phrase: "outdoor setting" },
  { key: "environment", pattern: /\b(forest|woods|woodland|jungle)\b/i, phrase: "forest environment" },
  { key: "environment", pattern: /\b(desert|dunes?)\b/i, phrase: "desert environment" },
  { key: "environment", pattern: /\b(mountain|alpine|valley|cliff)\b/i, phrase: "mountain environment" },
  { key: "environment", pattern: /\b(ocean|sea|beach|shore|coast)\b/i, phrase: "coastal environment" },
  { key: "environment", pattern: /\b(city|urban|street|skyline|downtown)\b/i, phrase: "urban environment" },
  { key: "environment", pattern: /\b(snow|snowy|winter|frost|ice)\b/i, phrase: "snow and winter detail" },
  { key: "environment", pattern: /\b(clean|plain|minimal|uncluttered) (?:background|backdrop)\b/i, phrase: "clean uncluttered background" },
  { key: "environment", pattern: /\b(gradient|seamless) (?:background|backdrop)\b/i, phrase: "seamless studio backdrop" },

  // Lighting
  { key: "lighting", pattern: /\b(golden hour|sunset|sunrise|low.angle light)\b/i, phrase: "warm golden hour light" },
  { key: "lighting", pattern: /\b(studio|softbox|product lighting|controlled light)\b/i, phrase: "controlled studio lighting" },
  { key: "lighting", pattern: /\b(neon|cyberpunk|rgb light)\b/i, phrase: "neon accent lighting" },
  { key: "lighting", pattern: /\b(candlelight|firelight|lantern)\b/i, phrase: "warm candlelit illumination" },
  { key: "lighting", pattern: /\b(moonlight|night|midnight)\b/i, phrase: "cool moonlit illumination" },
  { key: "lighting", pattern: /\b(backlit|backlight|rim light|silhouette)\b/i, phrase: "strong rim lighting" },
  { key: "lighting", pattern: /\b(harsh|dramatic) (?:light|lighting|shadows?)\b/i, phrase: "dramatic high contrast lighting" },
  { key: "lighting", pattern: /\b(soft|diffused) (?:light|lighting)\b/i, phrase: "soft diffused lighting" },
  { key: "lighting", pattern: /\b(natural light|daylight|overcast)\b/i, phrase: "soft natural daylight" },

  // Camera
  { key: "camera", pattern: /\b(macro|extreme close.?up|close.?up|close shot)\b/i, phrase: "extreme close framing" },
  { key: "camera", pattern: /\b(wide.angle|wide shot|panoramic|landscape shot)\b/i, phrase: "wide angle framing" },
  { key: "camera", pattern: /\b(aerial|drone|bird.?s eye|top.down|overhead)\b/i, phrase: "high aerial viewpoint" },
  { key: "camera", pattern: /\b(low.angle|worm.?s eye|from below)\b/i, phrase: "low angle viewpoint" },
  { key: "camera", pattern: /\b(telephoto|long lens|compressed perspective)\b/i, phrase: "telephoto lens compression" },
  { key: "camera", pattern: /\b(full body|full length|full exterior)\b/i, phrase: "full subject visible" },
  { key: "camera", pattern: /\b(portrait shot|headshot|portrait)\b/i, phrase: "portrait framing" },

  // Perspective / composition
  { key: "perspective", pattern: /\b(three.quarter|3\/4 view|angled view)\b/i, phrase: "three quarter view" },
  { key: "perspective", pattern: /\b(front view|head.on|straight on)\b/i, phrase: "front-facing view" },
  { key: "perspective", pattern: /\b(side view|profile|side profile)\b/i, phrase: "side profile view" },
  { key: "perspective", pattern: /\b(rear view|from behind|back view)\b/i, phrase: "rear view" },
  { key: "composition", pattern: /\b(centered|centre framed|center framed)\b/i, phrase: "centered composition" },
  { key: "composition", pattern: /\b(rule of thirds|off.center)\b/i, phrase: "off-center rule of thirds composition" },
  { key: "composition", pattern: /\b(symmetrical|symmetry|mirrored)\b/i, phrase: "symmetrical composition" },
  { key: "composition", pattern: /\b(leading lines|diagonal|dynamic angle)\b/i, phrase: "dynamic diagonal composition" },
  { key: "composition", pattern: /\b(minimal|negative space|lots of empty space)\b/i, phrase: "generous negative space" },

  // Colour, material, texture
  { key: "colors", pattern: /\b(monochrome|black and white|grayscale|greyscale)\b/i, phrase: "monochrome palette" },
  { key: "colors", pattern: /\b(pastel|soft tones|muted colou?rs?)\b/i, phrase: "muted pastel palette" },
  { key: "colors", pattern: /\b(vivid|saturated|vibrant colou?rs?)\b/i, phrase: "vivid saturated palette" },
  { key: "colors", pattern: /\b(golden|amber|brass|gold colou?r)\b/i, phrase: "warm gold and amber tones" },
  { key: "colors", pattern: /\b(teal and orange|cyan and orange)\b/i, phrase: "teal and orange color grading" },
  { key: "colors", pattern: /\b(chrome|silver|metallic|steel)\b/i, phrase: "mirror-like metal surfaces" },
  { key: "colors", pattern: /\b(matte|glossy|polished|brushed)\b/i, phrase: "controlled surface finish" },
  { key: "materials", pattern: /\b(wood|wooden|oak|walnut)\b/i, phrase: "visible natural wood grain" },
  { key: "materials", pattern: /\b(glass|transparent|crystal)\b/i, phrase: "transparent glass surface" },
  { key: "materials", pattern: /\b(marble|stone|concrete)\b/i, phrase: "natural stone surface" },
  { key: "materials", pattern: /\b(leather|canvas|linen|fabric)\b/i, phrase: "natural fabric texture" },
  { key: "textures", pattern: /\b(rough|weathered|worn|scratched|rusty)\b/i, phrase: "worn weathered surface texture" },
  { key: "textures", pattern: /\b(smooth|clean|flawless|pristine)\b/i, phrase: "smooth flawless finish" },
  { key: "textures", pattern: /\b(intricate|ornate|detailed carving|filigree)\b/i, phrase: "intricate micro detail" },

  // Atmosphere, weather, time, depth, style, realism
  { key: "atmosphere", pattern: /\b(cinematic|film still|movie still)\b/i, phrase: "cinematic atmosphere" },
  { key: "atmosphere", pattern: /\b(dreamy|ethereal|surreal|magical)\b/i, phrase: "dreamlike ethereal atmosphere" },
  { key: "atmosphere", pattern: /\b(moody|dark and moody|low.key)\b/i, phrase: "moody low-key atmosphere" },
  { key: "weather", pattern: /\b(rain|rainy|wet|drizzle)\b/i, phrase: "rainy conditions with wet surfaces" },
  { key: "weather", pattern: /\b(fog|mist|haze|foggy)\b/i, phrase: "soft atmospheric haze" },
  { key: "weather", pattern: /\b(windy|storm|stormy|cloudy)\b/i, phrase: "dramatic cloudy weather" },
  { key: "time", pattern: /\b(morning|dawn|sunrise)\b/i, phrase: "early morning time" },
  { key: "time", pattern: /\b(afternoon|midday|noon)\b/i, phrase: "bright daytime" },
  { key: "time", pattern: /\b(evening|dusk|twilight)\b/i, phrase: "evening twilight" },
  { key: "depth", pattern: /\b(shallow depth of field|bokeh|blurred background|out of focus background)\b/i, phrase: "shallow depth of field with soft bokeh" },
  { key: "depth", pattern: /\b(deep focus|everything in focus|sharp throughout)\b/i, phrase: "deep focus from foreground to background" },
  { key: "style", pattern: /\b(photo|photograph|photorealistic|realistic photo)\b/i, phrase: "photograph" },
  { key: "style", pattern: /\b(watercolor|watercolour)\b/i, phrase: "watercolor painting" },
  { key: "style", pattern: /\b(oil painting|painterly|brushwork)\b/i, phrase: "oil painting with visible brushwork" },
  { key: "style", pattern: /\b(anime|cartoon|illustration)\b/i, phrase: "stylized illustration" },
  { key: "style", pattern: /\b(3d render|octane|blender render)\b/i, phrase: "detailed 3d render" },
  { key: "style", pattern: /\b(product photo|commercial product)\b/i, phrase: "premium product photograph" },
  { key: "realism", pattern: /\b(anatomically correct|correct anatomy|realistic anatomy)\b/i, phrase: "realistic anatomy" },
  { key: "realism", pattern: /\b(physically plausible|realistic engineering|correct mechanics)\b/i, phrase: "physically plausible construction" },
  { key: "details", pattern: /\b(highly detailed|ultra detailed|intricate detail|fine detail)\b/i, phrase: "highly detailed" },
  { key: "details", pattern: /\b(sharp focus|crisp|in focus)\b/i, phrase: "sharp focus" },
];

const EMPTY_DETAILS = (): Record<IntentKey, string[]> => ({
  environment: [], lighting: [], camera: [], perspective: [], composition: [], colors: [],
  materials: [], textures: [], atmosphere: [], weather: [], time: [], depth: [], style: [],
  realism: [], details: [],
});

const EMPHASIS = /\b(very|extremely|incredibly|highly|super|ultra|absolutely)\b/gi;
const NEGATION = /\b(?:no|without|avoid|excluding|not)\s+([a-z][a-z\s-]{1,32}?)(?=\s*,|\s+and\s+|\s+with\s+|$)/gi;

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^[,;\s]+|[,;\s]+$/g, "");
}

function includesPhrase(haystack: string, phrase: string): boolean {
  const words = tidy(phrase).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return words.every((word) => haystack.includes(word));
}

const CUE_CONFLICTS: Array<{ cue: RegExp; request: RegExp }> = [
  { cue: /\b(warm|gold|amber|sunlit|sunlight|sunset|daylight|golden)\b/i, request: /\b(night|midnight|moon|moonlit|cool|blue|cyan|teal|neon|overcast|rain)\b/i },
  { cue: /\b(cool|blue|cyan|teal|night|moon|moonlit)\b/i, request: /\b(warm|gold|amber|sunset|golden hour|candle|firelight|brick|rust)\b/i },
  { cue: /\b(bright|high-key|high key)\b/i, request: /\b(dark|low-key|low key|moody|night|shadowed)\b/i },
  { cue: /\b(dark|low-key|low key|moody)\b/i, request: /\b(bright|high-key|high key|daylight|sunlit|studio)\b/i },
  { cue: /\b(studio|controlled|seamless)\b/i, request: /\b(outdoor|outside|natural light|sunlight|forest|street|beach|mountain)\b/i },
  { cue: /\b(outdoor|natural light|sunlight)\b/i, request: /\b(studio|indoor|interior|hangar|warehouse)\b/i },
];

function hexTemperature(hex: string): "warm" | "cool" | "neutral" {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return "neutral";
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.12) return "neutral";
  if (r >= b && r >= g) return "warm";
  if (b >= r && b >= g) return "cool";
  return "neutral";
}

/**
 * Cues mined from uploaded palettes or reference captions are suggestions, not
 * facts about the requested scene. Drop them when they contradict an explicit
 * colour, lighting or setting choice in the user's own request.
 */
export function cueConflictsWithRequest(cue: string, request: string): boolean {
  if (!cue.trim() || !request.trim()) return false;
  if (CUE_CONFLICTS.some((entry) => entry.cue.test(cue) && entry.request.test(request))) return true;
  const warmRequest = /\b(warm|gold|amber|sunset|golden hour|brick|rust|orange|red|yellow)\b/i.test(request);
  const coolRequest = /\b(cool|blue|cyan|teal|navy|ice|snow|moonlight)\b/i.test(request);
  for (const hex of cue.match(/#[0-9a-f]{6}\b/gi) ?? []) {
    const temperature = hexTemperature(hex);
    if (temperature === "warm" && coolRequest) return true;
    if (temperature === "cool" && warmRequest) return true;
  }
  return false;
}

/** Keeps only reference-derived cues that agree with the user's request. */
export function filterReferenceCues(cues: string[], request: string): string[] {
  return cues.filter((cue) => !cueConflictsWithRequest(cue, request));
}

/** Extracts explicit intent without changing what the user asked for. */
export function parsePromptIntent(prompt: string): PromptIntent {
  const source = tidy(prompt);
  const details = EMPTY_DETAILS();
  const negations: string[] = [];

  let request = source.replace(NEGATION, (_match, captured: string) => {
    const phrase = tidy(captured);
    if (phrase) negations.push(phrase);
    return " ";
  });
  request = tidy(request.replace(/\s{2,}/g, " "));

  for (const entry of LEXICON) {
    if (!entry.pattern.test(request)) continue;
    if (!details[entry.key].some((item) => item.toLowerCase() === entry.phrase.toLowerCase())) {
      details[entry.key].push(entry.phrase);
    }
  }
  const emphasis = [...request.matchAll(EMPHASIS)].map((match) => match[0].toLowerCase());
  const subject = tidy(request.split(/[,;]/)[0] ?? request).slice(0, 160);
  const categories = (Object.keys(details) as IntentKey[]).filter((key) => details[key].length > 0);
  return { request, subject, details, negations, emphasis: [...new Set(emphasis)], categories };
}

const CONTROL_LABELS: Array<{ key: keyof ImageGenerationSettings; label: string; hints: string[] }> = [
  { key: "lighting", label: "lighting", hints: ["light", "lit", "illumination", "backlit", "softbox"] },
  { key: "camera", label: "camera", hints: ["close", "wide", "view", "shot", "macro", "angle", "lens", "framing"] },
  { key: "perspective", label: "perspective", hints: ["view", "angle", "front", "side", "rear", "profile", "three quarter"] },
  { key: "composition", label: "composition", hints: ["composition", "centered", "thirds", "negative space", "symmetr", "diagonal"] },
  { key: "colorPalette", label: "color palette", hints: ["color", "colour", "palette", "tone", "monochrome"] },
  { key: "depthOfField", label: "depth of field", hints: ["depth", "bokeh", "focus"] },
  { key: "texture", label: "surface texture", hints: ["texture", "grain", "smooth", "rough", "weathered", "flawless", "finish"] },
  { key: "atmosphere", label: "atmosphere", hints: ["atmosphere", "cinematic", "mood", "dream", "surreal", "ethereal"] },
  { key: "weather", label: "weather", hints: ["rain", "fog", "mist", "storm", "cloud", "weather", "snow"] },
  { key: "timeOfDay", label: "time of day", hints: ["morning", "evening", "night", "dawn", "dusk", "noon", "day", "twilight"] },
  { key: "detailLevel", label: "detail level", hints: ["detail", "detailed", "sharp", "intricate", "crisp"] },
  { key: "realism", label: "realism", hints: ["realistic", "realism", "anatomy", "physically", "correct mechanics"] },
];

/** Converts explicit UI controls into short diffusion phrases. */
export function controlTerms(settings: ImageGenerationSettings | undefined): string[] {
  if (!settings) return [];
  const result: string[] = [];
  for (const { key, label, hints } of CONTROL_LABELS) {
    const value = settings[key];
    if (typeof value !== "string") continue;
    const term = tidy(value);
    if (!term || term === "auto" || term === "none") continue;
    const lower = term.toLowerCase();
    const phrase = hints.some((hint) => lower.includes(hint)) ? term : `${term} ${label}`;
    if (!result.some((item) => item.toLowerCase() === phrase.toLowerCase())) result.push(phrase);
  }
  return result;
}

export interface EnhancedPrompt {
  text: string;
  intent: PromptIntent;
  /** Cues added by the engine, in the order they were appended. */
  additions: string[];
  /** Explicit negations, ready for the negative prompt. */
  negativeSuggestions: string[];
  /** Honest accounting of reference-derived suggestions. */
  cueProvenance?: {
    applied: string[];
    rejected: string[];
  };
}

const ORDER: IntentKey[] = [
  "environment", "lighting", "camera", "perspective", "composition", "depth", "colors",
  "materials", "textures", "atmosphere", "weather", "time", "style", "realism", "details",
];

/**
 * Produces the preview shown behind the Original / Enhanced toggle. The final
 * compiler may still shorten this for the CLIP window, but it never changes the
 * meaning of the user's request.
 */
export function enhancePrompt(prompt: string, settings?: ImageGenerationSettings): EnhancedPrompt {
  const intent = parsePromptIntent(prompt);
  const additions: string[] = [];
  const text = [intent.request];

  const append = (phrase: string) => {
    const clean = tidy(phrase);
    if (!clean) return;
    if (includesPhrase(text.join(", ").toLowerCase(), clean.toLowerCase())) return;
    if (additions.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
    text.push(clean);
    additions.push(clean);
  };

  for (const key of ORDER) for (const phrase of intent.details[key]) append(phrase);
  for (const phrase of controlTerms(settings)) append(phrase);

  return {
    text: text.join(", ").slice(0, 900),
    intent,
    additions,
    negativeSuggestions: intent.negations.map((phrase) => tidy(`no ${phrase}`)),
  };
}

/** Weakness report used by the prompt lab; it never generates an image. */
export function promptWeaknesses(prompt: string, settings?: ImageGenerationSettings): string[] {
  const intent = parsePromptIntent(prompt);
  const weaknesses: string[] = [];
  if (intent.request.length < 12) weaknesses.push("Request is very short; describe the subject and one visible action or state.");
  if (!intent.details.environment.length) weaknesses.push("No setting named; the model will invent a background.");
  if (!intent.details.lighting.length && !settings?.lighting) weaknesses.push("No lighting cue; lighting will be guessed.");
  if (!intent.details.camera.length && !settings?.camera) weaknesses.push("No camera/framing cue; composition will be guessed.");
  if (!intent.details.materials.length && !settings?.texture) weaknesses.push("No surface/material cue; texture will be generic.");
  if (!intent.negations.length && !tidy(settings?.negativePrompt ?? "")) weaknesses.push("No negative prompt; failures are not explicitly excluded.");
  return weaknesses;
}
