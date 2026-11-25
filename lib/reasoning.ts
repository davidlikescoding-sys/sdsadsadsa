import type { UtteranceIntent } from "./language";
import { tokenize } from "./rag";

export interface CalculationResult {
  expression: string;
  value: number;
  spoken: string;
  method: "arithmetic" | "linear-equation";
}

export interface ReasoningStep {
  id: string;
  kind: "parse" | "decompose" | "evidence" | "calculate" | "consistency";
  action: string;
  result: string;
}

export interface EvidenceItem {
  text: string;
  source: string;
}

export interface ReasoningPlan {
  question: string;
  subquestions: string[];
  calculation: CalculationResult | null;
  contradictions: string[];
  steps: ReasoningStep[];
  summary: string;
}

export interface AnswerVerification {
  ok: boolean;
  support: number;
  coverage: number;
  reasons: string[];
  calculationMatches: boolean | null;
}

type MathToken = { type: "number" | "op" | "lparen" | "rparen"; value: string };

const NEGATIONS = new Set(["not", "never", "no", "cannot", "cant", "isnt", "arent", "dont", "doesnt"]);
const ABSOLUTES = new Set(["always", "never", "all", "none", "every", "impossible"]);

function round(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.abs(value) < 1e-10 ? 0 : Math.round(value * 1e6) / 1e6;
}

export function formatResult(value: number): string {
  if (!Number.isFinite(value)) return "undefined";
  return String(round(value));
}

function lexExpression(expression: string): MathToken[] | null {
  const tokens: MathToken[] = [];
  let i = 0;
  while (i < expression.length) {
    const char = expression[i];
    if (/\s/.test(char)) { i++; continue; }
    if (/[0-9.]/.test(char)) {
      let number = "";
      let dots = 0;
      while (i < expression.length && /[0-9.]/.test(expression[i])) {
        if (expression[i] === ".") dots++;
        number += expression[i++];
      }
      if (dots > 1 || !number) return null;
      tokens.push({ type: "number", value: number });
      continue;
    }
    if ("+-*/^".includes(char)) { tokens.push({ type: "op", value: char }); i++; continue; }
    if (char === "(") { tokens.push({ type: "lparen", value: char }); i++; continue; }
    if (char === ")") { tokens.push({ type: "rparen", value: char }); i++; continue; }
    return null;
  }
  return tokens;
}

