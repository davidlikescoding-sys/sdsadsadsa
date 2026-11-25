"use client";

import { useStore } from "@/lib/store";
import { isWebSearchEnabled } from "@/lib/brain/modes";
import { useSystemStatus } from "@/lib/use-system-status";
import { Badge } from "./ui";

export function SystemStatus() {
  const { settings } = useStore();
  const { online, brain } = useSystemStatus();

  const localActive = brain
    ? !!brain.localModel.executableReady && !!brain.localModel.modelReady && settings.useLocalLlm
    : null;
  // Lexical memory retrieval works even when the local chat model is off.
  const memoryActive = brain ? !!brain.ready : null;
  // This badge uses the same explicit gate as chat: Web Search toggle or an
  // explicitly chosen Research mode, and never while known-offline. It describes
  // permission only — real research is shown in the chat activity panel.
  const webPermitted = isWebSearchEnabled(settings, online);
  const webState: "off" | "enabled" | "blocked" = online === false && settings.webSearch
    ? "blocked" : webPermitted ? "enabled" : "off";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1" aria-label="System status">
      <Badge tone={online === true ? "green" : online === false ? "red" : "amber"}>
        {online === true ? "ONLINE" : online === false ? "OFFLINE" : "CHECKING"}
      </Badge>
      <Badge tone={localActive === true ? "green" : "amber"}>
        {localActive === null ? "LOCAL MODEL CHECKING" : localActive ? "LOCAL MODEL ACTIVE" : "LOCAL MODEL OFF"}
      </Badge>
      <Badge tone={memoryActive === true ? "green" : "amber"}>
        {memoryActive === null ? "MEMORY RETRIEVAL CHECKING" : memoryActive ? "MEMORY RETRIEVAL ACTIVE" : "MEMORY RETRIEVAL OFF"}
      </Badge>
      <Badge tone={webState === "enabled" ? "green" : webState === "blocked" ? "red" : "neutral"}>
        {webState === "enabled" ? "WEB SEARCH ENABLED" : webState === "blocked" ? "WEB SEARCH BLOCKED · OFFLINE" : "WEB SEARCH OFF"}
      </Badge>
    </div>
  );
}
