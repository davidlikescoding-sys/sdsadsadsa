import { describe, expect, it } from "vitest";
import { createConversation, recentTurns, titleFromMessage } from "./chat";
import type { ChatMessage } from "./types";

function message(id: string, role: "user" | "assistant", content: string): ChatMessage {
  return { id, role, content, timestamp: "2026-01-01T00:00:00.000Z" };
}

describe("conversation helpers", () => {
  it("creates isolated conversations with unique ids", () => {
    const a = createConversation();
    const b = createConversation();
    expect(a.id).not.toBe(b.id);
    expect(a.messages).toEqual([]);
    expect(a.title).toBe("New conversation");
  });

  it("titles a conversation from its first user message", () => {
    expect(titleFromMessage("  What   is RAG?\n")).toBe("What is RAG?");
    expect(titleFromMessage("   ")).toBe("New conversation");
    expect(titleFromMessage("a".repeat(80))).toHaveLength(43);
  });

  it("keeps only recent non-empty turns from one conversation", () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      message(`m${i}`, i % 2 === 0 ? "user" : "assistant", `turn ${i}`),
    );
    messages.push(message("empty", "assistant", "   "));
    const turns = recentTurns(messages, 4);
    expect(turns).toEqual([
      { role: "user", content: "turn 6" },
      { role: "assistant", content: "turn 7" },
      { role: "user", content: "turn 8" },
      { role: "assistant", content: "turn 9" },
    ]);
  });
});