/** Safe recursive-descent evaluator. It never calls eval or executes code. */
export function evaluateExpression(expression: string): number | null {
  const tokens = lexExpression(expression);
  if (!tokens?.length) return null;
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function parsePrimary(): number {
    const token = take();
    if (!token) throw new Error("Unexpected end of expression.");
    if (token.type === "number") {
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new Error("Invalid number.");
      return value;
    }
    if (token.type === "lparen") {
      const value = parseSum();
      const close = take();
      if (!close || close.type !== "rparen") throw new Error("Missing closing parenthesis.");
      return value;
    }
    if (token.type === "op" && (token.value === "-" || token.value === "+")) {
      const value = parseUnary();
      return token.value === "-" ? -value : value;
    }
    throw new Error("Unexpected token in expression.");
  }

  function parseUnary(): number {
    const token = peek();
    if (token?.type === "op" && (token.value === "-" || token.value === "+")) {
      take();
      const value = parseUnary();
      return token.value === "-" ? -value : value;
    }
    return parsePrimary();
  }

  function parsePower(): number {
    const base = parseUnary();
    const token = peek();
    if (token?.type === "op" && token.value === "^") {
      take();
      const exponent = parsePower();
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parseProduct(): number {
    let value = parsePower();
    while (peek()?.type === "op" && (peek().value === "*" || peek().value === "/")) {
      const op = take().value;
      const right = parsePower();
      if (op === "/" && right === 0) throw new Error("Division by zero.");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  function parseSum(): number {
    let value = parseProduct();
    while (peek()?.type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = take().value;
      const right = parseProduct();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  try {
    const result = parseSum();
    if (position !== tokens.length) return null;
    return Number.isFinite(result) ? round(result) : null;
  } catch {
    return null;
  }
}

/** Convert informal arithmetic questions into a real expression, then calculate it. */
export function evaluateArithmetic(question: string): CalculationResult | null {
  let text = question.toLowerCase().trim();
  text = text.replace(/[?]+$/, "").replace(/[“”"'`,]/g, "");
  text = text.replace(/^(?:what is|whats|what are|calculate|compute|solve|find|how much is|the value of)\s+/, "");
  text = text.replace(/^(?:please\s+)?(?:tell me\s+)?(?:the answer to|the result of)\s+/, "");
  text = text.replace(/\b(?:equals?|gives?|is equal to)\b.*$/, "").trim();
  text = text.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  // Ordered worded operations must be normalised before the generic swap.
  // Otherwise "subtract 4 from 9" would become "- 4 from 9" instead of 9 - 4.
  text = text
    .replace(/(\d+(?:\.\d+)?)\s+subtracted from\s+(\d+(?:\.\d+)?)/g, "$2 - $1")
    .replace(/(\d+(?:\.\d+)?)\s+less than\s+(\d+(?:\.\d+)?)/g, "$2 - $1")
    .replace(/subtract\s+(\d+(?:\.\d+)?)\s+from\s+(\d+(?:\.\d+)?)/g, "$2 - $1")
    .replace(/(\d+(?:\.\d+)?)\s+(?:multiplied|multiply)\s+by\s+(\d+(?:\.\d+)?)/g, "$1 * $2")
    .replace(/multiply\s+(\d+(?:\.\d+)?)\s+by\s+(\d+(?:\.\d+)?)/g, "$1 * $2")
    .replace(/(\d+(?:\.\d+)?)\s+divided by\s+(\d+(?:\.\d+)?)/g, "$1 / $2")
    .replace(/divide\s+(\d+(?:\.\d+)?)\s+by\s+(\d+(?:\.\d+)?)/g, "$1 / $2");
  // A standalone x between operands means multiplication, as in "6 x 7".
  text = text.replace(/\s+x\s+/g, " * ");

  const percentFirst = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*(\d+(?:\.\d+)?)/);
  let expression = text;
  if (percentFirst) {
    expression = `(${percentFirst[1]}/100)*${percentFirst[2]}`;
  } else {
    expression = text
      .replace(/\b(?:plus|add|added to|and|addition)\b/g, "+")
      .replace(/\b(?:minus|subtract|subtraction|subtracted from|less)\b/g, "-")
      .replace(/\b(?:times|multiplied by|multiply)\b/g, "*")
      .replace(/\b(?:divided by|divide|over)\b/g, "/")
      .replace(/\b(?:squared)\b/g, "^2")
      .replace(/\b(?:cubed)\b/g, "^3")
      .replace(/\b(?:to the power of|power)\b/g, "^");
  }
  const value = evaluateExpression(expression);
  if (value === null || /\bof\b/i.test(expression.replace(/\d+\s*\/\s*100\)?/g, ""))) return null;
  return {
    expression: percentFirst ? `${percentFirst[1]}% of ${percentFirst[2]}` : expression,
    value,
    spoken: `The result is ${formatResult(value)}.`,
    method: "arithmetic",
  };
}

function parseLinearSide(side: string, variable: string): { coefficient: number; constant: number } | null {
  const clean = side.toLowerCase().replace(/\s+/g, "");
  if (!clean || !/^[0-9a-z+\-*/().]+$/i.test(clean)) return null;
  let coefficient = 0;
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const termPattern = new RegExp(`([+-]?(?:\\d+\\.?\\d*|\\.\\d+)?)${escaped}`, "g");
  const remainder = clean.replace(termPattern, (match, raw: string) => {
    const numeric = raw === "" || raw === "+" ? 1 : raw === "-" ? -1 : Number(raw);
    if (Number.isFinite(numeric)) coefficient += numeric;
    return "";
  });
  if (remainder.includes(variable)) return null;
  const constant = remainder ? evaluateExpression(remainder) : 0;
  if (constant === null) return null;
  return { coefficient, constant };
}

/** Solve a simple linear equation such as "2x + 3 = 11". */
export function solveLinearEquation(question: string): CalculationResult | null {
  let text = question.toLowerCase().replace(/[?]+$/, "").replace(/\s+/g, " ").trim();
  text = text.replace(/^(?:what is|solve for|solve|find|calculate|compute)\s+/, "");
  text = text.replace(/^[a-z]\s*:\s*/i, "");
  const parts = text.split(/\s*(?:=|equals)\s*/);
  if (parts.length !== 2) {
    const isMatch = text.match(/^(.+?)\s+is\s+(.+)$/);
    if (!isMatch) return null;
    parts.splice(0, 2, isMatch[1], isMatch[2]);
  }
  const [rawLeft, rawRight] = parts;
  if (!/^[0-9a-z+\-*/(). ]+$/i.test(rawLeft) || !/^[0-9a-z+\-*/(). ]+$/i.test(rawRight)) return null;
  const variableMatch = `${rawLeft}${rawRight}`.match(/[a-z]/i);
  if (!variableMatch) return null;
  const variable = variableMatch[0].toLowerCase();
  const left = parseLinearSide(rawLeft, variable);
  const right = parseLinearSide(rawRight, variable);
  if (!left || !right) return null;
  const divisor = left.coefficient - right.coefficient;
  if (Math.abs(divisor) < 1e-10) return null;
  const value = round((right.constant - left.constant) / divisor);
  if (!Number.isFinite(value)) return null;
  return {
    expression: text,
    value,
    spoken: `${variable} equals ${formatResult(value)}.`,
    method: "linear-equation",
  };
}

export function findCalculation(question: string): CalculationResult | null {
  return evaluateArithmetic(question) ?? solveLinearEquation(question);
}

/** Split compound requests into smaller, checkable problems. */
export function decomposeQuestion(question: string): string[] {
  const clean = question.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean
    .split(/\s*(?:\band\b|\bthen\b|\bbut\b|\bor\b|\bbecause\b|;)\s*/i)
    .map((part) => part.replace(/[?.!]+$/, "").trim())
    .filter((part) => part.length > 0);
  return Array.from(new Set(parts.length ? parts : [clean]));
}

/** Detect direct contradictions between evidence statements using shared terms. */
export function detectContradictions(items: EvidenceItem[]): string[] {
  const contradictions: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = tokenize(items[i].text);
      const b = tokenize(items[j].text);
      const shared = a.filter((term) => b.includes(term));
      if (shared.length < 2) continue;
      const aNegated = a.some((term) => NEGATIONS.has(term));
      const bNegated = b.some((term) => NEGATIONS.has(term));
      const aAbsolute = a.some((term) => ABSOLUTES.has(term));
      const bAbsolute = b.some((term) => ABSOLUTES.has(term));
      if (aNegated !== bNegated || (aAbsolute && bNegated) || (bAbsolute && aNegated)) {
        contradictions.push(`${items[i].source} conflicts with ${items[j].source} about ${shared.slice(0, 3).join(", ")}.`);
      }
    }
  }
  return contradictions.slice(0, 4);
}

export interface BuildPlanInput {
  question: string;
  evidence: EvidenceItem[];
  intent?: UtteranceIntent;
}

export function buildReasoningPlan(input: BuildPlanInput): ReasoningPlan {
  const subquestions = decomposeQuestion(input.question);
  const calculation = findCalculation(input.question);
  const contradictions = detectContradictions(input.evidence);
  const steps: ReasoningStep[] = [
    { id: "parse", kind: "parse", action: "Parse the request", result: `${input.intent ?? "unclassified"} · ${subquestions.length} subproblem(s)` },
    { id: "evidence", kind: "evidence", action: "Collect relevant evidence", result: `${input.evidence.length} local item(s)` },
  ];
  if (subquestions.length > 1) {
    steps.push({ id: "decompose", kind: "decompose", action: "Break the question into parts", result: subquestions.join(" → ") });
  }
  if (calculation) {
    steps.push({
      id: "calculate", kind: "calculate", action: "Run a real calculation",
      result: `${calculation.expression} = ${formatResult(calculation.value)}`,
    });
  }
  steps.push({
    id: "consistency", kind: "consistency", action: "Check for contradictions",
    result: contradictions.length ? contradictions.join(" ") : "No direct contradiction found in retrieved evidence.",
  });
  const summary = steps.map((step) => `${step.action}: ${step.result}`).join(" ");
  return { question: input.question, subquestions, calculation, contradictions, steps, summary };
}

export interface VerifyInput {
  question: string;
  answer: string;
  evidence: string[];
  plan?: ReasoningPlan | null;
}

export function verifyAnswer(input: VerifyInput): AnswerVerification {
  const reasons: string[] = [];
  const answerTerms = Array.from(new Set(tokenize(input.answer)));
  const evidenceSet = new Set(input.evidence.flatMap((item) => tokenize(item)));
  const support = answerTerms.length ? answerTerms.filter((term) => evidenceSet.has(term)).length / answerTerms.length : 0;
  const questionTerms = Array.from(new Set(tokenize(input.question)));
  const coverage = questionTerms.length ? questionTerms.filter((term) => answerTerms.includes(term)).length / questionTerms.length : 1;

  const calculation = input.plan?.calculation ?? findCalculation(input.question);
  let calculationMatches: boolean | null = null;
  if (calculation) {
    const expected = formatResult(calculation.value);
    calculationMatches = input.answer.includes(expected);
    if (calculationMatches) reasons.push("The answer contains the value produced by the local calculation.");
    else reasons.push(`The local calculation produced ${expected}, which is not present in the answer.`);
  }

  const contradictions = input.plan?.contradictions ?? detectContradictions(input.evidence.map((text, index) => ({ text, source: `Evidence ${index + 1}` })));
  if (contradictions.length) reasons.push("Retrieved evidence contains a direct contradiction.");

  if (support >= 0.3) reasons.push(`${Math.round(support * 100)}% of answer terms are supported by retrieved evidence.`);
  else reasons.push("Answer has weak lexical support in retrieved evidence.");
  if (coverage >= 0.3) reasons.push(`${Math.round(coverage * 100)}% of question terms appear in the answer.`);

  const ok = Boolean(input.answer.trim())
    && contradictions.length === 0
    && (support >= 0.25 || coverage >= 0.35 || calculationMatches === true);
  return { ok, support, coverage, reasons, calculationMatches };
}
