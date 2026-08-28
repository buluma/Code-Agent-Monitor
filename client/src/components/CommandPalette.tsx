/**
 * @file CommandPalette.tsx
 * @description Keyboard-driven jump-to overlay (Cmd+K on macOS, Ctrl+K
 * elsewhere): a single search box that filters the static primary navigation
 * (mirrored from Sidebar's NAV_KEYS) client-side and, once the query is long
 * enough, searches sessions server-side via the existing free-text `q` filter
 * on `GET /api/sessions` — no new endpoint. Selecting a result navigates and
 * closes the palette; Escape or a backdrop click also closes it.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Search, FolderOpen } from "lucide-react";
import { NAV_KEYS } from "./Sidebar";
import { SessionStatusBadge } from "./StatusBadge";
import { api } from "../lib/api";
import type { Session } from "../lib/types";
import { effectiveSessionStatus, sessionAwaitingReason } from "../lib/types";

/** Minimum query length before a session search request fires — keeps the
 *  palette from hammering the API on every keystroke of a one-letter query. */
const MIN_SESSION_QUERY_LENGTH = 2;
const SESSION_RESULT_LIMIT = 8;
const DEBOUNCE_MS = 150;

interface NavResult {
  kind: "nav";
  to: string;
  label: string;
  Icon: (typeof NAV_KEYS)[number]["icon"];
}

interface SessionResult {
  kind: "session";
  session: Session;
}

type PaletteResult = NavResult | SessionResult;

/** Global Cmd+K / Ctrl+K palette. Mount once at the app root (in Layout). */
export function CommandPalette() {
  const { t } = useTranslation("nav");
  const { t: tCommon } = useTranslation("common");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sessionResults, setSessionResults] = useState<Session[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSessionResults([]);
    setActiveIndex(0);
  }, []);

  // Global shortcut: Cmd+K (macOS) / Ctrl+K (others). Ignored while a native
  // text input already has focus AND the palette is closed, so it never steals
  // a keystroke from a text field — except to open on the shortcut itself.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  const navResults: NavResult[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NAV_KEYS.map(({ to, icon, key }) => ({
      kind: "nav" as const,
      to,
      // key is "nav:xyz" — strip the namespace prefix already implied by
      // useTranslation("nav") above.
      label: t(key.replace(/^nav:/, "")),
      Icon: icon,
    })).filter((r) => !q || r.label.toLowerCase().includes(q));
  }, [query, t]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < MIN_SESSION_QUERY_LENGTH) {
      setSessionResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await api.sessions.list({ q, limit: SESSION_RESULT_LIMIT });
        setSessionResults(res.sessions);
      } catch {
        // Best-effort search — a failed fetch just means fewer results, not
        // an error state worth surfacing in a lightweight jump-to overlay.
        setSessionResults([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const results: PaletteResult[] = useMemo(
    () => [
      ...navResults,
      ...sessionResults.map((session) => ({ kind: "session" as const, session })),
    ],
    [navResults, sessionResults]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [results.length]);

  const select = useCallback(
    (result: PaletteResult) => {
      navigate(result.kind === "nav" ? result.to : `/sessions/${result.session.id}`);
      close();
    },
    [navigate, close]
  );

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = results[activeIndex];
      if (result) select(result);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60] flex items-start justify-center pt-[15vh] p-4"
      onClick={close}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-surface-1 shadow-xl shadow-black/40 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={tCommon("commandPalette.title", "Jump to")}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={tCommon("commandPalette.placeholder", "Search sessions and pages...")}
            className="flex-1 bg-transparent outline-none text-sm text-gray-100 placeholder:text-gray-500"
            aria-label={tCommon("commandPalette.title", "Jump to")}
          />
          <kbd className="text-[10px] text-gray-500 border border-border rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-gray-500">
              {tCommon("commandPalette.empty", "No matches")}
            </div>
          )}
          {results.map((result, i) => {
            const key = result.kind === "nav" ? `nav-${result.to}` : `session-${result.session.id}`;
            const active = i === activeIndex;
            return (
              <button
                key={key}
                type="button"
                onClick={() => select(result)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${
                  active ? "bg-surface-2 text-gray-100" : "text-gray-300"
                }`}
              >
                {result.kind === "nav" ? (
                  <>
                    <result.Icon className="w-4 h-4 flex-shrink-0 text-gray-500" />
                    <span className="truncate">{result.label}</span>
                  </>
                ) : (
                  <>
                    <FolderOpen className="w-4 h-4 flex-shrink-0 text-gray-500" />
                    <span className="truncate flex-1">
                      {result.session.name || result.session.id}
                    </span>
                    <span className="flex-shrink-0">
                      <SessionStatusBadge
                        status={effectiveSessionStatus(result.session)}
                        reason={sessionAwaitingReason(result.session)}
                        provider={result.session.provider}
                        compact
                      />
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
