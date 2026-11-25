import { afterEach, describe, expect, it } from "vitest";
import {
  acquireGenerationSlot, cancelActiveGeneration, cancelGeneration, getActiveSignal,
  getGenerationQueueStatus, resetGenerationQueue,
} from "./generation-queue";

afterEach(() => {
  resetGenerationQueue();
});

describe("local generation queue", () => {
  it("runs one render at a time and promotes the next waiting job", async () => {
    resetGenerationQueue();
    const releaseFirst = await acquireGenerationSlot({ id: "first", label: "first render" });
    let promoted = false;
    const second = acquireGenerationSlot({ id: "second", label: "second render" }).then((release) => {
      promoted = true;
      return release;
    });
    await Promise.resolve();

    expect(getGenerationQueueStatus()).toMatchObject({ active: true, waiting: 1, label: "first render" });
    expect(promoted).toBe(false);

    releaseFirst();
    const releaseSecond = await second;
    expect(promoted).toBe(true);
    expect(getGenerationQueueStatus()).toMatchObject({ active: true, waiting: 0, label: "second render" });

    releaseSecond();
    expect(getGenerationQueueStatus()).toMatchObject({ active: false, waiting: 0, label: null });
  });

  it("rejects an identical in-flight request", async () => {
    resetGenerationQueue();
    const release = await acquireGenerationSlot({
      id: "original",
      label: "original",
      duplicateKey: "same-prompt-and-settings",
    });
    await expect(acquireGenerationSlot({
      id: "duplicate",
      label: "duplicate",
      duplicateKey: "same-prompt-and-settings",
    })).rejects.toThrow(/identical generation is already running/i);
    expect(getGenerationQueueStatus().waiting).toBe(0);
    release();
  });

  it("cancels a waiting job without touching the active render", async () => {
    resetGenerationQueue();
    const release = await acquireGenerationSlot({ id: "active", label: "active" });
    const controller = new AbortController();
    const waiting = acquireGenerationSlot({
      id: "waiting",
      label: "waiting",
      signal: controller.signal,
    });
    expect(getGenerationQueueStatus().waiting).toBe(1);

    controller.abort();
    await expect(waiting).rejects.toThrow(/cancelled while waiting/i);
    expect(getGenerationQueueStatus()).toMatchObject({ active: true, waiting: 0 });

    release();
    expect(getGenerationQueueStatus().active).toBe(false);
  });

  it("cancels only the requested job and lets the next job take the slot", async () => {
    resetGenerationQueue();
    const releaseFirst = await acquireGenerationSlot({ id: "tab-a", label: "tab A render" });
    const second = acquireGenerationSlot({ id: "tab-b", label: "tab B render" });
    expect(getGenerationQueueStatus()).toMatchObject({ active: true, waiting: 1, label: "tab A render" });

    expect(cancelGeneration("tab-a")).toBe("active");
    // The aborted route releases its slot in its finally block.
    releaseFirst();
    const releaseSecond = await second;
    expect(getGenerationQueueStatus()).toMatchObject({ active: true, waiting: 0, label: "tab B render" });
    expect(getActiveSignal()?.aborted).toBe(false);

    expect(cancelGeneration("tab-b")).toBe("active");
    expect(getActiveSignal()?.aborted).toBe(true);
    expect(cancelGeneration("not-a-job")).toBeNull();
    releaseSecond();
  });

  it("exposes an abort signal for the active engine process", async () => {
    resetGenerationQueue();
    const release = await acquireGenerationSlot({ id: "engine-job", label: "engine job" });
    const signal = getActiveSignal();
    expect(signal).toBeInstanceOf(AbortSignal);
    let aborted = false;
    signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
    expect(cancelActiveGeneration()).toBe(true);
    expect(aborted).toBe(true);
    release();
    expect(cancelActiveGeneration()).toBe(false);
  });
});
