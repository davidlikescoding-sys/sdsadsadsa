export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A tiny unauthenticated connectivity check. It is not an AI request and it
 * never reports research activity; it only answers whether the network works.
 */
export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch("https://example.com/", {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    void response;
    return Response.json({ ok: true, online: true, checkedAt });
  } catch {
    return Response.json({ ok: true, online: false, checkedAt });
  }
}
