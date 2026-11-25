/**
 * Dependency-free parsing helpers for AI chat messages.
 *
 * Everything here is purely lexical: it returns plain data that a React
 * component can turn into nodes. No HTML strings are produced, so callers
 * never need `dangerouslySetInnerHTML`.
 */

export type CodeBlock = { type: "code"; language: string; code: string };
export type HeadingBlock = { type: "heading"; level: 1 | 2 | 3 | 4; text: string };
export type TableBlock = { type: "table"; headers: string[]; rows: string[][] };
export type ListBlock = { type: "list"; ordered: boolean; items: string[] };
export type QuoteBlock = { type: "quote"; text: string };
export type RuleBlock = { type: "rule" };
export type ParagraphBlock = { type: "paragraph"; text: string };

export type RichBlock =
  | CodeBlock
  | HeadingBlock
  | TableBlock
  | ListBlock
  | QuoteBlock
  | RuleBlock
  | ParagraphBlock;

export type TextToken = { type: "text"; value: string };
export type BoldToken = { type: "bold"; children: InlineToken[] };
export type ItalicToken = { type: "italic"; children: InlineToken[] };
export type InlineCodeToken = { type: "code"; value: string };
export type LinkToken = { type: "link"; href: string; children: InlineToken[] };
export type MathToken = { type: "math"; value: string };

export type InlineToken =
  | TextToken
  | BoldToken
  | ItalicToken
  | InlineCodeToken
  | LinkToken
  | MathToken;

export type CodeTokenType = "keyword" | "string" | "comment" | "number" | "punctuation" | "plain";
export type CodeToken = { type: CodeTokenType; value: string };

const FENCE_RE = /^\s*```([A-Za-z0-9_+#.-]*)\s*$/;
const FENCE_END_RE = /^\s*```\s*$/;
const RULE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const LINK_RE = /^\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+)\)/;
const ESCAPABLE = "\\`*_[](){}#$+-.!|>~";

/** Split a GFM pipe row, honouring backslash-escaped pipes. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      cell += "|";
      i += 1;
      continue;
    }
    if (trimmed[i] === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += trimmed[i];
  }
  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function isTableStart(lines: string[], index: number): boolean {
  return index + 1 < lines.length
    && lines[index].includes("|")
    && isTableSeparator(lines[index + 1]);
}

function parseHeadingLine(line: string): HeadingBlock | null {
  const match = /^\s{0,3}(#{1,4})\s+(.+?)\s*$/.exec(line);
  if (!match) return null;
  const text = match[2].replace(/\s+#+\s*$/, "").trim();
  if (!text) return null;
  return { type: "heading", level: match[1].length as HeadingBlock["level"], text };
}

function startsNewBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return FENCE_RE.test(line)
    || parseHeadingLine(line) !== null
    || RULE_RE.test(line)
    || LIST_ITEM_RE.test(line)
    || QUOTE_RE.test(line)
    || isTableStart(lines, index);
}

/** Parse a chat message into ordered blocks. */
export function parseRichText(input: string): RichBlock[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_END_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", language: fence[1] ?? "", code: body.join("\n") });
      continue;
    }

    const heading = parseHeadingLine(line);
    if (heading) {
      blocks.push(heading);
      i += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i];
        if (!rowLine.trim() || !rowLine.includes("|") || FENCE_RE.test(rowLine)
          || RULE_RE.test(rowLine) || parseHeadingLine(rowLine)) break;
        rows.push(splitTableRow(rowLine));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const firstItem = LIST_ITEM_RE.exec(line);
    if (firstItem) {
      const ordered = /^\d/.test(firstItem[2]);
      const items: string[] = [];
      let j = i;
      while (j < lines.length) {
        const item = LIST_ITEM_RE.exec(lines[j]);
        if (item) {
          if (/^\d/.test(item[2]) !== ordered) break;
          items.push(item[3]);
          j += 1;
          continue;
        }
        // A wrapped list item stays part of the previous item.
        if (items.length && /^\s{2,}\S/.test(lines[j]) && !startsNewBlock(lines, j)) {
          items[items.length - 1] += `\n${lines[j].trim()}`;
          j += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered, items });
      i = j;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      let j = i;
      while (j < lines.length) {
        const match = QUOTE_RE.exec(lines[j]);
        if (!match) break;
        quoted.push(match[1]);
        j += 1;
      }
      blocks.push({ type: "quote", text: quoted.join("\n") });
      i = j;
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsNewBlock(lines, i)) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    } else {
      i += 1; // defensive: always make progress
    }
  }

  return blocks;
}

