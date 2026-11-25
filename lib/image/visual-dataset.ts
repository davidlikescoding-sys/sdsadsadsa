/**
 * Bundled visual knowledge dataset.
 *
 * These are structured appearance facts used by the local prompt compiler,
 * not canned answers or copied images. Each concept states what a subject is
 * made of, where its parts belong, and which failures to exclude. The packs
 * are served by /api/image/datasets so the Image workspace can load, inspect
 * and extend them without contacting any external AI service.
 */
import type { VisualCategory } from "./types";

export interface DatasetConcept {
  name: string;
  aliases?: string[];
  category: VisualCategory;
  attributes: string[];
  constraints?: string[];
  negativeConstraints?: string[];
}

export interface VisualDatasetPack {
  id: string;
  name: string;
  description: string;
  source: string;
  license: string;
  concepts: DatasetConcept[];
}

export const VISUAL_DATASET_PACKS: VisualDatasetPack[] = [
  {
    id: "creatures",
    name: "Animals & anatomy",
    description: "Part counts, limb placement and coat facts for common animals. The strongest defence against fused or duplicated anatomy.",
    source: "DavidAI curated visual knowledge",
    license: "Local dataset · no external media",
    concepts: [
      { name: "bear", aliases: ["grizzly", "brown bear"], category: "animal", attributes: ["large heavy mammal", "thick fur", "broad shoulders", "short tail", "rounded ears"], constraints: ["four legs beneath the body", "small rounded ears on top of the head", "one head with a broad muzzle"], negativeConstraints: ["wheels", "long thin tail", "pointed cat ears", "extra heads"] },
      { name: "panda", aliases: ["giant panda"], category: "animal", attributes: ["black and white coat", "black eye patches", "round ears", "stocky build"], constraints: ["four black legs", "black patches around both eyes", "black ears on top of the head"], negativeConstraints: ["solid black coat", "missing eye patches", "wheels", "long snout"] },
      { name: "tiger", category: "animal", attributes: ["orange coat with dark stripes", "white chest", "muscular build", "long tail"], constraints: ["four legs", "stripes running across the body", "tail at the rear"], negativeConstraints: ["spots instead of stripes", "wheels", "mane", "two heads"] },
      { name: "giraffe", category: "animal", attributes: ["very long neck", "yellow coat with brown patches", "small horns", "long legs"], constraints: ["long neck rising from the shoulders to a small head", "four long legs", "short tail at the rear"], negativeConstraints: ["short neck", "horse body", "wheels", "two heads"] },
      { name: "zebra", category: "animal", attributes: ["black and white stripes", "horse-like build", "upright mane", "long tail"], constraints: ["stripes covering the whole body", "four legs", "mane along the top of the neck"], negativeConstraints: ["solid colours", "wheels", "spotted coat", "two heads"] },
      { name: "deer", aliases: ["stag", "doe"], category: "animal", attributes: ["slender legs", "brown coat", "white tail underside", "large ears"], constraints: ["four long legs", "large ears on both sides of the head", "tail at the rear"], negativeConstraints: ["wheels", "lion mane", "two heads", "missing legs"] },
      { name: "rabbit", aliases: ["bunny", "hare"], category: "animal", attributes: ["soft fur", "long upright ears", "compact body", "short fluffy tail"], constraints: ["two long ears rising from the head", "four legs", "short tail at the rear"], negativeConstraints: ["long cat tail", "wheels", "drooping ears", "extra heads"] },
      { name: "fox", aliases: ["red fox"], category: "animal", attributes: ["reddish coat", "pointed muzzle", "triangular ears", "bushy tail with white tip"], constraints: ["four legs", "two pointed ears", "large bushy tail at the rear"], negativeConstraints: ["dog body with a short tail", "wheels", "round floppy ears", "two heads"] },
      { name: "owl", category: "animal", attributes: ["large forward-facing eyes", "facial disc", "hooked beak", "mottled feathers"], constraints: ["two symmetrical wings", "two large eyes side by side on the front of the head", "two legs below the body"], negativeConstraints: ["mammal ears", "one eye", "extra wings", "mammal legs"] },
      { name: "penguin", category: "animal", attributes: ["black back and white belly", "flipper-like wings", "upright stance", "orange beak and feet"], constraints: ["two flippers at the sides", "two feet below the body", "white front with a dark back"], negativeConstraints: ["flying bird wings", "four legs", "wheels", "two heads"] },
      { name: "dolphin", category: "animal", attributes: ["streamlined grey body", "curved dorsal fin", "pointed beak", "smooth skin"], constraints: ["dorsal fin on top of the body", "tail fluke at the rear", "flippers on both sides"], negativeConstraints: ["legs", "fish scales", "fin on the belly", "wheels"] },
      { name: "whale", category: "animal", attributes: ["very large streamlined body", "horizontal tail fluke", "small flippers", "water spray"], constraints: ["horizontal tail fluke at the rear", "flippers on both sides", "blowhole on top of the head"], negativeConstraints: ["vertical fish tail", "legs", "shark fins", "wheels"] },
      { name: "shark", category: "animal", attributes: ["grey cartilaginous body", "triangular dorsal fin", "pointed snout", "rows of teeth"], constraints: ["upright dorsal fin on top", "vertical tail fin at the rear", "side fins on both sides"], negativeConstraints: ["horizontal whale fluke", "legs", "wheels", "blunt round nose"] },
      { name: "turtle", aliases: ["tortoise"], category: "animal", attributes: ["hard shell", "four short legs", "beaked head", "patterned scutes"], constraints: ["domed shell on the back", "head at the front", "four legs below the shell"], negativeConstraints: ["shell on the belly", "no shell", "wheels", "two heads"] },
      { name: "butterfly", category: "animal", attributes: ["two pairs of patterned wings", "thin antennae", "slender body"], constraints: ["four wings in matched pairs", "symmetrical wing patterns", "two antennae on the head"], negativeConstraints: ["bird feathers", "three wings", "asymmetric wing patterns", "mammal legs"] },
      { name: "snake", category: "animal", attributes: ["long limbless body", "scales", "forked tongue", "coiled posture"], constraints: ["single continuous body tapering to a tail", "head at one end", "no limbs"], negativeConstraints: ["legs", "wings", "two heads", "segments like an earthworm"] },
    ],
  },
  {
    id: "machines",
    name: "Machines & objects",
    description: "Spatial facts for vehicles, instruments and everyday objects. Prevents interiors replacing exteriors and parts landing on the wrong side.",
    source: "DavidAI curated visual knowledge",
    license: "Local dataset · no external media",
    concepts: [
      { name: "ambulance", category: "vehicle", attributes: ["white van body", "red stripe", "emergency light bar", "rear patient doors"], constraints: ["light bar on the roof", "red stripe along the sides", "wheels below the body", "patient doors at the rear"], negativeConstraints: ["car interior", "fire engine ladder", "lights under the wheels", "bus windows along both sides"] },
      { name: "fire truck", aliases: ["fire engine"], category: "vehicle", attributes: ["red cab", "extendable ladder", "large wheels", "emergency lights"], constraints: ["ladder mounted on top of the truck", "cab at the front", "wheels below the body"], negativeConstraints: ["ambulance stripe", "ladder inside the cab", "car interior", "wheels on the roof"] },
      { name: "taxi", category: "vehicle", attributes: ["roof sign", "checkered stripe", "four-door body", "yellow paint"], constraints: ["roof sign on top", "four wheels touching the ground", "windows along the sides"], negativeConstraints: ["bus body", "car interior view", "sign inside the cabin", "two wheels"] },
      { name: "tractor", category: "vehicle", attributes: ["large rear wheels", "small front wheels", "open driver cab", "metal frame"], constraints: ["rear wheels larger than front wheels", "driver seat above the frame", "wheels below the body"], negativeConstraints: ["four equal wheels", "enclosed car cabin", "wheels on the roof", "car interior"] },
      { name: "tank", category: "vehicle", attributes: ["armoured hull", "rotating turret", "continuous tracks", "long cannon barrel"], constraints: ["turret centred on top of the hull", "tracks along both sides", "cannon barrel pointing forward from the turret"], negativeConstraints: ["rubber car wheels", "turret at the rear", "airplane wings", "car interior"] },
      { name: "submarine", category: "vehicle", attributes: ["elongated hull", "conning tower", "periscope", "portholes"], constraints: ["tower on top of the hull", "periscope above the tower", "propeller at the rear"], negativeConstraints: ["airplane wings", "wheels", "deck like a surface ship", "floating in the sky"] },
      { name: "sailboat", aliases: ["yacht"], category: "vehicle", attributes: ["tall mast", "white sails", "narrow hull", "water wake"], constraints: ["sails attached to the mast", "hull floating on the water", "mast rising from the deck"], negativeConstraints: ["motorway", "mast lying flat", "hull on land", "car wheels"] },
      { name: "hot air balloon", category: "vehicle", attributes: ["large fabric envelope", "wicker basket", "suspension ropes", "burner"], constraints: ["basket hanging directly below the envelope", "ropes connecting basket to envelope", "envelope above the basket"], negativeConstraints: ["basket above the envelope", "airplane wings", "wheels", "rocket fins"] },
      { name: "camera", category: "object", attributes: ["rectangular body", "lens barrel", "viewfinder", "control dials"], constraints: ["lens protruding from the front centre", "viewfinder on the top rear", "strap lugs on both sides"], negativeConstraints: ["lens on the side", "phone touchscreen", "two lenses facing opposite ways", "lens inside the body"] },
      { name: "watch", aliases: ["wristwatch"], category: "object", attributes: ["round or square face", "hands", "strap", "metal case"], constraints: ["dial face on the front", "strap attached at top and bottom", "hands centred on the dial"], negativeConstraints: ["strap fused to the dial", "two faces", "clock tower", "hands outside the dial"] },
      { name: "lamp", aliases: ["table lamp", "floor lamp"], category: "object", attributes: ["shade", "stem", "stable base", "warm glow"], constraints: ["shade on top of the stem", "stem rising from the base", "base resting on the surface"], negativeConstraints: ["shade below the base", "floating stem", "sun instead of a lamp", "two shades"] },
      { name: "umbrella", category: "object", attributes: ["canopy", "central shaft", "hooked handle", "ribbed segments"], constraints: ["canopy above the shaft", "handle at the bottom", "ribs radiating from the centre"], negativeConstraints: ["handle above the canopy", "flat disc", "two shafts", "canopy below the handle"] },
      { name: "backpack", category: "object", attributes: ["main compartment", "two shoulder straps", "top handle", "front pocket"], constraints: ["two straps on the back", "front pocket on the front", "handle on top"], negativeConstraints: ["straps on the front", "suitcase wheels", "straps fused together", "two main compartments"] },
      { name: "violin", category: "object", attributes: ["wooden hollow body", "four strings", "long neck", "f-holes", "bow"], constraints: ["strings stretched along the neck over the body", "f-holes on both sides of the strings", "chin rest at the lower end"], negativeConstraints: ["guitar frets", "extra necks", "bow resting across the bridge", "violin bow as part of the instrument"] },
      { name: "piano", category: "object", attributes: ["black polished case", "white and black keys", "three legs", "music stand"], constraints: ["keys across the front of the case", "music stand above the keys", "three legs below the case"], negativeConstraints: ["keys on the side", "two music stands", "keyboard below the legs", "guitar strings"] },
      { name: "microphone", category: "object", attributes: ["mesh grille", "cylindrical body", "stand", "short cable"], constraints: ["grille at the top of the body", "body mounted on the stand", "cable leaving the lower end"], negativeConstraints: ["grille at the bottom", "phone handset", "stand above the microphone", "two grilles"] },
      { name: "telescope", category: "object", attributes: ["long tube", "objective lens", "eyepiece", "tripod"], constraints: ["large objective lens at the front", "eyepiece at the rear", "tube mounted on the tripod"], negativeConstraints: ["eyepiece at the front", "microscope shape", "tube floating above the tripod", "two objective lenses"] },
      { name: "sword", category: "object", attributes: ["straight metal blade", "crossguard", "grip", "pommel"], constraints: ["blade above the crossguard", "grip below the crossguard", "pommel at the end of the grip"], negativeConstraints: ["blade below the handle", "two crossguards", "saw blade", "blade fused to the grip"] },
    ],
  },
  {
    id: "world",
    name: "World & architecture",
    description: "Scene-level structure for landscapes, weather and buildings. Keeps horizons level and interiors from replacing exteriors.",
    source: "DavidAI curated visual knowledge",
    license: "Local dataset · no external media",
    concepts: [
      { name: "waterfall", category: "environment", attributes: ["falling water", "rock cliff", "mist at the base", "pool below"], constraints: ["water falling from a cliff into a pool", "mist rising from the impact point", "cliff behind the falling water"], negativeConstraints: ["water flowing upward", "floating river", "flat ground instead of a cliff", "city street"] },
      { name: "volcano", category: "environment", attributes: ["conical mountain", "glowing crater", "lava flow", "ash plume"], constraints: ["crater at the summit", "lava flowing down the slopes", "ash plume above the crater"], negativeConstraints: ["crater at the base", "snow-capped peak", "lava flowing upward", "flat terrain"] },
      { name: "canyon", category: "environment", attributes: ["steep rock walls", "narrow valley", "layered strata", "river at the bottom"], constraints: ["rock walls rising on both sides", "valley floor below the walls", "horizontal sediment layers"], negativeConstraints: ["flat plain", "walls leaning inward to touch", "ocean horizon", "forest canopy"] },
      { name: "island", category: "environment", attributes: ["land surrounded by water", "sandy or rocky shore", "palm or low vegetation", "clear horizon"], constraints: ["water encircling the land", "shoreline where land meets water", "vegetation on the land only"], negativeConstraints: ["land merging into a continent", "water on top of the land", "snow field", "city blocks"] },
      { name: "lake", category: "environment", attributes: ["still water", "shoreline", "reflections", "distant hills"], constraints: ["water enclosed by land", "calm reflective surface", "shoreline around the water"], negativeConstraints: ["ocean waves", "river current", "water floating in the sky", "dense forest covering the water"] },
      { name: "meadow", aliases: ["field of flowers"], category: "environment", attributes: ["open grass", "wildflowers", "gentle hills", "warm daylight"], constraints: ["grass covering the ground", "flowers growing from the grass", "open sky above"], negativeConstraints: ["dense forest", "city pavement", "snow", "indoor floor"] },
      { name: "cave", category: "environment", attributes: ["rock opening", "stalactites", "stalagmites", "dark interior"], constraints: ["stalactites hanging from the ceiling", "stalagmites rising from the floor", "opening in the rock face"], negativeConstraints: ["stalactites on the floor", "open sky ceiling", "house rooms", "floating rocks"] },
      { name: "waterfall cave", category: "environment", attributes: ["cave mouth", "thin falling water", "wet rock", "soft spray"], constraints: ["water falling across the cave entrance", "rock wall behind the water", "spray at the base"], negativeConstraints: ["water inside the rock", "open field", "city street", "water flowing upward"] },
      { name: "kitchen", category: "environment", attributes: ["countertops", "cabinets", "sink", "cooking utensils"], constraints: ["cabinets below and above the counter", "sink set into the counter", "utensils resting on the counter"], negativeConstraints: ["cabinets on the ceiling", "bed instead of a counter", "sink floating in midair", "outdoor street"] },
      { name: "library", category: "environment", attributes: ["tall bookshelves", "rows of books", "reading tables", "warm lamps"], constraints: ["books standing upright on shelves", "shelves against the walls", "tables in the open floor space"], negativeConstraints: ["books floating in the air", "shelves on the floor only", "bedroom furniture", "outdoor garden"] },
      { name: "stadium", category: "architecture", attributes: ["oval stand", "central pitch", "floodlights", "tiered seating"], constraints: ["seating ringing the central field", "floodlight towers above the stands", "field level at the centre"], negativeConstraints: ["seating on the field", "floodlights at ground level", "roof on the pitch", "house exterior"] },
      { name: "lighthouse", category: "architecture", attributes: ["tall white tower", "red bands", "lantern room", "rocky coast"], constraints: ["lantern room at the top of the tower", "tower rising from the shore", "light shining out to sea"], negativeConstraints: ["lantern at the base", "tower floating in the water", "skyscraper windows", "interior rooms shown"] },
    ],
  },
  {
    id: "cinema",
    name: "Cinematography & style",
    description: "Camera, lighting, composition and finishing vocabulary that SD 1.5 responds to reliably. Attributes are injected for named terms only.",
    source: "DavidAI curated visual knowledge",
    license: "Local dataset · no external media",
    concepts: [
      { name: "black and white", aliases: ["monochrome", "bw"], category: "style", attributes: ["monochrome palette", "tonal contrast", "no colour cast"] },
      { name: "sepia", category: "style", attributes: ["warm brown tonal palette", "aged photographic look", "soft contrast"] },
      { name: "film noir", category: "style", attributes: ["high contrast black and white", "hard directional light", "deep shadows", "moody urban atmosphere"] },
      { name: "macro", aliases: ["macro photography"], category: "camera", attributes: ["extreme close framing", "shallow depth of field", "fine surface detail"] },
      { name: "telephoto", category: "camera", attributes: ["compressed perspective", "shallow depth of field", "distant subject fills the frame"] },
      { name: "fisheye", category: "camera", attributes: ["very wide curved perspective", "barrel distortion", "expansive foreground"] },
      { name: "aerial view", aliases: ["drone shot", "bird's eye view"], category: "camera", attributes: ["high overhead perspective", "visible ground pattern", "clear horizon or no horizon"] },
      { name: "low angle", category: "camera", attributes: ["camera below the subject", "towering perspective", "subject against the sky"] },
      { name: "backlighting", category: "lighting", attributes: ["light behind the subject", "rim glow on edges", "silhouette tendency"] },
      { name: "rim lighting", category: "lighting", attributes: ["bright edge highlight", "dark front planes", "strong subject separation"] },
      { name: "volumetric light", category: "lighting", attributes: ["visible light shafts", "soft atmospheric haze", "directional beams"] },
      { name: "silhouette", category: "lighting", attributes: ["dark subject shape", "bright simple background", "clear outline"] },
      { name: "bokeh", category: "camera", attributes: ["smooth blurred background", "soft circular highlights", "sharp subject"] },
      { name: "long exposure", category: "camera", attributes: ["smooth motion trails", "silky water", "static sharp elements"] },
      { name: "minimalism", category: "composition", attributes: ["few elements", "large negative space", "clean composition"] },
      { name: "leading lines", category: "composition", attributes: ["converging lines", "eye guided toward the subject", "strong perspective"] },
      { name: "depth of field", category: "composition", attributes: ["sharp focal plane", "soft foreground and background", "subject separation"] },
      { name: "leather", category: "material", attributes: ["fine grain", "soft creases", "matte sheen"] },
      { name: "marble", category: "material", attributes: ["veined surface", "polished finish", "cool hard texture"] },
      { name: "brick", category: "material", attributes: ["repeating rectangular units", "mortar lines", "rough matte surface"] },
      { name: "chrome", category: "material", attributes: ["mirror-like metal", "sharp reflections", "cool highlights"] },
      { name: "purple", category: "color", attributes: ["violet hue", "rich cool accent"] },
      { name: "orange", category: "color", attributes: ["warm orange hue", "vivid highlight"] },
      { name: "teal", category: "color", attributes: ["cool blue-green hue", "cinematic accent"] },
      { name: "brown", category: "color", attributes: ["earthy brown hue", "warm neutral tone"] },
    ],
  },
];

export const DATASET_CONCEPTS: DatasetConcept[] = VISUAL_DATASET_PACKS.flatMap((pack) => pack.concepts);

export function visualDatasetStats(): { packs: number; concepts: number; positiveRules: number; negativeRules: number; attributes: number } {
  return {
    packs: VISUAL_DATASET_PACKS.length,
    concepts: DATASET_CONCEPTS.length,
    positiveRules: DATASET_CONCEPTS.reduce((total, concept) => total + (concept.constraints?.length ?? 0), 0),
    negativeRules: DATASET_CONCEPTS.reduce((total, concept) => total + (concept.negativeConstraints?.length ?? 0), 0),
    attributes: DATASET_CONCEPTS.reduce((total, concept) => total + concept.attributes.length, 0),
  };
}
