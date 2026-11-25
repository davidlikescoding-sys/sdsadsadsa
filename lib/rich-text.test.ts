import { describe, expect, it } from "vitest";
import {
  highlightCode,
  parseRichText,
  renderMath,
  tokenizeInline,
  type CodeToken,
  type InlineToken,
} from "./rich-text";

function valuesOf(tokens: CodeToken[], type: CodeToken["type"]): string[] {
  return tokens.filter((token) => token.type === type).map((token) => token.value);
}

describe("parseRichText", () => {
  it("parses fenced code blocks with their language and exact body", () => {
    const blocks = parseRichText("Intro\n\n```ts\nconst x = 1;\nconst y = 2;\n```\n\nAfter");
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "code", "paragraph"]);
    expect(blocks[1]).toEqual({
      type: "code",
      language: "ts",
      code: "const x = 1;\nconst y = 2;",
    });
  });

  it("parses GFM pipe tables into headers and rows", () => {
    const blocks = parseRichText("| Name | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |");
    expect(blocks).toEqual([{
      type: "table",
      headers: ["Name", "Value"],
      rows: [["a", "1"], ["b", "2"]],
    }]);
  });

  it("preserves source order across headings, lists, quotes and rules", () => {
    const blocks = parseRichText("# Title\n- one\n- two\n> quoted\n---\n1. first\n2. second");
    expect(blocks.map((block) => block.type)).toEqual(["heading", "list", "quote", "rule", "list"]);
    expect(blocks[0]).toMatchObject({ level: 1, text: "Title" });
    expect(blocks[1]).toMatchObject({ ordered: false, items: ["one", "two"] });
    expect(blocks[2]).toMatchObject({ text: "quoted" });
    expect(blocks[4]).toMatchObject({ ordered: true, items: ["first", "second"] });
  });

  it("keeps a pipe-containing paragraph when there is no separator row", () => {
    const blocks = parseRichText("a | b\nplain text");
    expect(blocks).toEqual([{ type: "paragraph", text: "a | b\nplain text" }]);
  });
});

describe("tokenizeInline", () => {
  it("keeps inline code intact inside bold and never parses markup in code spans", () => {
    const outer = tokenizeInline("**use `x|y` now**");
    expect(outer).toHaveLength(1);
    expect(outer[0].type).toBe("bold");
    if (outer[0].type === "bold") {
      expect(outer[0].children.map((token) => token.type)).toEqual(["text", "code", "text"]);
      expect(outer[0].children[1]).toEqual({ type: "code", value: "x|y" });
    }
    expect(tokenizeInline("`**not bold**`")).toEqual([{ type: "code", value: "**not bold**" }]);
  });

  it("rejects unsafe link schemes as plain text", () => {
    const unsafe = [
      "[x](javascript:alert(1))",
      "[x](data:text/html;base64,QQ==)",
      "[x](file:///etc/passwd)",
      "[x](//example.com)",
    ];
    for (const source of unsafe) {
      const tokens = tokenizeInline(source);
      expect(tokens.some((token) => token.type === "link")).toBe(false);
      expect(tokens).toEqual([{ type: "text", value: source }]);
    }
  });

  it("keeps http, https and mailto links with tokenized labels", () => {
    const tokens = tokenizeInline("See [docs](https://example.com/a?b=1) or [mail](mailto:a@b.com)");
    const links = tokens.filter((token): token is Extract<InlineToken, { type: "link" }> => token.type === "link");
    expect(links.map((link) => link.href)).toEqual(["https://example.com/a?b=1", "mailto:a@b.com"]);
    expect(links[0].children).toEqual([{ type: "text", value: "docs" }]);
  });

  it("treats escaped markers and inline math as distinct tokens", () => {
    expect(tokenizeInline("\\*not italic\\*")).toEqual([{ type: "text", value: "*not italic*" }]);
    expect(tokenizeInline("area $r^2$ ok")).toEqual([
      { type: "text", value: "area " },
      { type: "math", value: "r^2" },
      { type: "text", value: " ok" },
    ]);
  });
});

describe("renderMath", () => {
  it("renders a safe LaTeX subset as readable Unicode", () => {
    expect(renderMath("\\alpha + \\beta \\times \\frac{1}{2} \\le \\neq")).toBe("α + β × 1/2 ≤ ≠");
    expect(renderMath("E=mc^2, x_i, \\sqrt{x}")).toBe("E=mc², xᵢ, √x");
  });

  it("drops unknown commands, backslashes and braces without emitting markup", () => {
    const out = renderMath("\\unknown{\\alpha} + \\frac{1}{2}");
    expect(out).not.toContain("\\");
    expect(out).not.toContain("{");
    expect(out).not.toContain("}");
    expect(out).not.toContain("<");
    expect(out).toContain("α");
    expect(out).toContain("1/2");
  });
});

describe("highlightCode", () => {
  it("classifies JavaScript keywords, strings, comments, numbers and punctuation", () => {
    const tokens = highlightCode("// note\nconst n = 42; const s = \"hi\";", "ts");
    expect(valuesOf(tokens, "comment")).toContain("// note");
    expect(valuesOf(tokens, "keyword")).toContain("const");
    expect(valuesOf(tokens, "number")).toContain("42");
    expect(valuesOf(tokens, "string")).toContain("\"hi\"");
    expect(valuesOf(tokens, "punctuation")).toContain("=");
  });

  it("uses language-specific comments and case-insensitive SQL keywords", () => {
    const python = highlightCode("# comment\ndef f(x):\n    return x", "python");
    expect(valuesOf(python, "comment")).toContain("# comment");
    expect(valuesOf(python, "keyword")).toContain("def");

    const sql = highlightCode("SELECT * FROM t WHERE x = 1", "sql");
    expect(valuesOf(sql, "keyword")).toContain("SELECT");
  });

  it("falls back to generic classification for unknown languages", () => {
    const tokens = highlightCode("x = 1 // tail", "brainfuck");
    expect(valuesOf(tokens, "number")).toContain("1");
    expect(valuesOf(tokens, "comment")).toContain("// tail");
    expect(tokens.every((token) => token.type !== "plain" || token.value.length > 0)).toBe(true);
  });
});
