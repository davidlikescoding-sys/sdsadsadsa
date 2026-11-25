/**
 * Single-slot in-process generation queue.
 *
 * This machine has four logical CPUs and one local diffusion binary. Running
 * two renders at once doubles memory pressure and slows both down, so every
 * generation request waits for the active job. Cancelling a waiting job removes
 * it immediately; cancelling the active job aborts its engine process. Job IDs
 * are client-scoped so one browser tab cannot stop another tab's render.
 */

interface ActiveJob {
  id: string;
  label: string;
  startedAt: number;
  controller: AbortController;
}

interface WaitingJob {
  id: string;
  label: string;
  signal?: AbortSignal;
  duplicateKey?: string;
  onAbort?: () => void;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
}

let active: ActiveJob | null = null;
const waiting: WaitingJob[] = [];
const inFlight = new Map<string, string>();

function rejectWaiting(job: WaitingJob, message: string): void {
  const index = waiting.indexOf(job);
  if (index >= 0) waiting.splice(index, 1);
  if (job.signal && job.onAbort) job.signal.removeEventListener("abort", job.onAbort);
  if (job.duplicateKey && inFlight.get(job.duplicateKey) === job.id) inFlight.delete(job.duplicateKey);
  job.reject(new Error(message));
}

function pump(): void {
  if (active || waiting.length === 0) return;
  const next = waiting.shift()!;
  if (next.signal?.aborted) {
    rejectWaiting(next, "Generation was cancelled while waiting in the queue.");
    pump();
    return;
  }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  // Keep both listeners attached through the handoff. An abort in this window
  // must either reject the waiting job or abort the promoted active job.
  if (next.signal) {
    next.signal.addEventListener("abort", forwardAbort, { once: true });
    if (next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
    next.onAbort = undefined;
  }
  if (next.signal?.aborted) {
    next.signal.removeEventListener("abort", forwardAbort);
    rejectWaiting(next, "Generation was cancelled while waiting in the queue.");
    pump();
    return;
  }
  active = {
    id: next.id,
    label: next.label,
    startedAt: Date.now(),
    controller,
  };
  let released = false;
  next.resolve(() => {
    if (released) return;
    released = true;
    next.signal?.removeEventListener("abort", forwardAbort);
    if (active?.id === next.id) {
      active = null;
      for (const [key, jobId] of inFlight) if (jobId === next.id) inFlight.delete(key);
    }
    pump();
  });
}

export function getGenerationQueueStatus(): { active: boolean; waiting: number; label: string | null } {
  return { active: Boolean(active), waiting: waiting.length, label: active?.label ?? null };
}

/** Reserves the single render slot. The returned function must always be called. */
export function acquireGenerationSlot(options: { id: string; label: string; signal?: AbortSignal; duplicateKey?: string }): Promise<() => void> {
  if (options.signal?.aborted) return Promise.reject(new Error("Generation was cancelled."));
  if (options.duplicateKey) {
    const existing = inFlight.get(options.duplicateKey);
    if (existing) return Promise.reject(new Error("An identical generation is already running. Wait for it or change a setting."));
    inFlight.set(options.duplicateKey, options.id);
  }
  return new Promise<() => void>((resolve, reject) => {
    const job: WaitingJob = {
      id: options.id,
      label: options.label,
      signal: options.signal,
      duplicateKey: options.duplicateKey,
      resolve,
      reject,
    };
    if (options.signal) {
      job.onAbort = () => rejectWaiting(job, "Generation was cancelled while waiting in the queue.");
      options.signal.addEventListener("abort", job.onAbort, { once: true });
    }
    waiting.push(job);
    pump();
  });
}

/**
 * Cancels a specific queued or active job. An omitted ID keeps the historical
 * global-cancel behaviour for internal callers; browser clients always pass an
 * ID so they cannot stop unrelated work.
 */
export function cancelGeneration(id?: string): "active" | "waiting" | null {
  if (id) {
    const queued = waiting.find((job) => job.id === id);
    if (queued) {
      rejectWaiting(queued, "Generation was cancelled while waiting in the queue.");
      pump();
      return "waiting";
    }
    if (active?.id === id) {
      active.controller.abort();
      return "active";
    }
    return null;
  }
  if (!active) return null;
  active.controller.abort();
  return "active";
}

/** Cancels the render that currently owns the local engine. */
export function cancelActiveGeneration(): boolean {
  return cancelGeneration() !== null;
}

/** Lets the route forward an external "cancel active job" request to its engine. */
export function getActiveSignal(): AbortSignal | null {
  return active?.controller.signal ?? null;
}

/** Test hook: clears a stalled queue after a server restart is simulated. */
export function resetGenerationQueue(): void {
  active = null;
  waiting.length = 0;
  inFlight.clear();
}
