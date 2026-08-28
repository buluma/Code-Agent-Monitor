/**
 * @file LinearLinkPanel.tsx
 * @description Session Detail panel for linking a session to a Linear issue:
 * shows the linked issue (title/state/url) read-only when one exists, or a
 * paste-URL input plus a "detect from branch" button when it doesn't. Scoped
 * to Linear only — no Jira or GitHub Issues. Self-contained: fetches its own
 * link state from `/api/linear/sessions/{id}/link` so SessionDetail only
 * needs to mount it.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as LinkIcon, ExternalLink, GitBranch, X, Loader2 } from "lucide-react";
import { Link as RouterLink } from "react-router";
import { api } from "../lib/api";
import type { LinearLink } from "../lib/api";

interface LinearLinkPanelProps {
  sessionId: string;
}

export function LinearLinkPanel({ sessionId }: LinearLinkPanelProps) {
  const { t } = useTranslation("sessions");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [link, setLink] = useState<LinearLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.linear.getConfig(), api.linear.getLink(sessionId)])
      .then(([configRes, linkRes]) => {
        if (cancelled) return;
        setConfigured(configRes.configured);
        setLink(linkRes.link);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleLinkByUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!urlInput.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.linear.link(sessionId, { url: urlInput.trim() });
      setLink(res.link);
      setUrlInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoDetect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.linear.link(sessionId, { auto: true });
      setLink(res.link);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink() {
    if (busy) return;
    setBusy(true);
    try {
      await api.linear.unlink(sessionId);
      setLink(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  // No API key configured — a quiet pointer to Settings rather than a form
  // that would just fail on submit.
  if (!configured) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" />
        <span>{t("linear.notConfigured")}</span>
        <RouterLink to="/settings" className="text-accent hover:underline">
          {t("linear.configureLink")}
        </RouterLink>
      </div>
    );
  }

  if (link) {
    return (
      <div className="flex items-center gap-1.5 text-xs bg-surface-2 px-2 py-1 rounded">
        <LinkIcon className="w-3 h-3 text-gray-500 flex-shrink-0" />
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-accent hover:underline min-w-0"
        >
          <span className="font-mono flex-shrink-0">{link.identifier}</span>
          {link.title && <span className="truncate max-w-[16rem]">{link.title}</span>}
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
        {link.state && <span className="text-gray-500 flex-shrink-0">· {link.state}</span>}
        <button
          type="button"
          onClick={handleUnlink}
          disabled={busy}
          title={t("linear.unlink")}
          aria-label={t("linear.unlink")}
          className="text-gray-500 hover:text-gray-300 flex-shrink-0 disabled:opacity-50"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <form onSubmit={handleLinkByUrl} className="flex items-center gap-2">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder={t("linear.pastePlaceholder")}
          disabled={busy}
          className="flex-1 max-w-xs text-xs bg-surface-2 border border-border rounded px-2 py-1 outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !urlInput.trim()}
          className="btn-ghost text-xs px-2 py-1 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : t("linear.link")}
        </button>
        <button
          type="button"
          onClick={handleAutoDetect}
          disabled={busy}
          title={t("linear.autoDetect")}
          className="btn-ghost text-xs px-2 py-1 inline-flex items-center gap-1 disabled:opacity-50"
        >
          <GitBranch className="w-3 h-3" />
          {t("linear.autoDetect")}
        </button>
      </form>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
