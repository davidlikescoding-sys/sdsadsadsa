/**
 * Shared web-evidence boundary.
 *
 * Retrieved pages are data. Text that looks like an instruction, credential
 * request, or command is filtered before it can be quoted, saved, or injected
 * into a local-model prompt. This is deliberately conservative: losing a few
 * sentences is safer than absorbing an instruction from an untrusted page.
 */
import type { ResearchFinding } from "./types";

const UNTRUSTED_WEB_PATTERN = /\b(?:ignore (?:all )?(?:previous|prior|above)|system prompt|developer (?:message|instruction)|you must|your task is|you are now|act as|pretend to be|reveal (?:your|the) (?:prompt|instructions)|api key|secret key|password|download and run|run (?:this|the following) command|execute (?:this|the following)|curl |wget |click here|enable javascript|sign up|subscribe|all rights reserved|privacy policy|terms of service|cookie policy)\b/i;

export function isUntrustedWebText(text: string): boolean {
  return UNTRUSTED_WEB_PATTERN.test(text);
}

export function cleanWebEvidence(value: string): string {
  return value
    .replace(/^[\s>*#`\-–—]+/, "")
    .replace(/\[\s*\d+\s*\]$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 340);
}

export interface WebEvidence {
  title: string;
  content: string;
  sourceUrl?: string;
  /** The page or result title — never a service name such as "wikipedia". */
  sourceTitle?: string;
  sourceService?: string;
  retrievedAt?: string;
  publishedAt?: string;
  keywords: string[];
}

/** Convert one research finding into attributed, instruction-filtered evidence. */
export function findingToWebEvidence(finding: ResearchFinding): WebEvidence | null {
  const sentences = Array.from(new Set(
    finding.sentences
      .map(cleanWebEvidence)
      .filter((text) => text.length >= 24 && !isUntrustedWebText(text)),
  )).slice(0, 6);
  const content = sentences.join(" ");
  if (content.length < 24) return null;
  const title = cleanWebEvidence(finding.page?.title || finding.hit.title) || "Saved web evidence";
  return {
    title,
    content,
    sourceUrl: finding.hit.url,
    sourceTitle: title,
    sourceService: finding.hit.source,
    retrievedAt: finding.page?.fetchedAt,
    publishedAt: finding.hit.publishedAt,
    keywords: Array.from(new Set([
      ...title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
      ...content.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
    ])).slice(0, 40),
  };
}
