/**
 * @file useDashboardRefresh.ts
 * @description Coordinates visible dashboard refreshes, merging event and polling
 * requests without overlapping batches or applying responses from an old scope.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */
import { useCallback, useEffect, useRef } from "react";

export function useDashboardRefresh(
  enabled: boolean,
  intervalMs: number,
  fetchData: (full: boolean, isCurrent: () => boolean) => Promise<void>
) {
  const running = useRef<Promise<void> | null>(null);
  const requestRef = useRef<(full: boolean) => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let fullPending = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRun = -Infinity;
    let visibilityEpoch = 0;
    const visible = () => !disposed && enabled && document.visibilityState === "visible";
    const drain = async () => {
      timer = undefined;
      if (!visible() || !pending) return;
      if (running.current) {
        await running.current;
        if (visible() && pending) schedule();
        return;
      }
      const full = fullPending;
      pending = fullPending = false;
      lastRun = Date.now();
      const epoch = visibilityEpoch;
      const task = Promise.resolve()
        .then(() => fetchData(full, () => visible() && epoch === visibilityEpoch))
        .catch(() => {});
      running.current = task;
      await task;
      if (running.current === task) running.current = null;
      if (visible() && pending) schedule();
    };
    const schedule = () => {
      if (!visible() || timer !== undefined) return;
      timer = setTimeout(() => void drain(), Math.max(0, 2000 - (Date.now() - lastRun)));
    };
    const request = (full: boolean) => {
      if (!visible()) return;
      pending = true;
      fullPending ||= full;
      schedule();
    };
    requestRef.current = request;
    const onVisibility = () => {
      visibilityEpoch++;
      if (interval !== undefined) clearInterval(interval);
      interval = undefined;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = fullPending = false;
      if (visible()) {
        interval = setInterval(() => request(true), intervalMs);
        lastRun = -Infinity;
        request(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      if (interval !== undefined) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, fetchData]);
  return useCallback((full = true) => requestRef.current(full), []);
}
