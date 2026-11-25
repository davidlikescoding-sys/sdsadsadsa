import { keywords } from "../research/text";
import { makeId } from "../storage";
import { DATASET_CONCEPTS } from "./visual-dataset";
import type {
  GeneratedImage,
  ScopedCorrection,
  VisualCategory,
  VisualConcept,
  VisualFeedbackNote,
  VisualSource,
  VisualSubject,
} from "./types";

const STAMP = "2020-01-01T00:00:00.000Z";

type Seed = {
  name: string;
  aliases?: string[];
  category: VisualCategory;
  attributes: string[];
  constraints?: string[];
  negativeConstraints?: string[];
};

/**
 * A small local seed vocabulary. Familiar subjects answer immediately; anything
 * outside it is a candidate for optional visual research. These are structured
 * appearance facts, not canned responses to prompts.
 */
export const SEED_VISUAL_CONCEPTS: Seed[] = [
  { name: "person", aliases: ["human", "people", "child", "children", "boy", "girl", "baby", "astronaut", "barista", "surgeon", "soldier", "doctor", "nurse", "captain", "rider", "cyclist"], category: "person", attributes: ["adult human figure", "head torso arms and legs", "natural hand and face anatomy", "realistic skin texture"], constraints: ["one head with two eyes", "two arms ending in hands", "two legs ending in feet", "symmetrical facial features"], negativeConstraints: ["extra heads", "extra arms", "extra legs", "missing limbs", "malformed hands", "asymmetric face"] },
  { name: "man", aliases: ["male", "gentleman"], category: "person", attributes: ["adult male face and head", "shoulders and torso", "two arms with natural hands", "two legs", "upright posture", "realistic skin texture"], constraints: ["one head with two eyes", "two arms ending in hands", "two legs ending in feet", "symmetrical facial features"], negativeConstraints: ["extra heads", "extra arms", "extra legs", "missing limbs", "malformed hands", "asymmetric face"] },
  { name: "woman", aliases: ["female", "lady"], category: "person", attributes: ["adult female face and head", "shoulders and torso", "two arms with natural hands", "two legs", "upright posture", "realistic skin texture"], constraints: ["one head with two eyes", "two arms ending in hands", "two legs ending in feet", "symmetrical facial features"], negativeConstraints: ["extra heads", "extra arms", "extra legs", "missing limbs", "malformed hands", "asymmetric face"] },
  { name: "suit", aliases: ["tuxedo", "blazer"], category: "clothing", attributes: ["tailored jacket with notched lapels", "matching suit trousers", "collared dress shirt", "necktie", "structured shoulders", "smooth wool fabric"] },
  { name: "tie", aliases: ["necktie"], category: "clothing", attributes: ["knotted necktie", "centered at the collar"] },
  { name: "dress shirt", aliases: ["shirt"], category: "clothing", attributes: ["collared button-up shirt", "visible cuffs"] },
  { name: "golden retriever", aliases: ["retriever"], category: "animal", attributes: ["golden coat", "floppy ears", "broad head", "friendly expression", "medium-large balanced build", "feathered tail"], constraints: ["four legs", "one head with two eyes", "two symmetrical ears", "tail at the rear"], negativeConstraints: ["extra legs", "missing leg", "two heads", "asymmetric ears", "wings"] },
  { name: "dog", aliases: ["puppy", "canine"], category: "animal", attributes: ["four-legged mammal", "floppy or pointed ears", "muzzle", "wagging tail"], constraints: ["four legs", "one head with two eyes", "two symmetrical ears", "tail at the rear"], negativeConstraints: ["extra legs", "missing leg", "two heads", "asymmetric ears", "wings"] },
  { name: "cat", aliases: ["kitten", "feline"], category: "animal", attributes: ["slender agile body", "pointed ears", "whiskers", "soft fur"], constraints: ["four legs", "one head with two eyes", "two symmetrical ears", "tail at the rear"], negativeConstraints: ["extra legs", "missing leg", "two heads", "asymmetric ears", "wings"] },
  { name: "horse", category: "animal", attributes: ["long legs", "streamlined body", "mane", "hooves"], constraints: ["four legs", "one head", "tail at the rear"], negativeConstraints: ["extra legs", "wings", "two heads"] },
  { name: "bird", aliases: ["sparrow", "eagle", "owl"], category: "animal", attributes: ["feathers", "two symmetrical wings", "beak", "lightweight body"], constraints: ["two wings of equal size", "one beak", "two legs", "one head"], negativeConstraints: ["one wing", "extra wings", "asymmetric wings", "missing beak", "mammal legs"] },
  { name: "forest", aliases: ["woods", "woodland"], category: "environment", attributes: ["dense trees", "layered canopy", "leaf litter", "natural trails"] },
  { name: "snowy forest", aliases: ["winter forest", "snow forest"], category: "environment", attributes: ["snow-covered conifers", "deep snow", "cool blue shadows", "diffuse winter light"] },
  { name: "mountain", category: "environment", attributes: ["rugged peaks", "steep slopes", "rock faces", "atmospheric distance"] },
  { name: "ocean", aliases: ["sea", "seascape"], category: "environment", attributes: ["rolling waves", "horizon line", "reflective water", "salt-air haze"] },
  { name: "desert", category: "environment", attributes: ["sand dunes", "dry rock", "sparse vegetation", "warm ochre tones"] },
  { name: "city", aliases: ["urban", "street"], category: "environment", attributes: ["buildings", "streets", "human scale", "layered skyline"] },
  { name: "garden", category: "environment", attributes: ["flowerbeds", "green foliage", "paths", "cultivated plants"] },
  { name: "house", aliases: ["home", "cottage"], category: "architecture", attributes: ["roof", "walls", "windows", "door", "human-scale proportions"], constraints: ["roof resting on top of walls", "door at ground level", "windows set into walls"], negativeConstraints: ["interior view", "rooms inside", "floating roof", "door in the roof", "windows floating in midair", "upside-down house"] },
  { name: "castle", category: "architecture", attributes: ["stone walls", "towers", "battlements", "heavy masonry"] },
  { name: "car", aliases: ["automobile", "vehicle"], category: "vehicle", attributes: ["four wheels", "enclosed cabin", "painted body panels", "windshield"], constraints: ["four wheels touching the ground", "windshield in front of the cabin", "two symmetrical side mirrors"], negativeConstraints: ["car interior", "dashboard", "steering wheel", "interior view", "missing wheel", "five wheels", "wheel inside the cabin", "roof where the windshield should be"] },
  { name: "bicycle", category: "vehicle", attributes: ["two wheels", "frame", "handlebars", "pedals"], constraints: ["two wheels aligned in a single line", "handlebars above the front wheel", "pedals between the wheels"], negativeConstraints: ["three wheels", "side-by-side wheels", "missing handlebars"] },
  { name: "airplane", aliases: ["plane", "jet", "aircraft", "aeroplane", "jetliner"], category: "vehicle", attributes: ["two symmetrical wings of equal span", "long cylindrical fuselage", "tail assembly at the rear", "engines mounted beneath the wings", "grey metal exterior", "landing gear below the fuselage"], constraints: ["two wings of equal size extending left and right", "pointed streamlined nose cone", "tail assembly with vertical fin and horizontal stabilizers at the rear", "engines mounted under the wings", "landing gear below the fuselage", "isolated against a clear blue sky", "full airplane exterior visible"], negativeConstraints: ["one wing larger than the other", "asymmetric wings", "flat nose", "missing tail", "engine on top of the fuselage", "missing landing gear", "car interior", "bus", "truck", "trees", "forest", "smoke", "buildings", "dashboard", "steering wheel", "small wing"] },
  { name: "aircraft guns", aliases: ["guns", "cannon", "machine gun", "autocannon"], category: "object", attributes: ["forward-firing autocannon", "underwing weapon pylons", "military aircraft armament"], constraints: ["weapons mounted under the wings or in the nose", "guns paired symmetrically on both wings"], negativeConstraints: ["guns mounted on top of the fuselage", "guns above the wings", "weapons on the roof"] },
  { name: "tree", aliases: ["birch"], category: "plant", attributes: ["trunk", "branches", "foliage", "seasonal color"] },
  { name: "flower", aliases: ["tulip", "sunflower"], category: "plant", attributes: ["petals", "stem", "leaves", "delicate color"] },
  { name: "robot", category: "object", attributes: ["mechanical joints", "metal or plastic shell", "sensors", "articulated limbs"] },
  { name: "book", category: "object", attributes: ["rectangular pages", "cover", "spine", "printed or handwritten text"] },
  { name: "chair", category: "furniture", attributes: ["seat", "backrest", "legs", "human-scale proportions"] },
  { name: "table", category: "furniture", attributes: ["flat surface", "legs", "human-scale height"] },
  { name: "jacket", aliases: ["coat"], category: "clothing", attributes: ["sleeves", "front fastening", "collar", "fabric texture"] },
  { name: "photorealistic", aliases: ["realistic", "photo", "photograph"], category: "style", attributes: ["natural proportions", "physically plausible light", "sharp focus on subject", "realistic material texture"] },
  { name: "watercolor", category: "style", attributes: ["soft pigment edges", "paper texture", "loose washes", "translucent color"] },
  { name: "oil painting", aliases: ["painterly", "canvas"], category: "style", attributes: ["visible brush strokes", "rich pigment", "layered texture", "subtle color blending"] },
  { name: "anime", category: "style", attributes: ["clean linework", "expressive eyes", "simplified shading", "vivid color blocks"] },
  { name: "cyberpunk", category: "style", attributes: ["neon lighting", "high-contrast shadows", "futuristic urban detail", "teal and magenta accents"] },
  { name: "golden hour", aliases: ["sunset light", "sunrise light"], category: "lighting", attributes: ["warm low-angle light", "long shadows", "soft highlights", "hazy atmosphere"] },
  { name: "studio lighting", aliases: ["studio"], category: "lighting", attributes: ["controlled key light", "soft fill light", "clean background", "even exposure"] },
  { name: "moonlight", category: "lighting", attributes: ["cool blue tones", "soft shadows", "high contrast", "night atmosphere"] },
  { name: "close-up", aliases: ["portrait", "closeup"], category: "camera", attributes: ["shallow depth of field", "subject fills frame", "detail emphasis"] },
  { name: "wide angle", aliases: ["landscape", "wide shot"], category: "camera", attributes: ["broad field of view", "expansive composition", "foreground-to-background depth"] },
  { name: "top down", aliases: ["overhead"], category: "camera", attributes: ["bird's-eye perspective", "flat lay arrangement", "strong graphic shapes"] },
  { name: "symmetrical", aliases: ["symmetry"], category: "composition", attributes: ["centered subject", "balanced composition", "mirrored elements"] },
  { name: "rule of thirds", category: "composition", attributes: ["off-center subject", "balanced negative space", "natural visual flow"] },
  { name: "wood", category: "material", attributes: ["visible grain", "warm tone", "matte texture"] },
  { name: "metal", category: "material", attributes: ["reflective surface", "cool highlights", "hard edges"] },
  { name: "glass", category: "material", attributes: ["transparency", "specular reflections", "thin edges"] },
  { name: "fur", category: "material", attributes: ["soft strands", "layered texture", "diffuse highlights"] },
  { name: "golden", category: "color", attributes: ["warm golden hue", "soft yellow highlights"] },
  { name: "blue", category: "color", attributes: ["cool blue hue", "calm tonal balance"] },
  { name: "red", category: "color", attributes: ["warm red hue", "strong visual emphasis"] },

  // Vehicles: each entry states what the machine is made of and where its parts
  // belong. These are model-ready spatial facts, not answers to a prompt.
  { name: "truck", aliases: ["lorry", "pickup"], category: "vehicle", attributes: ["large utility vehicle", "cargo area", "rubber tires", "side mirrors"], constraints: ["cabin at the front", "cargo bed behind the cabin", "wheels below the body touching the ground"], negativeConstraints: ["car interior", "bus", "wheels on the roof", "cargo above the cabin"] },
  { name: "bus", category: "vehicle", attributes: ["long rectangular body", "rows of side windows", "passenger door", "large windshield"], constraints: ["long body with many windows along both sides", "door on the side of the body", "wheels below the body"], negativeConstraints: ["car interior", "truck", "no windows", "two wheels only"] },
  { name: "train", aliases: ["locomotive", "railway"], category: "vehicle", attributes: ["connected carriages", "steel rails", "locomotive nose"], constraints: ["multiple carriages aligned on rails", "locomotive at the front of the train"], negativeConstraints: ["bus", "road cars", "carriages floating off the rails"] },
  { name: "helicopter", aliases: ["chopper"], category: "vehicle", attributes: ["main rotor", "tail rotor", "skids or wheels below the body"], constraints: ["large rotor blades above the fuselage", "small tail rotor at the rear", "skids or wheels below the body"], negativeConstraints: ["fixed airplane wings", "rotor on top of the tail", "car interior"] },
  { name: "ship", aliases: ["boat"], category: "vehicle", attributes: ["hull", "deck", "superstructure", "waterline"], constraints: ["hull floating on the water", "deck above the hull", "superstructure toward the rear"], negativeConstraints: ["car", "building", "ship floating in the sky", "deck below the waterline"] },
  { name: "motorcycle", aliases: ["motorbike"], category: "vehicle", attributes: ["two tires", "handlebars", "exposed engine", "rider seat"], constraints: ["two wheels aligned front to back", "handlebars above the front wheel", "seat between the wheels"], negativeConstraints: ["four wheels", "car body", "side-by-side wheels"] },
  { name: "rocket", aliases: ["spacecraft", "missile"], category: "vehicle", attributes: ["tall cylindrical body", "pointed nose", "tail fins", "engine nozzle"], constraints: ["pointed nose cone at the top", "tail fins at the bottom", "engine nozzle beneath the body"], negativeConstraints: ["airplane wings", "flat top", "wheels", "engine above the nose"] },

  // Animals: part counts and part placement are the most reliable realism lever.
  { name: "lion", category: "animal", attributes: ["tawny coat", "mane", "muscular build", "tufted tail"], constraints: ["four legs", "mane surrounding the head", "tail at the rear with a tuft"], negativeConstraints: ["wheels", "no mane", "two heads", "bird wings"] },
  { name: "elephant", category: "animal", attributes: ["thick grey skin", "long trunk", "large ears", "ivory tusks"], constraints: ["trunk attached to the face", "four thick legs", "large ears on both sides of the head"], negativeConstraints: ["trunk at the rear", "missing trunk", "two trunks", "wheels"] },
  { name: "wolf", category: "animal", attributes: ["grey fur", "pointed ears", "narrow muzzle", "bushy tail"], constraints: ["four legs", "two pointed ears", "bushy tail at the rear"], negativeConstraints: ["cat face", "wheels", "extra legs", "round floppy ears"] },
  { name: "fish", category: "animal", attributes: ["scales", "fins", "streamlined body", "gills"], constraints: ["tail fin at the rear", "paired side fins", "head at the front"], negativeConstraints: ["legs", "wheels", "tail fin at the front", "feathers"] },

  // Everyday objects: a few spatial anchors prevent melted or fused shapes.
  { name: "laptop", category: "object", attributes: ["screen", "keyboard", "hinge", "metal or plastic shell"], constraints: ["rectangular screen hinged to the keyboard", "keyboard below the screen when open"], negativeConstraints: ["closed laptop shown as a tablet", "two separate screens", "keyboard above the screen"] },
  { name: "phone", aliases: ["smartphone", "mobile phone"], category: "object", attributes: ["touchscreen", "rounded rectangle", "camera module"], constraints: ["single touchscreen on the front", "camera module on the back", "rounded rectangular body"], negativeConstraints: ["landline telephone", "multiple screens", "keypad instead of a touchscreen"] },
  { name: "guitar", category: "object", attributes: ["wooden body", "long neck", "strings", "sound hole"], constraints: ["strings stretched along the neck over the body", "headstock at the end of the neck", "sound hole in the body"], negativeConstraints: ["extra necks", "violin bow", "strings across the body diagonally"] },
  { name: "shoe", aliases: ["sneaker", "boot"], category: "object", attributes: ["sole", "upper", "toe", "heel", "laces"], constraints: ["sole beneath the upper", "toe at the front", "heel at the rear"], negativeConstraints: ["sole on top", "shoes fused together", "heel at the front"] },
  { name: "apple", category: "object", attributes: ["round fruit", "smooth skin", "stem", "leaf"], constraints: ["stem on top of the fruit", "single round fruit body"], negativeConstraints: ["square fruit", "stem at the bottom", "multiple fused fruits"] },
  { name: "pizza", category: "object", attributes: ["round base", "tomato sauce", "melted cheese", "toppings"], constraints: ["round flat base with toppings on top", "cheese covering the sauce"], negativeConstraints: ["bread loaf", "burger", "toppings underneath the base"] },

  // Architecture and scenes.
  { name: "skyscraper", aliases: ["tower block", "high rise"], category: "architecture", attributes: ["tall tower", "repeating windows", "ground floor entrance"], constraints: ["tall rectangular tower with repeating windows", "entrance at ground level"], negativeConstraints: ["interior view", "house roof", "door halfway up the tower"] },
  { name: "bridge", category: "architecture", attributes: ["spanning deck", "supports", "railings", "water or valley below"], constraints: ["deck spanning between two supports", "railings along both sides", "clear space below the deck"], negativeConstraints: ["broken deck", "floating road", "supports above the deck"] },
  { name: "beach", aliases: ["shore", "seaside"], category: "environment", attributes: ["sand", "shoreline", "ocean waves", "horizon"], constraints: ["sand meeting the water at the shoreline", "ocean behind the beach"], negativeConstraints: ["snow", "dense forest", "city street"] },
];

