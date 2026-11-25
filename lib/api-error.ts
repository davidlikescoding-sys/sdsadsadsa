/**
 * Converts unexpected server errors into stable, non-leaky client messages.
 * Validation errors are returned directly by routes before this helper is used;
 * anything reaching here may contain filesystem paths or subprocess details, so
 * it is logged locally and replaced with a safe fallback.
 */
export function publicErrorMessage(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error("[DavidAI]", detail);
  return fallback;
}
