"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

export function ToastHost() {
  const { activity, hydrated } = useStore();
  const latest = activity[0];
  const seenRef = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!latest) { seenRef.current = null; return; }
    if (!seenRef.current) { seenRef.current = latest.id; return; }
    if (seenRef.current === latest.id) return;
    seenRef.current = latest.id;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 4200);
    return () => window.clearTimeout(timer);
  }, [latest, hydrated]);

  const isError = latest?.type === "error";
  const tone = latest?.type === "error" ? "luxe-toast--error"
    : latest?.type === "warning" ? "luxe-toast--warning"
    : latest?.type === "success" ? "luxe-toast--success"
    : "";

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[90] max-w-sm"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {visible && latest && (
        <div className={`luxe-toast pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 ${tone}`}>
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
          <p className="flex-1 text-xs leading-relaxed">{latest.message}</p>
          <button onClick={() => setVisible(false)} className="focus-ring rounded px-1 text-current opacity-60 hover:opacity-100" aria-label="Dismiss notification">×</button>
        </div>
      )}
    </div>
  );
}
