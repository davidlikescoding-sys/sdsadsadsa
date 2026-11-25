export type LocalAnswerMode = "grounded" | "generated" | "fallback" | "experimental";

/**
 * Web lookup is a safety net, not a replacement for local answers. It runs only
 * when there is no local answer at all, or when a web attempt has not already
 * been made. Sandbox hypotheses deliberately stay local.
 */
export function shouldTryWebFallback(
  answerMode: LocalAnswerMode | null,
  webAttempted: boolean,
): boolean {
  if (webAttempted) return false;
  return answerMode === null || answerMode === "fallback";
}
