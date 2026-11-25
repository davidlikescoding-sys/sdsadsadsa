/**
 * Evaluation of the actual word-level Transformer, separate from the
 * component benchmark in evaluation.ts. These prompts and choices were
 * authored specifically for testing and are NOT part of the training corpus
 * (word-corpus.ts never imports this file), so they are independent examples.
 *
 * Scoring uses the model's own teacher-forced log-probabilities via
 * scoreAnswer(). No keyword matching and no canned answers.
 */
import { scoreAnswer } from "@/engine/transformer";
import type { TrainingSession } from "@/engine/session";

export type LmCategory = "completion" | "grammar" | "vocabulary" | "concept" | "comprehension" | "conversation";

export interface LmCase {
  id: string;
  category: LmCategory;
  prompt: string;
  choices: string[];
  correct: number;
}

/** Fresh, locally authored test items. Never exported into the training corpus. */
export const LM_EVAL_CASES: LmCase[] = [
  {
    id: "completion-1", category: "completion",
    prompt: "The scientist placed the cold glass in the sunlight. After several minutes, the glass began to",
    choices: ["warm", "freeze", "vanish", "sing"], correct: 0,
  },
  {
    id: "completion-2", category: "completion",
    prompt: "Maya forgot her umbrella before leaving home. When the sky grew dark, the first drops of rain started to",
    choices: ["fall", "melt", "bloom", "read"], correct: 0,
  },
  {
    id: "completion-3", category: "completion",
    prompt: "A bicycle needs air in its tyres. If one tyre goes flat, the rider should",
    choices: ["repair it", "ignore it", "eat it", "forget it"], correct: 0,
  },
  {
    id: "grammar-1", category: "grammar",
    prompt: "Which sentence is grammatically correct?",
    choices: [
      "She has lived in this town for many years",
      "She live in this town for many years",
      "She living in this town for many years",
      "She has living in this town for many years",
    ], correct: 0,
  },
  {
    id: "grammar-2", category: "grammar",
    prompt: "Choose the sentence with correct subject-verb agreement.",
    choices: [
      "The children play in the park every afternoon",
      "The children plays in the park every afternoon",
      "The children playing in the park every afternoon",
      "The children is playing in the park every afternoon",
    ], correct: 0,
  },
  {
    id: "vocab-1", category: "vocabulary",
    prompt: "What does the word enormous most nearly mean?",
    choices: ["very large", "very small", "very loud", "very old"], correct: 0,
  },
  {
    id: "vocab-2", category: "vocabulary",
    prompt: "A synonym for the word rapid is",
    choices: ["swift", "slow", "dull", "heavy"], correct: 0,
  },
  {
    id: "concept-1", category: "concept",
    prompt: "Which statement is scientifically correct?",
    choices: [
      "Water freezes at about zero degrees Celsius",
      "Water boils at about zero degrees Celsius",
      "Water always freezes at one hundred degrees Celsius",
      "Water never changes state",
    ], correct: 0,
  },
  {
    id: "concept-2", category: "concept",
    prompt: "Which statement describes a triangle?",
    choices: [
      "It has three sides and three angles",
      "It has four sides and four angles",
      "It has no sides and no angles",
      "It always has five equal sides",
    ], correct: 0,
  },
  {
    id: "comprehension-1", category: "comprehension",
    prompt: "Context: Tom left his keys on the kitchen table before he went to school. When he returned in the afternoon, he could not find them.\nUser: Where did Tom leave his keys?\nDavidAI:",
    choices: ["on the kitchen table", "at school", "in the car", "in his bag"], correct: 0,
  },
  {
    id: "comprehension-2", category: "comprehension",
    prompt: "Context: A small seed was planted in a pot. It received water and sunlight each day. After several weeks, a green stem appeared.\nUser: What helped the seed grow?\nDavidAI:",
    choices: ["water and sunlight", "ice and snow", "wind and fire", "salt and sand"], correct: 0,
  },
  {
    id: "conversation-1", category: "conversation",
    prompt: "User: I lost my dog this morning and I feel terrible.\nDavidAI:",
    choices: [
      "I am sorry to hear that. Let us think about where he might have gone",
      "That is not a real problem",
      "You should buy a new computer",
      "The sky is blue today",
    ], correct: 0,
  },
];

export interface LmCaseResult {
  id: string;
  category: LmCategory;
  passed: boolean;
  chosen: number;
  correct: number;
  /** Mean per-token log probability of each choice under the model. */
  scores: number[];
}

export interface LmEvaluationReport {
  generatedAt: string;
  modelReady: boolean;
  step: number;
  vocabSize: number;
  correct: number;
  total: number;
  accuracy: number;
  categories: Record<string, { correct: number; total: number }>;
  results: LmCaseResult[];
  note: string;
}

const CATEGORY_FALLBACK: Record<LmCategory, number> = {
  completion: 0, grammar: 0, vocabulary: 0, concept: 0, comprehension: 0, conversation: 0,
};

/** Run every case through the model's real forward pass. Synchronous but heavy. */
export function runLmEvaluation(session: TrainingSession | null, step: number): LmEvaluationReport {
  const categories: Record<string, { correct: number; total: number }> = {};
  for (const category of Object.keys(CATEGORY_FALLBACK)) categories[category] = { correct: 0, total: 0 };
  const results: LmCaseResult[] = [];
  let correct = 0;

  for (const testCase of LM_EVAL_CASES) {
    let chosen = -1;
    let scores: number[] = [];
    if (session) {
      scores = testCase.choices.map((choice) => {
        const value = scoreAnswer(session.model, session.tokenizer, testCase.prompt, choice, 16);
        return Number.isFinite(value) ? value : -Infinity;
      });
      let best = -Infinity;
      for (let i = 0; i < scores.length; i++) if (scores[i] > best) { best = scores[i]; chosen = i; }
    }
    const passed = chosen === testCase.correct;
    if (passed) correct++;
    categories[testCase.category].total++;
    if (passed) categories[testCase.category].correct++;
    results.push({ id: testCase.id, category: testCase.category, passed, chosen, correct: testCase.correct, scores });
  }

  return {
    generatedAt: new Date().toISOString(),
    modelReady: Boolean(session),
    step,
    vocabSize: session?.tokenizer.size ?? 0,
    correct,
    total: LM_EVAL_CASES.length,
    accuracy: Math.round((correct / LM_EVAL_CASES.length) * 100),
    categories,
    results,
    note: session
      ? "Choices are ranked by the loaded Transformer's own mean per-token log probability. No training example is used as a test question."
      : "No word model is loaded in this browser yet. Initialize and train it, then run this evaluation again.",
  };
}