const LEXICON: Array<{ words: string[]; category: VisualCategory; attribute?: string }> = [
  { words: ["golden", "gold", "amber"], category: "color", attribute: "warm golden color" },
  { words: ["silver", "grey", "gray"], category: "color", attribute: "cool silver-grey tones" },
  { words: ["blue", "cyan", "teal"], category: "color", attribute: "blue color palette" },
  { words: ["red", "crimson", "scarlet"], category: "color", attribute: "red color accents" },
  { words: ["green", "emerald", "olive"], category: "color", attribute: "green color palette" },
  { words: ["black", "dark"], category: "color", attribute: "dark tonal range" },
  { words: ["white", "bright"], category: "color", attribute: "bright high-key tones" },
  { words: ["snow", "snowy", "winter", "frost", "ice"], category: "environment", attribute: "snow and winter detail" },
  { words: ["forest", "woods", "trees", "woodland"], category: "environment", attribute: "dense natural foliage" },
  { words: ["mountain", "peaks", "valley"], category: "environment", attribute: "mountainous terrain" },
  { words: ["ocean", "sea", "waves", "beach"], category: "environment", attribute: "coastal water detail" },
  { words: ["night", "midnight"], category: "lighting", attribute: "night-time lighting" },
  { words: ["sunset", "sunrise", "golden hour"], category: "lighting", attribute: "warm low-angle light" },
  { words: ["studio"], category: "lighting", attribute: "controlled studio lighting" },
  { words: ["neon", "cyberpunk"], category: "lighting", attribute: "neon accent lighting" },
  { words: ["realistic", "photorealistic", "photo"], category: "style", attribute: "photorealistic rendering" },
  { words: ["watercolor", "watercolour"], category: "style", attribute: "watercolor treatment" },
  { words: ["painting", "painterly", "oil"], category: "style", attribute: "painted texture and brushwork" },
  { words: ["anime", "cartoon"], category: "style", attribute: "stylized illustration" },
  { words: ["closeup", "close-up", "portrait"], category: "camera", attribute: "close-up framing" },
  { words: ["wide", "landscape", "panoramic"], category: "camera", attribute: "wide composition" },
  { words: ["symmetrical", "symmetry"], category: "composition", attribute: "symmetrical composition" },
  { words: ["fur", "furry", "fluffy"], category: "material", attribute: "soft fur texture" },
  { words: ["metal", "metallic", "steel"], category: "material", attribute: "metallic surface texture" },
  { words: ["glass", "glassy", "transparent"], category: "material", attribute: "transparent glass-like surface" },
  { words: ["wood", "wooden"], category: "material", attribute: "visible wood grain" },
];

