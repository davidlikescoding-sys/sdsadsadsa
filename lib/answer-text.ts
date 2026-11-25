/**
 * Presentation-only cleanup for the locally generated word-model output.
 * The word tokenizer is lowercase and has no punctuation tokens, so raw
 * samples need sentence casing and terminal punctuation before display.
 * This never changes the facts or adds new information.
 */

const ALWAYS_CAPITALIZED: Record<string, string> = {
  i: "I",
  davidai: "DavidAI",
  canada: "Canada", canadian: "Canadian", ottawa: "Ottawa", toronto: "Toronto",
  france: "France", french: "French", paris: "Paris",
  america: "America", american: "American",
  britain: "Britain", british: "British", england: "England", english: "English", london: "London",
  germany: "Germany", german: "German", japan: "Japan", japanese: "Japanese",
  china: "China", chinese: "Chinese", india: "India", indian: "Indian",
  australia: "Australia", australian: "Australian", mexico: "Mexico", mexican: "Mexican",
  brazil: "Brazil", brazilian: "Brazilian", russia: "Russia", russian: "Russian",
  spain: "Spain", spanish: "Spanish", italy: "Italy", italian: "Italian",
  europe: "Europe", european: "European",
};

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Proper nouns already capitalized by the user are a reliable casing hint. */
function questionCapitalizedWords(question: string): Set<string> {
  const words = question.match(/[\p{L}][\p{L}'-]*/gu) ?? [];
  const result = new Set<string>();
  words.forEach((word, index) => {
    if (index === 0) return; // sentence-initial capitalization is not a proper noun
    if (/^\p{Lu}/u.test(word) && word.toLowerCase() !== "i") result.add(word.toLowerCase());
  });
  return result;
}

/**
 * Turn raw model text into a complete, correctly capitalized sentence.
 * Facts and wording are preserved; only casing and punctuation are repaired.
 */
export function polishAnswer(text: string, question = ""): string {
  let out = text.replace(/\s+/g, " ").trim();
  if (!out) return out;

  out = out.replace(/^(?:(?:davidai|user)\s*:\s*)+/i, "");
  // Stored memories and knowledge entries use metadata labels that are not
  // part of a spoken sentence.
  out = out.replace(/^(?:vocabulary|knowledge|dataset|memory|dictionary|remembered|preference)\s*:\s*/i, "");
  out = out.replace(/\s+([,.!?;:])/g, "$1");
  out = out.replace(/\s{2,}/g, " ");
  if (!out) return out;

  out = capitalize(out);
  const fromQuestion = questionCapitalizedWords(question);
  // Definitions copied from the dictionary keep the headword's capital in the
  // definition ("Lion means A large wild cat"); lowercase it mid-sentence.
  out = out.replace(/\b(means|is|are|was|were)\s+([\p{Lu}][\p{Ll}]*)(?![\p{L}])/gu, (all, verb: string, word: string) => {
    // Acronyms and hyphenated codes (ZEPHYR-7, DavidAI) must keep their casing.
    const lower = word.toLowerCase();
    if (ALWAYS_CAPITALIZED[lower] || fromQuestion.has(lower)) return all;
    return `${verb} ${lower.charAt(0).toLowerCase()}${lower.slice(1)}`;
  });
  out = out.replace(/\b[\p{L}][\p{L}'-]*\b/gu, (word) => {
    const lower = word.toLowerCase();
    if (ALWAYS_CAPITALIZED[lower]) return ALWAYS_CAPITALIZED[lower];
    if (fromQuestion.has(lower)) return capitalize(word);
    return word;
  });

  if (!/[.!?。！？]$/.test(out)) out += ".";
  return out;
}
