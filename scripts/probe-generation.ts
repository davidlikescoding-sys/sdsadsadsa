/** Print raw generations from a trained checkpoint for honest inspection. */
import fs from "node:fs";
import path from "node:path";
import { sessionFromSnapshot } from "../src/engine/session";
import { wordPrompt } from "../src/lib/word-corpus";
import type { ModelSnapshot } from "../src/engine/serialization";

const file = path.resolve(process.argv[2] ?? "scripts/word-model-small.json");
const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { snapshot?: ModelSnapshot } & ModelSnapshot;
const session = sessionFromSnapshot((parsed.snapshot ?? parsed) as ModelSnapshot, 0.01);

const prompts: Array<[string, string[]]> = [
  ["What is photosynthesis?", ["Photosynthesis is how plants use light energy to produce sugars from carbon dioxide and water."]],
  ["Hello", []],
  ["What does rapid mean?", ["rapid: happening very quickly"]],
  ["What does plus mean?", ["plus: the operation of adding one number to another"]],
  ["What is 5 plus 3?", ["The result is 8."]],
  ["What does multiplied by mean?", ["multiplied by: one number is multiplied by another number"]],
  ["What does JavaScript mean?", ["javascript: a programming language used to add interactive behaviour to web pages"]],
  ["What does variable mean?", ["variable: a named place in a program that stores a value which can change"]],
  ["What does Python mean?", ["python: a programming language known for readable syntax"]],
  ["What does function mean?", ["function: a named block of code that performs a task and can be used again"]],
  ["How do you make a game?", ["A game has a game loop that runs once per frame and reads input, updates state and draws sprites."]],
  ["What is a sprite?", ["sprite: a two dimensional image used for a character or object in a game"]],
  ["How do you build a website?", ["A website uses HTML for structure, CSS for style and layout, and JavaScript for behaviour."]],
  ["What is the DOM?", ["The DOM is the document object model that lets JavaScript read and change web page elements."]],
];

for (const [question, evidence] of prompts) {
  const prompt = wordPrompt(question, evidence);
  console.log("\nPROMPT:", prompt.replace(/\n/g, " | "));
  for (const opts of [
    { temperature: 0.8, topK: 0, topP: 0.9, repetitionPenalty: 1.1, maxTokens: 24 },
    { temperature: 0.5, topK: 20, topP: 0.9, repetitionPenalty: 1.2, maxTokens: 24 },
  ]) {
    const out = session.generate(prompt, opts);
    console.log(`  t=${opts.temperature} k=${opts.topK}:`, JSON.stringify(out.slice(0, 220)));
  }
}
