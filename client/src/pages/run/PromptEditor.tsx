/**
 * @file The prompt textarea with slash-command / @-file autocomplete: match
 * scoring, cursor-position trigger detection, and the dropdown UI itself.
 * Extracted out of Run.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, FileCode, Slash as SlashIcon } from "lucide-react";
import { api } from "../../lib/api";
import type { SlashCommand } from "./slashCommands";

function commandSourceLabel(s: SlashCommand["source"]): string {
  return s === "builtin"
    ? "CLI only"
    : s === "user"
      ? "user"
      : s === "project"
        ? "project"
        : "plugin";
}

function commandSourceTone(s: SlashCommand["source"]): string {
  return s === "builtin"
    ? "bg-gray-500/10 text-gray-400 border-gray-500/30"
    : s === "user"
      ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
      : s === "project"
        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
        : "bg-violet-500/10 text-violet-300 border-violet-500/30";
}

// ── Autocomplete dropdown for slash + @-files ─────────────────────────

interface AutocompleteState {
  kind: "slash" | "file";
  query: string;
  // The position in the textarea where the trigger character starts (so we
  // can replace from there to the cursor on selection).
  triggerStart: number;
  cursor: number;
}

/**
 * Tiered slash-command match scoring. Higher = more relevant. Returns 0 for
 * "doesn't match, hide it." Tiers in descending priority:
 *   1. Exact name match
 *   2. Name starts with query
 *   3. Word boundary (after `-` / `_` / `.`) starts with query
 *   4. Name contains query (earlier index ranks higher)
 *   5. Subsequence match across the name
 *   6. Description contains query - only when query is at least 3 chars,
 *      so a single keystroke can't drag in tangential descriptions.
 */
function scoreSlashMatch(name: string, description: string | undefined, q: string): number {
  if (!q) return 1;
  const n = name.toLowerCase();
  if (n === q) return 1000;
  if (n.startsWith(q)) return 800 - Math.min(n.length, 100);
  const parts = n.split(/[-_.\s]/);
  if (parts.some((p) => p.startsWith(q))) {
    return 600 - Math.min(n.length, 100);
  }
  const idx = n.indexOf(q);
  if (idx >= 0) return 400 - Math.min(idx, 100);
  if (subsequenceMatch(n, q)) return 200;
  if (q.length >= 3) {
    const d = (description || "").toLowerCase();
    if (d.includes(q)) return 100;
  }
  return 0;
}

function subsequenceMatch(s: string, q: string): boolean {
  let i = 0;
  for (let k = 0; k < s.length && i < q.length; k++) {
    if (s[k] === q[i]) i++;
  }
  return i === q.length;
}

function detectAutocomplete(value: string, cursor: number): AutocompleteState | null {
  // Look back from the cursor to find the active "token". A token starts at
  // the beginning of the line / after whitespace and continues until cursor.
  let start = cursor;
  while (start > 0) {
    const ch = value[start - 1];
    if (!ch || /\s/.test(ch)) break;
    start--;
  }
  const tok = value.slice(start, cursor);
  if (tok.startsWith("/") && tok.length >= 1) {
    // Only trigger for slash if it's at line start OR right after whitespace.
    // The detection above already enforces that.
    return { kind: "slash", query: tok.slice(1), triggerStart: start, cursor };
  }
  if (tok.startsWith("@") && tok.length >= 1) {
    return { kind: "file", query: tok.slice(1), triggerStart: start, cursor };
  }
  return null;
}

