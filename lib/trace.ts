/**
 * Real processing trace. Every stage is recorded around an operation that
 * actually runs in the answer pipeline. Nothing here is a scripted animation:
 * if retrieval or generation did not execute, there is no stage for it.
 */

export type TraceStatus = "success" | "failed" | "skipped";

export interface TraceStage {
  id: string;
  index: number;
  name: string;
  action: string;
  sources: string[];
  retrieved: string[];
  startedAt: string;
  durationMs: number;
  status: TraceStatus;
  note?: string;
}

export interface ReasoningApproach {
  name: string;
  selected: boolean;
  reason: string;
  score?: number;
}

export interface ReasoningSummary {
  concepts: string[];
  approaches: ReasoningApproach[];
  selected: string;
  uncertainties: string[];
  construction: string;
}

export interface ActivityRun {
  id: string;
  label: string;
  mode: "grounded" | "experimental";
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  status: "running" | "complete" | "failed";
  stages: TraceStage[];
  reasoning?: ReasoningSummary;
  answer?: string;
}

export interface StageOutcome<T> {
  value: T;
  retrieved?: string[];
  note?: string;
  status?: TraceStatus;
}

function now(): string { return new Date().toISOString(); }
function id(): string { return `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class TraceRecorder {
  readonly run: ActivityRun;
  private readonly started = performance.now();
  private readonly onUpdate?: (run: ActivityRun) => void;

  constructor(label: string, mode: "grounded" | "experimental", onUpdate?: (run: ActivityRun) => void) {
    this.onUpdate = onUpdate;
    this.run = {
      id: id(), label: label.slice(0, 200), mode, startedAt: now(), durationMs: 0,
      status: "running", stages: [],
    };
    this.emit();
  }

  private emit(): void {
    this.run.durationMs = Math.max(0, Math.round(performance.now() - this.started));
    this.onUpdate?.(clone(this.run));
  }

  private add(
    name: string,
    action: string,
    sources: string[],
    outcome: Partial<StageOutcome<unknown>>,
    durationMs: number,
    status: TraceStatus,
  ): void {
    this.run.stages.push({
      id: id(), index: this.run.stages.length + 1, name, action,
      sources: sources.slice(),
      retrieved: (outcome.retrieved ?? []).slice(0, 6),
      startedAt: now(),
      durationMs: Math.max(0, Math.round(durationMs)),
      status,
      note: outcome.note?.slice(0, 240),
    });
    this.emit();
  }

  /** Wrap a synchronous operation so its timing and result are recorded honestly. */
  runStage<T>(name: string, action: string, sources: string[], fn: () => StageOutcome<T>): T {
    const start = performance.now();
    try {
      const outcome = fn();
      this.add(name, action, sources, outcome, performance.now() - start, outcome.status ?? "success");
      return outcome.value;
    } catch (error) {
      this.add(name, action, sources, { value: undefined as T, note: error instanceof Error ? error.message : String(error) }, performance.now() - start, "failed");
      throw error;
    }
  }

  async runAsyncStage<T>(name: string, action: string, sources: string[], fn: () => Promise<StageOutcome<T>>): Promise<T> {
    const start = performance.now();
    try {
      const outcome = await fn();
      this.add(name, action, sources, outcome, performance.now() - start, outcome.status ?? "success");
      return outcome.value;
    } catch (error) {
      this.add(name, action, sources, { value: undefined as T, note: error instanceof Error ? error.message : String(error) }, performance.now() - start, "failed");
      throw error;
    }
  }

  skip(name: string, action: string, reason: string): void {
    this.add(name, action, [], { value: null, note: reason }, 0, "skipped");
  }

  finish(answer: string, reasoning: ReasoningSummary, status: "complete" | "failed" = "complete"): ActivityRun {
    this.run.answer = answer.slice(0, 600);
    this.run.reasoning = reasoning;
    this.run.status = status;
    this.run.finishedAt = now();
    this.emit();
    return clone(this.run);
  }
}