const SUBJECT_STOP = new Set([
  "generate", "create", "make", "draw", "paint", "show", "render", "image", "picture", "photo",
  "photograph", "illustration", "art", "style", "of", "with", "in", "on", "at", "and", "the",
  "a", "an", "sitting", "standing", "flying", "running", "wearing", "holding", "near", "under",
  "over", "inside", "outside", "using", "like", "very", "that", "this", "into", "from", "by",
  "cool", "warm", "grey", "gray", "dark", "bright", "small", "large", "big", "old", "new",
  "long", "short", "high", "low", "fast", "slow", "modern", "vintage", "metal", "steel",
  // Camera, colour and scene modifiers are not research subjects. Treating
  // "shot" or "desk" as an unfamiliar noun made familiar object prompts do a
  // slow, unnecessary Wikimedia lookup.
  "shot", "shots", "macro", "closeup", "close", "view", "angle", "framing", "background",
  "backdrop", "lighting", "light", "lights", "focus", "bokeh", "depth", "perspective",
  "composition", "palette", "tones", "tone", "chrome", "wooden", "wood", "glass", "matte",
  "desk", "surface", "plain", "backdrop", "golden", "amber", "silver", "metal", "brass",
  "glossy", "polished", "cinematic", "detailed", "detail", "realistic", "photorealistic",
  "morning", "evening", "night", "daylight", "sunset", "sunrise", "weather", "rain", "fog",
]);

function idFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Older saved records predate the aliases field, so keep an authoritative map
// from the bundled datasets. Without it those records would stop recognising
// words such as "jetliner" or "macro" after a browser upgrade.
const SEED_ALIASES = new Map<string, string[]>(
  [...SEED_VISUAL_CONCEPTS, ...DATASET_CONCEPTS]
    .filter((seed) => seed.aliases?.length)
    .map((seed) => [idFor(seed.name), seed.aliases!]),
);

export function seedConcepts(): VisualConcept[] {
  const allSeeds: Seed[] = [...SEED_VISUAL_CONCEPTS, ...DATASET_CONCEPTS];
  return allSeeds.map((seed) => ({
    id: `seed:${idFor(seed.name)}`,
    name: seed.name,
    aliases: seed.aliases ? [...seed.aliases] : undefined,
    category: seed.category,
    attributes: [...seed.attributes],
    constraints: seed.constraints ? [...seed.constraints] : undefined,
    negativeConstraints: seed.negativeConstraints ? [...seed.negativeConstraints] : undefined,
    confidence: 0.78,
    sources: [],
    feedbackNotes: [],
    lastResearchedAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  }));
}

export function normalizeConcept(value: unknown): VisualConcept | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<VisualConcept>;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  const name = raw.name.trim().slice(0, 80);
  const attributes = Array.isArray(raw.attributes)
    ? raw.attributes.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 160)).filter(Boolean).slice(0, 24)
    : [];
  const sources: VisualSource[] = Array.isArray(raw.sources)
    ? raw.sources.flatMap((item) => {
      if (!item || typeof item.url !== "string" || !/^https:\/\//i.test(item.url)) return [];
      return [{
        url: item.url.slice(0, 800),
        pageUrl: typeof item.pageUrl === "string" ? item.pageUrl.slice(0, 800) : item.url.slice(0, 800),
        title: typeof item.title === "string" ? item.title.slice(0, 200) : "Reference",
        license: item.license ?? "Unknown",
        retrievedAt: typeof item.retrievedAt === "string" ? item.retrievedAt : STAMP,
      }];
    }).slice(0, 12)
    : [];
  const feedbackNotes: VisualFeedbackNote[] = Array.isArray(raw.feedbackNotes)
    ? raw.feedbackNotes.flatMap((item): VisualFeedbackNote[] => {
      if (!item || typeof item.note !== "string" || !item.note.trim()) return [];
      return [{
        id: typeof item.id === "string" ? item.id : makeId(),
        kind: item.kind === "preference" || item.kind === "correction" ? item.kind : "visual-fact",
        note: item.note.trim().slice(0, 240),
        subject: typeof item.subject === "string" ? item.subject.slice(0, 80) : undefined,
        imageId: typeof item.imageId === "string" ? item.imageId : undefined,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : STAMP,
      }];
    }).slice(0, 30)
    : [];
  const constraints = Array.isArray(raw.constraints)
    ? raw.constraints.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 160)).filter(Boolean).slice(0, 24)
    : [];
  const negativeConstraints = Array.isArray(raw.negativeConstraints)
    ? raw.negativeConstraints.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 160)).filter(Boolean).slice(0, 24)
    : [];
  const numericConfidence = Number(raw.confidence);
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.slice(0, 160) : `concept:${idFor(name)}`,
    name,
    aliases: Array.isArray(raw.aliases)
      ? raw.aliases.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 60)).slice(0, 12)
      : undefined,
    category: raw.category ?? "concept",
    attributes,
    constraints,
    negativeConstraints,
    confidence: Number.isFinite(numericConfidence) ? Math.max(0, Math.min(1, numericConfidence)) : 0.5,
    sources,
    feedbackNotes,
    lastResearchedAt: typeof raw.lastResearchedAt === "string" ? raw.lastResearchedAt : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : STAMP,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : STAMP,
  };
}

