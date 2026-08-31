/**
 * @file Horizontal scrollable tab strip with per-tab counts and edge-fade
 * scroll affordances. Extracted out of CcConfig.tsx — see SHA-167 — no
 * behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CcOverview } from "../../lib/api";
import { TABS } from "./types";
import type { TabKey } from "./types";

// ── Tabs ──────────────────────────────────────────────────────────────

interface TabsProps {
  current: TabKey;
  onSelect: (k: TabKey) => void;
  counts?: CcOverview["counts"];
}

export function Tabs({ current, onSelect, counts }: TabsProps) {
  const { t } = useTranslation("ccConfig");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Update scroll affordances when content size or scroll position changes.
  const updateAffordances = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateAffordances();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateAffordances, { passive: true });
    const ro = new ResizeObserver(updateAffordances);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateAffordances);
      ro.disconnect();
    };
  }, [updateAffordances]);

  // Scroll the active tab into view when it changes (e.g. user picks a tab
  // that's offscreen, or window resize hides the active one).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[data-tab-active="true"]');
    if (!active) return;
    const elRect = el.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.left < elRect.left + 8) {
      el.scrollBy({ left: activeRect.left - elRect.left - 16, behavior: "smooth" });
    } else if (activeRect.right > elRect.right - 8) {
      el.scrollBy({ left: activeRect.right - elRect.right + 16, behavior: "smooth" });
    }
  }, [current]);

  const scrollByButton = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.6), behavior: "smooth" });
  };

  const countFor = (key: TabKey): number | null => {
    if (!counts) return null;
    switch (key) {
      case "skills":
        return counts.skills.user + counts.skills.project;
      case "agents":
        return counts.agents.user + counts.agents.project;
      case "commands":
        return counts.commands.user + counts.commands.project;
      case "outputStyles":
        return counts.outputStyles.user + counts.outputStyles.project;
      case "plugins":
        return counts.plugins;
      case "marketplaces":
        return counts.marketplaces;
      case "keybindings":
        return counts.keybindings;
      case "mcp":
        return counts.mcpServers.user + counts.mcpServers.project;
      case "hooks":
        return Object.values(counts.hooks).reduce((a, b) => a + b, 0);
      case "settings":
        return counts.settingsFiles;
      case "memory":
        return counts.memory;
      default:
        return null;
    }
  };
  return (
    <div className="relative rounded-xl border border-border bg-surface-1">
      {/* Left edge gradient + chevron */}
      <div
        className={`pointer-events-none absolute left-0 top-0 bottom-0 w-12 rounded-l-xl bg-gradient-to-r from-surface-1 to-transparent transition-opacity z-10 ${
          canScrollLeft ? "opacity-100" : "opacity-0"
        }`}
      />
      {canScrollLeft && (
        <button
          onClick={() => scrollByButton(-1)}
          aria-label="scroll tabs left"
          className="absolute left-1 top-1/2 -translate-y-1/2 z-20 rounded-md w-7 h-7 flex items-center justify-center bg-surface-2 border border-border text-gray-300 hover:text-gray-100 hover:bg-surface-3"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      <div
        ref={scrollRef}
        className="flex gap-1 p-1 overflow-x-auto scroll-smooth [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {TABS.map(({ key, icon: Icon, i18nKey }) => {
          const c = countFor(key);
          const active = current === key;
          return (
            <button
              key={key}
              data-tab-active={active ? "true" : undefined}
              onClick={() => onSelect(key)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
                active
                  ? "bg-accent/15 text-accent border border-accent/30"
                  : "text-gray-400 hover:text-gray-200 hover:bg-surface-3 border border-transparent"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t(i18nKey)}</span>
              {c !== null && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                    active ? "bg-accent/20 text-accent" : "bg-surface-3 text-gray-400"
                  }`}
                >
                  {c}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Right edge gradient + chevron */}
      <div
        className={`pointer-events-none absolute right-0 top-0 bottom-0 w-12 rounded-r-xl bg-gradient-to-l from-surface-1 to-transparent transition-opacity z-10 ${
          canScrollRight ? "opacity-100" : "opacity-0"
        }`}
      />
      {canScrollRight && (
        <button
          onClick={() => scrollByButton(1)}
          aria-label="scroll tabs right"
          className="absolute right-1 top-1/2 -translate-y-1/2 z-20 rounded-md w-7 h-7 flex items-center justify-center bg-surface-2 border border-border text-gray-300 hover:text-gray-100 hover:bg-surface-3"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
