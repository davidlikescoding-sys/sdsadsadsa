/**
 * Local, deterministic anatomy contracts.
 *
 * Subject detection by exact concept alias is useful but too narrow: "child",
 * "astronaut", "ship captain" and "hands of a surgeon" all need human anatomy
 * rules even when none of those words is stored as an alias. Conversely a clock
 * with hands, a "golden sunset" or "plane geometry" must not borrow rules from
 * a person, dog or aircraft. This module keeps those decisions explicit so the
 * prompt compiler and model router can share the same truth.
 */
import type { VisualSubject } from "./types";

export interface AnatomyProfile {
  person: boolean;
  animal: boolean;
  quadruped: boolean;
  bird: boolean;
  fish: boolean;
  legless: boolean;
  vehicle: boolean;
  handAnatomy: boolean;
  positive: string[];
  negative: string[];
}

const PERSON = /\b(person|people|human|man|men|woman|women|child|children|boy|girl|baby|infant|toddler|astronaut|barista|surgeon|soldier|doctor|nurse|chef|cook|pilot|driver|rider|runner|cyclist|skater|traveler|traveller|passenger|captain)\b/i;
const FACE = /\b(face|portrait|headshot|selfie)\b/i;
// Hyphenated compounds such as "hand-carved", "hand-made" and "long-legged"
// describe an object, not visible human hands. Word boundaries alone still
// match "hand" before a hyphen, so those compounds must be excluded explicitly.
const HANDS = /(?<!-)\b(hands?|fingers?|arms?|legs?)\b(?!-)/i;
const WATCH_HANDS = /\b(clock|watch|dial|sundial|compass|gauge|instrument|gear|mechanism)\b/i;
const ANIMAL = /\b(animal|pet|dog|puppy|canine|cat|kitten|feline|horse|lion|tiger|wolf|elephant|bear|fox|rabbit|deer|cow|sheep|goat|snake|lizard|bird|eagle|owl|sparrow|parrot|penguin|fish|shark|whale|axolotl|creature)\b/i;
const BIRD = /\b(bird|eagle|owl|sparrow|parrot|penguin|raven|crow|hawk|flamingo)\b/i;
const FISH = /\b(fish|shark|salmon|trout|goldfish|eel|whale|dolphin)\b/i;
const LEGLESS = /\b(snake|lizard|worm|slug|eel)\b/i;
const VEHICLE = /\b(car|automobile|truck|bus|train|bicycle|bike|motorcycle|airplane|plane|jet|aircraft|helicopter|ship|boat|vessel|rocket|spacecraft|vehicle|machine|drone)\b/i;
const PLANE_GEOMETRY = /\b(plane geometry|geometric plane|coordinate plane|plane surface|planes of)\b/i;
const SHIP_PERSON = /\b(ship captain|ship crew|captain|crew|on board)\b/i;
const SHIP_CONTEXT = /\b(boat|hull|floating|voyage|ocean liner|shipyard|harbor|harbour)\b/i;
const ANIMAL_FIGURE_OF_SPEECH = /\b(eagle[- ]?eyed|eagle eye|lion[- ]?hearted|tiger stripe pattern)\b/i;

function categories(subjects: VisualSubject[]): Set<string> {
  return new Set(subjects.map((subject) => subject.category));
}

/** Returns only anatomy rules that are warranted by this exact request. */
export function detectAnatomy(prompt: string, subjects: VisualSubject[] = []): AnatomyProfile {
  const text = ` ${prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, " ")} `;
  const has = (pattern: RegExp) => pattern.test(text);
  const cats = categories(subjects);

  const deviceContext = WATCH_HANDS.test(text);
  const handAnatomy = has(HANDS) && !deviceContext;
  const person = cats.has("person") || has(PERSON) || handAnatomy || (has(FACE) && !deviceContext);
  const bird = cats.has("animal") && has(BIRD) && !ANIMAL_FIGURE_OF_SPEECH.test(text);
  const fish = has(FISH);
  const legless = has(LEGLESS);
  const animal = (cats.has("animal") || has(ANIMAL)) && !ANIMAL_FIGURE_OF_SPEECH.test(text);
  const quadruped = animal && !bird && !fish && !legless;
  const shipOnlyPerson = SHIP_PERSON.test(text) && !SHIP_CONTEXT.test(text);
  const vehicle = (cats.has("vehicle") || (has(VEHICLE) && !PLANE_GEOMETRY.test(text))) && !shipOnlyPerson;

  const positive: string[] = [];
  const negative: string[] = [];

  if (person) {
    positive.push(
      "one head with two aligned eyes",
      "two arms ending in natural hands",
      "five separate fingers on each hand",
      "natural finger joints and facial proportions",
    );
    negative.push(
      "deformed anatomy",
      "malformed hands",
      "fused fingers",
      "missing fingers",
      "extra fingers",
      "extra limbs",
      "extra eyes",
      "disfigured face",
      "asymmetric face",
      "bad facial proportions",
    );
  }

  if (animal) {
    positive.push("natural animal anatomy", "correct limb placement", "one head and one tail");
    if (quadruped) positive.push("four legs beneath the body", "two symmetrical ears", "tail at the rear");
    if (bird) positive.push("two symmetrical wings", "one beak", "two legs");
    if (fish) positive.push("tail fin at the rear", "paired side fins");
    if (legless) positive.push("smooth legless body", "tapered tail");
    negative.push("extra heads", "extra tails", "fused limbs", "wrong leg count");
    if (quadruped) negative.push("extra legs", "wings on a mammal", "missing leg");
    if (bird) negative.push("one wing larger than the other", "missing beak", "mammal legs");
    if (fish) negative.push("legs on a fish", "feathers", "wheels");
    if (legless) negative.push("legs on a snake", "wheels");
  }

  if (vehicle) {
    positive.push("physically plausible engineering", "parts attached in correct positions");
    negative.push("impossible fused parts", "floating components", "detached components");
  }

  return {
    person,
    animal,
    quadruped,
    bird,
    fish,
    legless,
    vehicle,
    handAnatomy,
    positive: [...new Set(positive)],
    negative: [...new Set(negative)],
  };
}

/** True when the request names a real scene that must not be replaced by a clean backdrop. */
export function hasExplicitScene(prompt: string): boolean {
  return /\b(busy|crowded|market|station|street|room|interior|office|classroom|kitchen|forest|woods|woodland|jungle|mountain|valley|ocean|sea|beach|city|urban|hangar|warehouse|garden|runway|desert|lake|canyon|deck|field|park|hangar)\b/i.test(prompt);
}

/** True when the request explicitly asks for a plain or seamless backdrop. */
export function hasCleanBackdropRequest(prompt: string): boolean {
  return /\b(clean|plain|minimal|uncluttered|seamless|gradient|solid)\s+(?:background|backdrop|setting)\b/i.test(prompt);
}

/** Airplane prompts must not be rewritten into a generic blue-sky scene. */
export function hasAirplaneSceneOverride(prompt: string): boolean {
  return /\b(hangar|runway|airport|airfield|tarmac|parked|grounded|museum|display|exhibit|indoor|interior|inside|cutaway|night|midnight|dawn|dusk|sunset|storm|rain|snow|desert|forest|city|urban)\b/i.test(prompt);
}
