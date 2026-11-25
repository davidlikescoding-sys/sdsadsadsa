"use client";

import React, { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import {
  highlightCode,
  parseRichText,
  renderMath,
  tokenizeInline,
  type CodeBlock,
  type CodeToken,
  type InlineToken,
  type RichBlock,
} from "@/lib/rich-text";

const HEADING_STYLES: Record<1 | 2 | 3 | 4, string> = {
  1: "mt-3 text-lg font-semibold tracking-tight text-slate-100",
  2: "mt-3 text-base font-semibold tracking-tight text-slate-100",
  3: "mt-2 text-sm font-semibold tracking-tight text-slate-100",
  4: "mt-2 text-[13px] font-semibold uppercase tracking-wide text-slate-300",
};

const CODE_STYLES: Record<CodeToken["type"], string> = {
  keyword: "text-violet-300",
  string: "text-emerald-300",
  comment: "italic text-slate-500",
  number: "text-amber-300",
  punctuation: "text-slate-400",
  plain: "text-slate-200",
};

function renderToken(token: InlineToken, key: string): React.ReactNode {
  switch (token.type) {
    case "text":
      return token.value;
    case "code":
      return (
        <code key={key} className="rounded border hairline bg-black/40 px-1 py-0.5 font-mono text-[12px] text-cyan-200">
          {token.value}
        </code>
      );
    case "bold":
      return <strong key={key} className="font-semibold text-slate-100">{renderInlineTokens(token.children, key)}</strong>;
    case "italic":
      return <em key={key} className="italic text-slate-100">{renderInlineTokens(token.children, key)}</em>;
    case "link":
      return (
        <a
          key={key}
          href={token.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200"
        >
          {renderInlineTokens(token.children, key)}
        </a>
      );
    case "math":
      return (
        <span key={key} title={token.value} className="mx-0.5 rounded bg-violet-500/10 px-1 font-mono text-[12px] text-violet-200">
          {renderMath(token.value)}
        </span>
      );
  }
}

function renderInlineTokens(tokens: InlineToken[], keyPrefix: string): React.ReactNode[] {
  return tokens.map((token, index) => renderToken(token, `${keyPrefix}-${index}`));
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return renderInlineTokens(tokenizeInline(text), keyPrefix);
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void copy()}
      aria-label="Copy code"
      className="!px-2 !py-0.5 !text-[10px]"
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function CodeBlockView({ block }: { block: CodeBlock }) {
  return (
    <div className="my-2 overflow-hidden rounded border hairline bg-black/35">
      <div className="flex items-center justify-between gap-2 border-b hairline bg-black/25 px-2.5 py-1.5">
        <Badge tone="neutral">{block.language || "text"}</Badge>
        <CopyButton code={block.code} />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[12px] leading-relaxed">
        <code>
          {highlightCode(block.code, block.language).map((token, index) => (
            <span key={index} className={CODE_STYLES[token.type]}>{token.value}</span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function renderBlock(block: RichBlock, key: string): React.ReactNode {
  switch (block.type) {
    case "heading": {
      const Heading: React.ElementType = `h${block.level}`;
      return <Heading key={key} className={HEADING_STYLES[block.level]}>{renderInline(block.text, key)}</Heading>;
    }
    case "code":
      return <CodeBlockView key={key} block={block} />;
    case "table":
      return (
        <div key={key} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {block.headers.map((cell, index) => (
                  <th key={index} className="border hairline bg-black/30 px-2 py-1.5 text-left font-semibold text-slate-200">
                    {renderInline(cell, `${key}-h${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border hairline px-2 py-1.5 align-top text-slate-300">
                      {renderInline(cell, `${key}-r${rowIndex}c${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "list": {
      const List: React.ElementType = block.ordered ? "ol" : "ul";
      const marker = block.ordered ? "list-decimal" : "list-disc";
      return (
        <List key={key} className={`my-2 space-y-1 pl-5 leading-relaxed text-slate-200 ${marker}`}>
          {block.items.map((item, index) => (
            <li key={index} className="pl-0.5">{renderInline(item, `${key}-i${index}`)}</li>
          ))}
        </List>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className="my-2 whitespace-pre-wrap break-words border-l-2 border-cyan-500/40 bg-cyan-500/[0.04] px-3 py-1.5 text-slate-300">
          {renderInline(block.text, key)}
        </blockquote>
      );
    case "rule":
      return <hr key={key} className="my-3 border-t hairline" />;
    case "paragraph":
      return (
        <p key={key} className="my-2 whitespace-pre-wrap break-words leading-relaxed text-slate-200">
          {renderInline(block.text, key)}
        </p>
      );
  }
}

export function RichText({ content, className = "" }: { content: string; className?: string }) {
  const blocks = parseRichText(content);
  return (
    <div className={`space-y-2 text-[13px] leading-relaxed text-slate-200 ${className}`}>
      {blocks.map((block, index) => renderBlock(block, `block-${index}`))}
    </div>
  );
}

export default RichText;
