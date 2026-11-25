// One-time generator for the bundled dictionary dataset.
// Requires WordNet data: npm install --no-save wordnet-db
// Output: public/data/english-dictionary.json
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dictDir = path.join(root, "node_modules", "wordnet-db", "dict");
const outFile = path.join(root, "public", "data", "english-dictionary.json");
const POS = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };
const QUOTA = { noun: 2200, verb: 1200, adjective: 1100, adverb: 500 };
const BLOCK = new Set(["fuck", "shit", "cunt", "bitch", "nigger", "nigga", "faggot", "rape", "porn", "penis", "vagina", "asshole", "bastard", "slut", "whore", "dick", "cum", "molest", "nazi", "kill"]);
// Always present, even when WordNet tag frequency would exclude them.
const ESSENTIAL = ["hello", "world", "i", "you", "am", "is", "are", "the", "have", "learn", "enormous", "computer", "happy", "sad", "run", "read", "write", "book", "sky", "blue", "water", "friend", "school", "teacher", "student", "question", "answer", "word", "language", "science", "math", "number", "nature", "emotion", "technology", "internet", "phone", "music", "food", "house", "car", "time", "day", "night", "good", "bad", "big", "small", "quickly", "carefully", "every", "very", "really", "perhaps", "maybe", "because", "however", "although", "under", "between", "through", "during", "before", "after", "always", "never", "often", "sometimes"];
const STOPWORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "they", "them", "their", "have", "has", "had", "was", "were", "been", "being", "will", "would", "can", "could", "should", "may", "might", "must", "shall", "are", "not", "but", "all", "any", "some", "many", "much", "more", "most", "other", "into", "over", "under", "than", "then", "when", "where", "which", "while", "who", "whom", "whose", "about", "above", "after", "before", "between", "during", "through", "your", "our", "his", "her", "its", "one", "two", "three"]);

const topicRules = [
  ["technology", /computer|software|hardware|network|internet|digital|electronic|program|algorithm|device|machine|web|data|code|electric|engine|robot|telephone|radio|satellite|video|screen|keyboard|software|device/i],
  ["science", /chemic|biolog|physic|atom|molecul|organism|species|experiment|scientific|theory|cell|disease|energy|matter|chemical|evolution|gene|virus|gravity|light|sound|heat/i],
  ["mathematics", /number|mathemat|equation|calculat|geometr|algebra|fraction|angle|ratio|theorem|digit|count|measure|add|subtract|multiply|divide|equal|statistics|probability/i],
  ["nature", /animal|plant|river|mountain|weather|forest|ocean|earth|sky|tree|flower|bird|fish|insect|field|desert|island|lake|storm|rain|snow|wind|sun|moon|star/i],
  ["emotions", /feeling|emotion|happy|sad|anger|angry|fear|afraid|love|joy|hate|anxiety|hope|proud|jealous|grief|delight|disgust|sympathy|affection|mood/i],
  ["communication", /speak|language|word|message|conversation|write|reading|signal|tell|say|talk|speech|sentence|letter|discuss|explain|communicat|announce|reply/i],
  ["education", /learn|teach|school|student|study|knowledge|lesson|university|college|book|education|exercise|practice|examination|student|train|skill/i],
  ["objects", /tool|instrument|container|furniture|object|thing|box|table|chair|door|house|window|cup|plate|knife|bottle|bag|key|clock|bed/i],
  ["actions", /^(verb)$/i],
  ["descriptive", /^(adjective|adverb)$/i],
];

function topicsFor(definition, pos) {
  const topics = [];
  for (const [topic, re] of topicRules) {
    if (topic === "actions" || topic === "descriptive") continue;
    if (re.test(definition)) topics.push(topic);
  }
  if (pos === "verb" && !topics.includes("actions")) topics.push("actions");
  if ((pos === "adjective" || pos === "adverb") && !topics.includes("descriptive")) topics.push("descriptive");
  if (!topics.length) topics.push("everyday");
  return topics.slice(0, 3);
}

