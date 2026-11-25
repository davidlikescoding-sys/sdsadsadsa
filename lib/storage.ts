const PREFIX = "davidai:";

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`Failed to read ${key}`, e);
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: false, error: "No browser storage available." };
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`Failed to write ${key}`, e);
    return { ok: false, error: error.includes("quota") ? "Browser storage is full. Delete old checkpoints or datasets." : error };
  }
}

export function removeLocal(key: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

export function listLocalKeys(): string[] {
  if (typeof window === "undefined") return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
    }
  } catch { /* ignore */ }
  return keys;
}

/** Stable content fingerprint used for duplicate dataset detection. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
