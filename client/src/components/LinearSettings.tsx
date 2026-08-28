/**
 * @file LinearSettings.tsx
 * @description Settings-page panel for the Linear API key that powers session
 * ticket linking (see LinearLinkPanel.tsx on Session Detail). The key is
 * write-only from the client's perspective: the server never echoes it back,
 * only a `configured` boolean, matching the pattern webhook secrets/URLs use.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, Loader2 } from "lucide-react";
import { api } from "../lib/api";

export function LinearSettings() {
  const { t } = useTranslation("settings");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.linear
      .getConfig()
      .then((res) => setConfigured(res.configured))
      .catch(() => setConfigured(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.linear.setConfig(apiKey.trim());
      setConfigured(res.configured);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.linear.clearConfig();
      setConfigured(res.configured);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-gray-200">{t("linear.title", "Linear")}</h3>
        <p className="text-xs text-gray-500 mt-1">
          {t(
            "linear.description",
            "Link dashboard sessions to Linear issues from Session Detail — paste an issue URL or auto-detect one from the session's git branch. Read-only: nothing is written back to Linear."
          )}
        </p>
      </div>

      {configured && (
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <CheckCircle className="w-3.5 h-3.5" />
          {t("linear.configured", "API key configured")}
        </div>
      )}

      <form onSubmit={handleSave} className="flex items-center gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            configured
              ? t("linear.replacePlaceholder", "Enter a new key to replace it")
              : t("linear.placeholder", "Linear personal API key")
          }
          disabled={busy}
          autoComplete="off"
          className="flex-1 max-w-sm text-xs bg-surface-2 border border-border rounded px-2.5 py-1.5 outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !apiKey.trim()}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("linear.save", "Save")}
        </button>
        {configured && (
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="btn-ghost text-xs px-3 py-1.5 disabled:opacity-50"
          >
            {t("linear.clear", "Clear")}
          </button>
        )}
      </form>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