function parseIndex(file, pos) {
  const out = [];
  const lines = fs.readFileSync(path.join(dictDir, file), "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith(" ")) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;
    const [lemma, p, synsetCount, ptrCount] = parts;
    if (p !== pos) continue;
    if (synsetCount === undefined || ptrCount === undefined) continue;
    // Standard WordNet index: lemma pos synset_cnt p_cnt [ptr_symbol...] sense_cnt tagsense_cnt offsets...
    const numbers = parts.slice(4 + Number(ptrCount));
    const senseCount = Number(numbers[0]) || 0;
    const tagCount = Number(numbers[1]) || 0;
    const offsets = numbers.slice(2).map((n) => String(Number(n)).padStart(8, "0"));
    if (!/^[a-z][a-z'-]{1,19}$/.test(lemma) || BLOCK.has(lemma) || !offsets.length) continue;
    out.push({ lemma, pos: POS[p], score: tagCount * 100 + senseCount + (ESSENTIAL.includes(lemma) ? 1e6 : 0), offsets });
  }
  return out;
}

const synsetCache = new Map();
function loadSynsets(pos) {
  if (synsetCache.has(pos)) return synsetCache.get(pos);
  const map = new Map();
  const lines = fs.readFileSync(path.join(dictDir, `data.${pos}`), "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith(" ")) continue;
    const bar = line.indexOf("|");
    if (bar < 0) continue;
    const head = line.slice(0, bar).trim().split(/\s+/);
    if (head.length < 3) continue;
    const offset = head[0];
    const words = [];
    for (let i = 2; i < head.length; i += 2) {
      const w = head[i];
      if (w && /^[a-z][a-z'-]{1,19}$/.test(w) && !BLOCK.has(w)) words.push(w);
    }
    let body = line.slice(bar + 1).trim();
    const examples = [];
    const exampleRe = /"([^"]{8,160})"/g;
    let m;
    while ((m = exampleRe.exec(body))) examples.push(m[1].replace(/\s+/g, " ").trim());
    const definition = body.split(";")[0].replace(/\s+/g, " ").replace(/[,;\s]+$/, "").trim();
    map.set(offset, { words, definition, examples });
  }
  synsetCache.set(pos, map);
  return map;
}

const candidates = [
  ...parseIndex("index.noun", "n"),
  ...parseIndex("index.verb", "v"),
  ...parseIndex("index.adj", "a"),
  ...parseIndex("index.adv", "r"),
];

const used = new Map();
const entries = [];
for (const pos of ["noun", "verb", "adjective", "adverb"]) {
  const synsets = loadSynsets(pos === "adjective" ? "adj" : pos === "adverb" ? "adv" : pos);
  const pool = candidates.filter((c) => c.pos === pos).sort((a, b) => b.score - a.score);
  let taken = 0;
  for (const candidate of pool) {
    if (taken >= QUOTA[pos]) break;
    if (used.has(candidate.lemma)) continue;
    const syn = synsets.get(candidate.offsets[0]);
    if (!syn || !syn.words.includes(candidate.lemma)) continue;
    const definition = syn.definition.replace(/\.$/, "");
    if (definition.length < 12 || definition.length > 220 || /\b(synset|wordnet|variable|constant)\b/i.test(definition)) continue;
    const synonyms = syn.words.filter((w) => w !== candidate.lemma).slice(0, 6);
    const related = [...new Set([...synonyms, ...syn.examples.flatMap((e) => e.toLowerCase().match(/[a-z]{4,}/g) || [])])]
      .filter((w) => w !== candidate.lemma && !BLOCK.has(w) && !STOPWORDS.has(w) && w.length < 16).slice(0, 6);
    entries.push({
      w: candidate.lemma,
      p: pos,
      d: definition.charAt(0).toUpperCase() + definition.slice(1) + ".",
      s: synonyms,
      r: related,
      x: syn.examples[0] || `This is ${/^[aeiou]/i.test(candidate.lemma) ? "an" : "a"} ${candidate.lemma}.`,
      t: topicsFor(definition, pos),
    });
    used.set(candidate.lemma, true);
    taken++;
  }
}

entries.sort((a, b) => a.w.localeCompare(b.w, "en"));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ version: 1, source: "WordNet 3.0 (Princeton University)", entries }));
console.log(`Wrote ${entries.length} words to ${outFile}`);
