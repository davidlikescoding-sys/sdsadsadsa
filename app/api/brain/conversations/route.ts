import { deleteConversation, getBrainDb, listConversations } from "@/lib/brain/db";
import { persistBrainConversation } from "@/lib/brain/service";
import type { BrainConversation, BrainMessage } from "@/lib/brain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asConversation(value: unknown): BrainConversation {
  if (!value || typeof value !== "object") throw new Error("A conversation object is required.");
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !Array.isArray(raw.messages)) throw new Error("The conversation is missing an id or messages.");
  const now = new Date().toISOString();
  const messages: BrainMessage[] = raw.messages.flatMap((item): BrainMessage[] => {
    if (!item || typeof item !== "object") return [];
    const message = item as Record<string, unknown>;
    if (typeof message.content !== "string" || (message.role !== "user" && message.role !== "assistant" && message.role !== "system")) return [];
    return [{
      id: typeof message.id === "string" ? message.id : `${raw.id}-${Math.random().toString(36).slice(2)}`,
      role: message.role,
      content: message.content,
      createdAt: typeof message.timestamp === "string" ? message.timestamp : typeof message.createdAt === "string" ? message.createdAt : now,
      metadata: message.metadata && typeof message.metadata === "object" ? message.metadata as Record<string, unknown> : undefined,
    }];
  });
  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "New conversation",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    messages,
  };
}

export function GET() {
  try {
    return Response.json({ ok: true, conversations: listConversations(getBrainDb(), 500) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not list conversations." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { conversation?: unknown };
    const extraction = persistBrainConversation(asConversation(body.conversation));
    return Response.json({ ok: true, extraction });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not save the conversation." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return Response.json({ ok: false, error: "Provide a conversation id." }, { status: 400 });
    return Response.json({ ok: true, deleted: deleteConversation(getBrainDb(), id) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not delete the conversation." }, { status: 500 });
  }
}