/**
 * One-word aliases used to fire on colour and material modifiers: "golden
 * sunset" became a retriever, "plane geometry" became an aircraft, and "ship
 * captain" became a boat hull. These local context checks stop that class of
 * cross-contamination without removing the useful subject aliases.
 */
const ALIAS_CONTEXT_BLOCKS: Record<string, RegExp> = {
  rose: /\b(rose gold|golden rose|rose[- ]?(colou?red|tinted|metal|copper))\b/i,
  plane: /\b(plane geometry|geometric plane|coordinate plane|plane surface)\b/i,
  eagle: /\b(eagle[- ]?eyed|eagle eye)\b/i,
  pine: /\b(pine wood|pine furniture|pine table|pine desk)\b/i,
  vessel: /\b(blood vessel|capillary|artery|vein)\b/i,
  oak: /\b(oak wood|oak furniture|oak table|oak desk)\b/i,
};
const ALWAYS_BLOCKED_ALIASES = new Set(["golden", "clothing"]);

function aliasAllowed(alias: string, conceptName: string, text: string): boolean {
  const lower = alias.toLowerCase().trim();
  if (!lower || ALWAYS_BLOCKED_ALIASES.has(lower)) return false;
  if (ALIAS_CONTEXT_BLOCKS[lower]?.test(text)) return false;
  if (conceptName.toLowerCase() === "ship"
    && /\b(ship captain|captain|crew|deck|on board)\b/i.test(text)
    && !/\b(boat|hull|floating|voyage|ocean liner)\b/i.test(text)) return false;
  return true;
}