/** Skip escaped characters and code spans when looking for a closing delimiter. */
function findClosingDelimiter(text: string, from: number, delimiter: string): number {
  let i = from;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith(delimiter, i)) return i;
    i += 1;
  }
  return -1;
}

/** Only absolute web and mail links are rendered as anchors. */
export function isSafeLinkHref(href: string): boolean {
  if (!href || /[\u0000-\u0020\u007f]/.test(href)) return false;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

/** Tokenize one line of inline Markdown. Markup inside code spans is never parsed. */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      tokens.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        tokens.push({ type: "code", value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    if (ch === "[") {
      const link = LINK_RE.exec(text.slice(i));
      if (link) {
        if (isSafeLinkHref(link[2])) {
          flush();
          tokens.push({ type: "link", href: link[2], children: tokenizeInline(link[1]) });
        } else {
          // Unsafe or unknown schemes stay as literal source text.
          buffer += link[0];
        }
        i += link[0].length;
        continue;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    if (ch === "$") {
      const end = findClosingDelimiter(text, i + 1, "$");
      if (end !== -1 && end > i + 1) {
        flush();
        tokens.push({ type: "math", value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    if (text.startsWith("**", i)) {
      const end = findClosingDelimiter(text, i + 2, "**");
      if (end !== -1 && end > i + 2) {
        flush();
        tokens.push({ type: "bold", children: tokenizeInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const end = findClosingDelimiter(text, i + 1, ch);
      if (end !== -1 && end > i + 1) {
        flush();
        tokens.push({ type: "italic", children: tokenizeInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return tokens;
}

type SyntaxConfig = {
  keywords: string[];
  quotes: string[];
  lineComment?: string;
  blockComment?: [string, string];
  caseInsensitive?: boolean;
};

const JS_KEYWORDS = [
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do",
  "switch", "case", "break", "continue", "class", "extends", "new", "this", "super",
  "import", "export", "default", "from", "as", "async", "await", "try", "catch",
  "finally", "throw", "typeof", "instanceof", "void", "delete", "in", "of", "true",
  "false", "null", "undefined", "interface", "type", "enum", "implements", "public",
  "private", "protected", "readonly", "static", "abstract", "declare", "namespace",
  "satisfies", "keyof", "infer", "any", "string", "number", "boolean", "unknown", "never",
];

const PY_KEYWORDS = [
  "def", "class", "return", "if", "elif", "else", "for", "while", "in", "not", "and",
  "or", "is", "lambda", "import", "from", "as", "with", "try", "except", "finally",
  "raise", "pass", "break", "continue", "yield", "global", "nonlocal", "assert", "del",
  "async", "await", "True", "False", "None",
];

const SQL_KEYWORDS = [
  "select", "from", "where", "insert", "into", "values", "update", "set", "delete",
  "create", "table", "drop", "alter", "join", "left", "right", "inner", "outer", "on",
  "as", "and", "or", "not", "null", "is", "in", "order", "by", "group", "having",
  "limit", "distinct", "count", "sum", "avg", "min", "max",
];

const HTML_TAGS = [
  "html", "head", "body", "div", "span", "p", "a", "img", "ul", "ol", "li", "table",
  "thead", "tbody", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "script",
  "style", "section", "article", "header", "footer", "main", "nav", "form", "input",
  "button", "label", "br", "hr", "strong", "em", "code", "pre",
];

const JS_SYNTAX: SyntaxConfig = {
  keywords: JS_KEYWORDS,
  quotes: ["\"", "'", "`"],
  lineComment: "//",
  blockComment: ["/*", "*/"],
};

const SYNTAX: Record<string, SyntaxConfig> = {
  js: JS_SYNTAX,
  jsx: JS_SYNTAX,
  ts: JS_SYNTAX,
  tsx: JS_SYNTAX,
  javascript: JS_SYNTAX,
  typescript: JS_SYNTAX,
  python: {
    keywords: PY_KEYWORDS,
    quotes: ["\"", "'"],
    lineComment: "#",
  },
  json: {
    keywords: ["true", "false", "null"],
    quotes: ["\""],
  },
  bash: {
    keywords: ["if", "then", "else", "elif", "fi", "for", "do", "done", "while", "case",
      "esac", "function", "in", "export", "local", "return", "exit"],
    quotes: ["\"", "'"],
    lineComment: "#",
  },
  sql: {
    keywords: SQL_KEYWORDS,
    quotes: ["'", "\""],
    lineComment: "--",
    blockComment: ["/*", "*/"],
    caseInsensitive: true,
  },
  css: {
    keywords: ["important", "inherit", "initial", "unset", "auto", "none", "solid",
      "dashed", "center", "flex", "grid", "block", "absolute", "relative", "fixed"],
    quotes: ["\"", "'"],
    blockComment: ["/*", "*/"],
  },
  html: {
    keywords: HTML_TAGS,
    quotes: ["\"", "'"],
    blockComment: ["<!--", "-->"],
    caseInsensitive: true,
  },
  xml: {
    keywords: HTML_TAGS,
    quotes: ["\"", "'"],
    blockComment: ["<!--", "-->"],
    caseInsensitive: true,
  },
};

const DEFAULT_SYNTAX: SyntaxConfig = {
  keywords: ["true", "false", "null"],
  quotes: ["\"", "'", "`"],
  lineComment: "//",
  blockComment: ["/*", "*/"],
};

function syntaxFor(language?: string): SyntaxConfig {
  const key = (language ?? "").trim().toLowerCase();
  if (key === "py") return SYNTAX.python;
  if (key === "sh" || key === "shell" || key === "zsh") return SYNTAX.bash;
  return SYNTAX[key] ?? DEFAULT_SYNTAX;
}

/**
 * Lexical, best-effort highlighting. This is deliberately not a parser: it
 * recognises comments, quoted strings, numbers, keywords and punctuation so
 * chat messages stay readable without pretending to validate source code.
 */
export function highlightCode(code: string, language?: string): CodeToken[] {
  const config = syntaxFor(language);
  const keywordSet = new Set(
    config.caseInsensitive ? config.keywords.map((word) => word.toLowerCase()) : config.keywords,
  );
  const tokens: CodeToken[] = [];
  const push = (type: CodeTokenType, value: string) => {
    if (!value) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.value += value;
    else tokens.push({ type, value });
  };

  let i = 0;
  while (i < code.length) {
    if (config.blockComment && code.startsWith(config.blockComment[0], i)) {
      const [opening, closing] = config.blockComment;
      const end = code.indexOf(closing, i + opening.length);
      const stop = end === -1 ? code.length : end + closing.length;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }

    if (config.lineComment && code.startsWith(config.lineComment, i)) {
      const newline = code.indexOf("\n", i);
      const stop = newline === -1 ? code.length : newline;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }

    const quote = config.quotes.find((candidate) => code.startsWith(candidate, i));
    if (quote) {
      let j = i + quote.length;
      while (j < code.length) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === "\n") break;
        if (code.startsWith(quote, j)) {
          j += quote.length;
          break;
        }
        j += 1;
      }
      push("string", code.slice(i, j));
      i = j;
      continue;
    }

    const ch = code[i];
    if (/\d/.test(ch)) {
      const number = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(code.slice(i));
      if (number) {
        push("number", number[0]);
        i += number[0].length;
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const word = /^[A-Za-z_$][\w$]*/.exec(code.slice(i))?.[0];
      if (word) {
        const candidate = config.caseInsensitive ? word.toLowerCase() : word;
        push(keywordSet.has(candidate) ? "keyword" : "plain", word);
        i += word.length;
        continue;
      }
    }

    if (/[{}[\]()<>;:,=+\-*/%&|^!?~.]/.test(ch)) {
      push("punctuation", ch);
      i += 1;
      continue;
    }

    push("plain", ch);
    i += 1;
  }

  return tokens;
}

const GREEK_LETTERS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
  varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const MATH_SYMBOLS: Record<string, string> = {
  ...GREEK_LETTERS,
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤",
  ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼",
  propto: "∝", infty: "∞", partial: "∂", nabla: "∇", sum: "∑", prod: "∏",
  int: "∫", cdots: "⋯", ldots: "…", to: "→", rightarrow: "→", leftarrow: "←",
  leftrightarrow: "↔", implies: "⇒", iff: "⇔", forall: "∀", exists: "∃",
  neg: "¬", land: "∧", lor: "∨", cap: "∩", cup: "∪", subset: "⊂",
  subseteq: "⊆", supset: "⊃", supseteq: "⊇", emptyset: "∅", angle: "∠",
  degree: "°", prime: "′", in: "∈", notin: "∉",
};

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶",
  "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼",
  "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};

const SUBSCRIPT: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆",
  "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌",
  "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ",
  l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ",
  u: "ᵤ", v: "ᵥ", x: "ₓ",
};

function readBraced(source: string, start: number): { content: string; end: number } | null {
  if (source[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return { content: source.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

function toScript(value: string, superscript: boolean): string {
  const map = superscript ? SUPERSCRIPT : SUBSCRIPT;
  let out = "";
  for (const ch of value) {
    const mapped = map[ch];
    if (!mapped) return `${superscript ? "^" : "_"}(${value})`;
    out += mapped;
  }
  return out;
}

function replaceFractions(source: string): string {
  let current = source;
  for (let pass = 0; pass < 4; pass += 1) {
    let out = "";
    let i = 0;
    let changed = false;
    while (i < current.length) {
      if (current.startsWith("\\frac", i)) {
        const after = i + 5;
        const first = current[after] === "{"
          ? readBraced(current, after)
          : current[after] ? { content: current[after], end: after + 1 } : null;
        if (first && current[first.end] === "{") {
          const second = readBraced(current, first.end);
          if (second) {
            out += `${renderMath(first.content)}/${renderMath(second.content)}`;
            i = second.end;
            changed = true;
            continue;
          }
        }
      }
      out += current[i];
      i += 1;
    }
    current = out;
    if (!changed) break;
  }
  return current;
}

/**
 * Render a small, safe subset of LaTeX as plain Unicode text. This never
 * evaluates input and never emits markup; unknown commands are reduced to
 * their readable name.
 */
export function renderMath(expression: string): string {
  const source = replaceFractions(expression.trim());
  let out = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === "\\") {
      const next = source[i + 1];
      if (next && ",;:! ".includes(next)) {
        i += 2; // spacing commands such as \, and \;
        continue;
      }
      const command = /^\\([A-Za-z]+)/.exec(source.slice(i));
      if (command) {
        const name = command[1];
        i += command[0].length;
        if (name === "sqrt") {
          if (source[i] === "{") {
            const braced = readBraced(source, i);
            if (braced) {
              out += `√${renderMath(braced.content)}`;
              i = braced.end;
              continue;
            }
          }
          if (source[i] && source[i] !== " ") {
            out += `√${source[i]}`;
            i += 1;
            continue;
          }
          out += "√";
          continue;
        }
        out += MATH_SYMBOLS[name] ?? name;
        continue;
      }
      if (next) {
        out += next;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "^" || ch === "_") {
      const superscript = ch === "^";
      const next = source[i + 1];
      if (next === "{") {
        const braced = readBraced(source, i + 1);
        if (braced) {
          out += toScript(renderMath(braced.content), superscript);
          i = braced.end;
          continue;
        }
      }
      if (next && /[A-Za-z0-9]/.test(next)) {
        out += toScript(next, superscript);
        i += 2;
        continue;
      }
      i += 1; // a lone marker has no readable meaning
      continue;
    }

    if (ch === "{") {
      const braced = readBraced(source, i);
      if (braced) {
        out += renderMath(braced.content);
        i = braced.end;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "}") {
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}