interface PromptEditorProps {
  value: string;
  onChange: (s: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  slashCommands: SlashCommand[];
  fileCwd: string;
  autoFocus?: boolean;
}

export function PromptEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 4,
  slashCommands,
  fileCwd,
  autoFocus,
}: PromptEditorProps) {
  const { t } = useTranslation("run");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [state, setState] = useState<AutocompleteState | null>(null);
  const [active, setActive] = useState(0);
  const [fileSuggestions, setFileSuggestions] = useState<string[]>([]);
  const fileFetchRef = useRef<{ q: string; t: number } | null>(null);

  // Slash filter - tiered scoring so prefix matches outrank arbitrary
  // substring hits, name matches outrank description matches, and shorter
  // names break ties when scores are equal.
  const slashItems = useMemo(() => {
    if (!state || state.kind !== "slash") return [] as SlashCommand[];
    const q = state.query.toLowerCase();
    const sourceOrder = { project: 0, user: 1, plugin: 2, builtin: 3 } as const;
    if (!q) {
      return [...slashCommands].sort(
        (a, b) => sourceOrder[a.source] - sourceOrder[b.source] || a.name.localeCompare(b.name)
      );
    }
    type Scored = { cmd: SlashCommand; score: number };
    const scored: Scored[] = [];
    for (const cmd of slashCommands) {
      const score = scoreSlashMatch(cmd.name, cmd.description, q);
      if (score > 0) scored.push({ cmd, score });
    }
    return scored
      .sort(
        (a, b) =>
          b.score - a.score ||
          sourceOrder[a.cmd.source] - sourceOrder[b.cmd.source] ||
          a.cmd.name.length - b.cmd.name.length ||
          a.cmd.name.localeCompare(b.cmd.name)
      )
      .map((s) => s.cmd);
  }, [state, slashCommands]);

  // File fetch (debounced)
  useEffect(() => {
    if (!state || state.kind !== "file") return;
    const ts = Date.now();
    fileFetchRef.current = { q: state.query, t: ts };
    const tid = setTimeout(() => {
      if (fileFetchRef.current?.t !== ts) return;
      api.run
        .files(fileCwd, state.query)
        .then((r) => setFileSuggestions(r.items))
        .catch(() => setFileSuggestions([]));
    }, 120);
    return () => clearTimeout(tid);
  }, [state, fileCwd]);

  const items = state?.kind === "file" ? fileSuggestions : slashItems;

  useEffect(() => {
    if (active >= items.length) setActive(Math.max(0, items.length - 1));
  }, [items.length, active]);

  const insertChoice = (choice: SlashCommand | string) => {
    if (!state || !taRef.current) return;
    const ta = taRef.current;
    const before = value.slice(0, state.triggerStart);
    const after = value.slice(state.cursor);
    let inserted: string;
    if (state.kind === "slash") {
      const c = choice as SlashCommand;
      inserted = `/${c.name}`;
    } else {
      inserted = `@${choice as string}`;
    }
    const next = before + inserted + (after.startsWith(" ") || after === "" ? "" : " ") + after;
    onChange(next);
    setState(null);
    setActive(0);
    // Re-position cursor after the inserted token + a trailing space
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (state && items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(items.length - 1, a + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const choice = items[active];
        if (choice) insertChoice(choice);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const choice = items[active];
        if (choice) insertChoice(choice);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setState(null);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
    }
  };

  const onTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    const ta = e.target;
    const next = detectAutocomplete(ta.value, ta.selectionStart || 0);
    setState(next);
    if (!next) setActive(0);
  };

  const onSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const next = detectAutocomplete(ta.value, ta.selectionStart || 0);
    setState(next);
  };

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        autoFocus={autoFocus}
        value={value}
        onChange={onTextareaInput}
        onKeyDown={onKeyDown}
        onSelect={onSelect}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-accent/50 resize-y font-sans leading-relaxed"
      />
      {state && (
        <div className="absolute z-30 left-0 right-0 bottom-full mb-1 rounded-md border border-border bg-surface-1 shadow-lg shadow-black/40 max-h-72 overflow-auto py-1">
          <div className="px-3 py-1.5 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-gray-500 inline-flex items-center gap-1.5">
            {state.kind === "slash" ? (
              <>
                <SlashIcon className="w-3 h-3" />
                {t("autocomplete.slashHint")}
              </>
            ) : (
              <>
                <AtSign className="w-3 h-3" />
                {t("autocomplete.fileHint")}
              </>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-gray-500">{t("autocomplete.noMatches")}</div>
          ) : state.kind === "slash" ? (
            (items as SlashCommand[]).map((c, idx) => (
              <button
                key={`${c.source}:${c.name}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertChoice(c)}
                onMouseEnter={() => setActive(idx)}
                className={`w-full text-left px-3 py-1.5 transition-colors ${
                  idx === active ? "bg-accent/15" : "hover:bg-surface-3"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-gray-100">/{c.name}</span>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${commandSourceTone(c.source)}`}
                  >
                    {commandSourceLabel(c.source)}
                  </span>
                </div>
                {c.description && (
                  <div className="text-[10.5px] text-gray-500 truncate mt-0.5">{c.description}</div>
                )}
              </button>
            ))
          ) : (
            (items as string[]).map((p, idx) => (
              <button
                key={p}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertChoice(p)}
                onMouseEnter={() => setActive(idx)}
                className={`w-full text-left px-3 py-1.5 transition-colors flex items-center gap-2 ${
                  idx === active ? "bg-accent/15" : "hover:bg-surface-3"
                }`}
              >
                <FileCode className="w-3 h-3 text-gray-500 flex-shrink-0" />
                <span className="font-mono text-[11px] text-gray-200 truncate">{p}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