/** Finds concepts actually named by the prompt; unknown subjects are returned too. */
export function identifySubjects(prompt: string, concepts: VisualConcept[], limit = 6): VisualSubject[] {
  const text = prompt.toLowerCase();
  const terms = keywords(prompt, 16);
  const found: VisualSubject[] = [];
  const seen = new Set<string>();

  for (const concept of concepts) {
    const aliases = [concept.name, ...(concept.aliases?.length ? concept.aliases : SEED_ALIASES.get(idFor(concept.name)) ?? [])];
    const matched = aliases.some((alias) => {
      if (!aliasAllowed(alias, concept.name, text)) return false;
      const escaped = alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(text);
    });
    if (!matched || seen.has(idFor(concept.name))) continue;
    seen.add(idFor(concept.name));
    found.push({ name: concept.name, category: concept.category, confidence: concept.confidence, basis: [`named in prompt`, ...concept.attributes.slice(0, 2)] });
  }

  // Unknown but visually important nouns still become research targets.
  const genericNouns = text
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !SUBJECT_STOP.has(word) && !found.some((subject) => subject.name.includes(word)));
  const frequency = new Map<string, number>();
  for (const word of genericNouns) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  for (const [word, count] of [...frequency.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (found.length >= limit) break;
    if (terms.length > 2 && !terms.includes(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    found.push({ name: word, category: "concept", confidence: 0.32 + Math.min(0.15, count * 0.04), basis: ["unfamiliar subject named in prompt"] });
  }

  return found.slice(0, limit);
}

export function extractAttributes(text: string, limit = 14): string[] {
  const lower = text.toLowerCase();
  const output: string[] = [];
  const seen = new Set<string>();
  for (const entry of LEXICON) {
    if (!entry.attribute || seen.has(entry.attribute)) continue;
    if (entry.words.some((word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(lower))) {
      seen.add(entry.attribute);
      output.push(entry.attribute);
      if (output.length >= limit) break;
    }
  }
  return output;
}

/**
 * Structural rules are different from appearance attributes: they describe how
 * parts must relate in space (two equal wings, tail at the rear, engine beneath
 * a wing). They are the strongest lever against SD 1.5's frequent structural
 * failures, so the prompt compiler injects them as positive facts AND adds the
 * matching failures to the negative prompt.
 */
export function structuralRules(concepts: VisualConcept[]): { positive: string[]; negative: string[] } {
  const positive: string[] = [];
  const negative: string[] = [];
  const seenPositive = new Set<string>();
  const seenNegative = new Set<string>();
  for (const concept of concepts) {
    for (const rule of concept.constraints ?? []) {
      const key = rule.toLowerCase();
      if (key && !seenPositive.has(key)) { seenPositive.add(key); positive.push(rule); }
    }
    for (const rule of concept.negativeConstraints ?? []) {
      const key = rule.toLowerCase();
      if (key && !seenNegative.has(key)) { seenNegative.add(key); negative.push(rule); }
    }
  }
  return { positive, negative };
}

const RESEARCHABLE_CATEGORIES = new Set<VisualCategory>([
  "person", "animal", "object", "vehicle", "architecture", "plant", "concept",
]);

export function conceptNeedsResearch(subject: VisualSubject, force: boolean, staleDays = 180): boolean {
  if (force) return true;
  // Only unknown or weakly understood *subjects* need outside evidence.
  // A named desk, wooden surface or macro framing is already covered by local
  // structured knowledge and must not add a slow network round trip.
  if (!RESEARCHABLE_CATEGORIES.has(subject.category)) return false;
  if (subject.confidence < 0.55) return true;
  return false;
}

export function mergeConcept(base: VisualConcept, extra: Partial<VisualConcept>): VisualConcept {
  const mergedAttributes = [...base.attributes];
  for (const attribute of extra.attributes ?? []) {
    if (!mergedAttributes.some((item) => item.toLowerCase() === attribute.toLowerCase())) mergedAttributes.push(attribute);
  }
  const mergedConstraints = [...(base.constraints ?? [])];
  for (const constraint of extra.constraints ?? []) {
    if (!mergedConstraints.some((item) => item.toLowerCase() === constraint.toLowerCase())) mergedConstraints.push(constraint);
  }
  const mergedNegativeConstraints = [...(base.negativeConstraints ?? [])];
  for (const constraint of extra.negativeConstraints ?? []) {
    if (!mergedNegativeConstraints.some((item) => item.toLowerCase() === constraint.toLowerCase())) mergedNegativeConstraints.push(constraint);
  }
  const mergedSources = [...base.sources];
  for (const source of extra.sources ?? []) {
    if (!mergedSources.some((item) => item.url === source.url)) mergedSources.push(source);
  }
  const mergedNotes = [...base.feedbackNotes];
  for (const note of extra.feedbackNotes ?? []) {
    if (!mergedNotes.some((item) => item.note.toLowerCase() === note.note.toLowerCase())) mergedNotes.push(note);
  }
  const evidenceBoost = Math.min(0.25, (extra.sources?.length ?? 0) * 0.06);
  return {
    ...base,
    attributes: mergedAttributes.slice(0, 32),
    constraints: mergedConstraints.slice(0, 24),
    negativeConstraints: mergedNegativeConstraints.slice(0, 24),
    sources: mergedSources.slice(0, 16),
    feedbackNotes: mergedNotes.slice(0, 40),
    confidence: Math.max(base.confidence, Math.min(1, (extra.confidence ?? base.confidence) + evidenceBoost)),
    lastResearchedAt: extra.lastResearchedAt ?? base.lastResearchedAt,
    updatedAt: new Date().toISOString(),
  };
}

export function upsertConcept(concepts: VisualConcept[], concept: VisualConcept): VisualConcept[] {
  const index = concepts.findIndex((item) => item.id === concept.id || item.name.toLowerCase() === concept.name.toLowerCase());
  if (index < 0) return [...concepts, concept];
  const next = [...concepts];
  next[index] = mergeConcept(next[index], concept);
  return next;
}

export function classifyFeedback(note: string): VisualFeedbackNote["kind"][] {
  const lower = note.toLowerCase();
  const kinds: VisualFeedbackNote["kind"][] = [];
  if (/(too |should be|instead|wrong|not |fix|make .* (bigger|smaller|brighter|darker))/i.test(lower)) kinds.push("correction");
  if (/(prefer|like|style|more|less|always|never)/i.test(lower)) kinds.push("preference");
  if (/\b(is|has|are|wears|appears|looks like)\b/i.test(lower)) kinds.push("visual-fact");
  return kinds.length ? kinds : ["visual-fact"];
}

export interface CorrectionContext {
  name?: string;
  category?: VisualCategory;
  attributes?: string[];
  constraints?: string[];
}

function correctionText(context?: CorrectionContext | string): string {
  if (!context) return "";
  if (typeof context === "string") return context.toLowerCase();
  return [context.name, context.category, ...(context.attributes ?? []), ...(context.constraints ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
}

/**
 * Recognises structural complaints ("one wing is bigger", "engine on top")
 * and turns them into a positive construction rule plus a negative failure.
 * The target subject gates every rule: a flat nose is an aircraft complaint,
 * not a tiger complaint. A complaint is never pasted verbatim into the prompt.
 */
export function deriveStructuralCorrection(
  note: string,
  context?: CorrectionContext | string,
): { positive: string; negative: string } | null {
  const lower = note.toLowerCase();
  const target = correctionText(context);
  const known = Boolean(target);
  const applies = (pattern: RegExp) => !known || pattern.test(target);

  if (/flat nose|blunt nose|truncated nose|nose[^.]{0,20}\bflat\b/.test(lower)
    && applies(/\b(airplane|plane|jet|aircraft|rocket|missile|vehicle|machine|fuselage|nose cone|aeronautic)\b|category: ?vehicle/)) {
    return {
      positive: "pointed streamlined nose cone",
      negative: "flat nose, blunt truncated nose",
    };
  }
  if (/landing gear/.test(lower) && /(barely|hard|hidden|missing|not visible|can't see|cant see|invisible)/.test(lower)
    && applies(/\b(airplane|plane|jet|aircraft|vehicle|machine|fuselage)\b|category: ?vehicle/)) {
    return {
      positive: "extended landing gear clearly visible beneath the fuselage",
      negative: "missing landing gear, hidden landing gear",
    };
  }
  if (/shadows?/.test(lower) && /(wrong|weird|harsh|bad|incorrect|dark)/.test(lower)) {
    return {
      positive: "consistent soft natural shadows",
      negative: "harsh inconsistent shadows, wrong lighting",
    };
  }
  if (/(bus|truck|car|tree|forest|smoke|building)/.test(lower) && /(background|backround|behind|dense|weird)/.test(lower)
    && applies(/\b(outdoor|sky|airplane|plane|jet|vehicle|bird|environment|forest|mountain|beach|field|garden)\b|category: ?(vehicle|environment|plant)/)) {
    return {
      positive: "clean empty sky background with no other objects",
      negative: "bus, truck, car, trees, forest, smoke, buildings in the background",
    };
  }
  // "I asked for a plane, not the interior of a car" names the wrong subject
  // class rather than a small detail, but only for vehicle/architecture targets.
  if (/\bnot\b|\binstead\b|\bwrong\b|\binterior\b/.test(lower)
    && applies(/\b(vehicle|airplane|plane|jet|car|architecture|building|house|room)\b|category: ?(vehicle|architecture)/)) {
    if (/car interior|vehicle interior|interior of (a |the )?(car|vehicle|plane|jet|aircraft)|inside (a |the )?(car|vehicle)|dashboard|steering wheel/.test(lower)) {
      return {
        positive: "full exterior view of the requested subject",
        negative: "car interior, dashboard, steering wheel, cockpit interior, inside a vehicle",
      };
    }
    if (/interior|inside a (house|building|room)/.test(lower)) {
      return {
        positive: "full exterior view of the requested subject",
        negative: "interior view, rooms inside, cutaway view",
      };
    }
  }
  if (/\bwing/.test(lower) && /(small|big|large|short|unequal|asymmetric|different|one side|only one)/.test(lower)
    && applies(/\b(wing|bird|airplane|aircraft|jet|bat|insect)\b/)) {
    return {
      positive: "two symmetrical wings of equal size",
      negative: "one wing larger than the other, asymmetric wings",
    };
  }
  if (/\b(engine|motor)/.test(lower) && /(top|above|roof|over|upper|back)/.test(lower)
    && applies(/\b(engine|motor|vehicle|airplane|aircraft|jet|machine)\b|category: ?vehicle/)) {
    return {
      positive: "engines mounted beneath the wings",
      negative: "engine on top of the fuselage, engine above the wing",
    };
  }
  const partMistake = /\b(wheel|leg|arm|eye|head|wing)/.test(lower)
    && /(extra|third|three|second|two|four|instead|wrong|duplicated)/.test(lower);
  if (partMistake && applies(/\b(wheel|leg|arm|eye|head|wing|person|animal|human|dog|cat|bird|vehicle|machine)\b|category: ?(person|animal|vehicle)/)) {
    if (applies(/\b(person|human|child|boy|girl|baby|face|arm|finger|hand)\b|category: ?person/)) {
      return {
        positive: "correct human anatomy with two arms and two legs",
        negative: "extra limbs, extra fingers, missing limbs, duplicated body parts",
      };
    }
    if (applies(/\b(bird|eagle|owl|wing|feather)\b/)) {
      return {
        positive: "two symmetrical wings and two legs",
        negative: "extra wings, one wing, mammal legs, duplicated body parts",
      };
    }
    if (applies(/\b(animal|dog|cat|horse|lion|tiger|four legs|fur)\b|category: ?animal/)) {
      return {
        positive: "four legs with natural animal anatomy",
        negative: "wheels, extra legs, missing leg, duplicated body parts",
      };
    }
    return {
      positive: "correct mechanical part count",
      negative: "extra wheels, duplicated parts, floating components",
    };
  }
  if (/\b(face|head|eye)/.test(lower) && /(weird|deformed|wrong|distorted|ugly)/.test(lower)
    && applies(/\b(person|human|face|head|eye|portrait|skin)\b|category: ?person/)) {
    return {
      positive: "natural human facial anatomy",
      negative: "disfigured face, asymmetric face, deformed features",
    };
  }
  return null;
}

/** Converts a complaint such as "ears too small" into a useful prompt phrase. */
export function deriveCorrection(note: string, subject?: string): string {
  const structural = deriveStructuralCorrection(note, subject ? { name: subject } : undefined);
  if (structural) return structural.positive;
  const lower = note.toLowerCase();
  const match = lower.match(/too (small|large|big|short|long|dark|light|narrow|wide|flat|bright|dull)/);
  if (match) {
    const opposites: Record<string, string> = {
      small: "proportionally larger", large: "proportionally smaller", big: "proportionally smaller",
      short: "slightly longer", long: "slightly shorter", dark: "lighter", light: "darker",
      narrow: "wider", wide: "narrower", flat: "more dimensional",
      bright: "softer", dull: "more vivid",
    };
    const part = lower.match(/\b(ears?|eyes?|fur|tail|nose|head|body|wings?|legs?|mouth|background|lighting|shadow|color)\b/)?.[1];
    return part
      ? `${opposites[match[1]] ?? "more balanced"} ${part}${subject ? ` on the ${subject}` : ""}`
      : `balanced natural proportions${subject ? ` for the ${subject}` : ""}`;
  }
  return "balanced natural proportions for the requested subject";
}

/**
 * Mines the local gallery of captioned generations for durable visual rules.
 * A correction becomes a reusable constraint only when it has actually been
 * reported (recurring corrections get the strongest wording). Nothing is
 * retrained: this only edits structured knowledge used by the prompt compiler.
 */
export function learnFromGallery(
  history: GeneratedImage[],
  concepts: VisualConcept[],
): { concepts: VisualConcept[]; added: number; subjects: string[] } {
  const grouped = new Map<string, { subject: string; notes: string[]; count: number }>();
  for (const image of history) {
    const subjects = image.researchSummary?.subjects ?? [];
    for (const feedback of image.feedback ?? []) {
      if (!feedback.kinds.includes("correction") || !feedback.correction.trim()) continue;
      const subject = subjects.find((name) => concepts.some((concept) => concept.name.toLowerCase() === name.toLowerCase())) ?? subjects[0];
      if (!subject) continue;
      const key = `${subject.toLowerCase()}|${feedback.correction.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 80)}`;
      const entry = grouped.get(key) ?? { subject, notes: [], count: 0 };
      entry.notes.push(feedback.correction);
      entry.count += 1;
      grouped.set(key, entry);
    }
  }

  let added = 0;
  const touched = new Set<string>();
  let next = concepts;
  for (const entry of grouped.values()) {
    const note = entry.notes[entry.notes.length - 1];
    const candidates = next.filter((concept) => entry.subject.toLowerCase().includes(concept.name.toLowerCase()));
    for (const target of candidates) {
      // Gate the complaint against each subject's own vocabulary before adding
      // a durable rule; one image can contain several unrelated subjects.
      const structural = deriveStructuralCorrection(note, target);
      if (!structural) continue;
      if ((target.constraints ?? []).some((rule) => rule.toLowerCase() === structural.positive.toLowerCase())) continue;
      const patch: Partial<VisualConcept> = {
        constraints: [...(target.constraints ?? []), structural.positive],
        negativeConstraints: [...(target.negativeConstraints ?? []), ...structural.negative.split(",").map((item) => item.trim()).filter(Boolean)],
        feedbackNotes: [{
          id: `gallery:${makeId()}`,
          kind: "visual-fact" as const,
          note: `${entry.count} gallery correction${entry.count === 1 ? "" : "s"}: ${structural.positive}`,
          subject: target.name,
          createdAt: new Date().toISOString(),
        }],
        confidence: Math.min(1, target.confidence + (entry.count > 1 ? 0.06 : 0.02)),
      };
      next = upsertConcept(next, { ...target, ...patch });
      touched.add(target.name);
      added += 1;
    }
  }
  return { concepts: next, added, subjects: [...touched] };
}

export function recurringMistakes(history: GeneratedImage[]): ScopedCorrection[] {
  const counts = new Map<string, ScopedCorrection & { count: number }>();
  for (const image of history) {
    const subjects = image.researchSummary?.subjects ?? [];
    for (const feedback of image.feedback ?? []) {
      if (!feedback.kinds.includes("correction") || !feedback.correction.trim()) continue;
      const note = feedback.correction.trim().slice(0, 240);
      const key = note.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!key) continue;
      const candidates = subjects.length ? subjects : [undefined];
      for (const subject of candidates) {
        const scopedKey = `${subject?.toLowerCase() ?? ""}|${key}`;
        const entry = counts.get(scopedKey) ?? { note, subject, kind: "correction" as const, count: 0 };
        entry.count += 1;
        counts.set(scopedKey, entry);
      }
    }
  }
  return [...counts.values()]
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}
