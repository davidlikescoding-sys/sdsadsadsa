import { publicErrorMessage } from "@/lib/api-error";
import { modeStrategy } from "@/lib/brain/modes";
import { answerFromBrain } from "@/lib/brain/service";
import { ASSISTANT_MODES, type AssistantMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      question?: unknown; conversationId?: unknown; history?: unknown; mode?: unknown;
      systemStyle?: unknown; allowWeb?: unknown; strict?: unknown; useLocalModel?: unknown;
      useSemantic?: unknown; includeCorrections?: unknown; maxTokens?: unknown; temperature?: unknown;
    };
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (question.length < 2) return Response.json({ ok: false, error: "Provide a question." }, { status: 400 });
    const history = Array.isArray(body.history)
      ? body.history.filter((turn): turn is { role: string; content: string } =>
          !!turn && typeof turn === "object" && typeof (turn as { role?: unknown }).role === "string" && typeof (turn as { content?: unknown }).content === "string")
        : [];
    // Whitelist the mode; unknown values fall back to automatic routing.
    const mode = typeof body.mode === "string" && (ASSISTANT_MODES as readonly string[]).includes(body.mode)
      ? body.mode as AssistantMode
      : undefined;
    // Only a style string that the server itself defines is accepted. Unknown
    // client text is ignored and answerFromBrain falls back to the whitelisted
    // mode strategy, so a request cannot inject arbitrary prompt instructions.
    const requestedStyle = typeof body.systemStyle === "string" ? body.systemStyle.trim() : "";
    const knownStyles = new Set((ASSISTANT_MODES as readonly string[]).map((item) => modeStrategy(item as AssistantMode).style));
    const systemStyle = knownStyles.has(requestedStyle) ? requestedStyle : undefined;
    const result = await answerFromBrain({
      question,
      conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
      history,
      mode,
      systemStyle,
      allowWeb: body.allowWeb === true,
      // Only an explicit boolean overrides the mode's strictness.
      strict: typeof body.strict === "boolean" ? body.strict : undefined,
      useLocalModel: body.useLocalModel !== false,
      useSemantic: body.useSemantic !== false,
      includeCorrections: body.includeCorrections !== false,
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      signal: request.signal,
    });
    // This route never fetches the web. `strategy.allowWeb` is a permission
    // reported to the client only; real research stays in the chat client.
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ ok: false, error: publicErrorMessage(error, "Local answer failed.") }, { status: 500 });
  }
}
