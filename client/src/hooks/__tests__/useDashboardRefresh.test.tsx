/**
 * @file useDashboardRefresh.test.tsx
 * @description Verifies visibility gating, refresh coalescing, and stale-scope
 * protection while asynchronous dashboard requests are still running.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardRefresh } from "../useDashboardRefresh";

let visibility = "visible";
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function changeVisibility(value: string) {
  visibility = value;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}
beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility as DocumentVisibilityState
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("dashboard refresh scheduling", () => {
  it("pauses hidden polling and events, then refreshes once on return", async () => {
    const fetch = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDashboardRefresh(true, 10000, fetch));
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    changeVisibility("hidden");
    act(() => {
      result.current(false);
      result.current(true);
    });
    await advance(30000);
    expect(fetch).toHaveBeenCalledTimes(1);
    changeVisibility("visible");
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe(true);
  });
  it("does no work on an inactive tab and refreshes when selected", async () => {
    const fetch = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ enabled }) => useDashboardRefresh(enabled, 10000, fetch), {
      initialProps: { enabled: false },
    });
    await advance(30000);
    expect(fetch).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await advance(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("merges polling and event bursts without overlapping requests", async () => {
    let resolve!: () => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolve = r;
          })
      )
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useDashboardRefresh(true, 10000, fetch));
    await advance(0);
    act(() => {
      result.current(false);
      result.current(false);
    });
    await advance(10000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe(true);
  });
  it("rejects old scope responses and waits for the old batch before starting a new one", async () => {
    let resolve!: () => void;
    let isCurrent!: () => boolean;
    const first = vi.fn((_full, current) => {
      isCurrent = current;
      return new Promise<void>((r) => {
        resolve = r;
      });
    });
    const next = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ fetch }) => useDashboardRefresh(true, 10000, fetch), {
      initialProps: { fetch: first as (full: boolean, current: () => boolean) => Promise<void> },
    });
    await advance(0);
    rerender({ fetch: next });
    await advance(0);
    expect(isCurrent()).toBe(false);
    expect(next).not.toHaveBeenCalled();
    await act(async () => resolve());
    await advance(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
