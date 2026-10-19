import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { api, detectProvider } from "../api";
import ProviderBadge from "../components/ProviderBadge";
import { useTasks } from "../tasks";
import type { PortablePlaylistFile } from "../types";

const DRAFT_KEY = "nq2am.fetchUrl";

export default function FetchPage() {
  const [url, setUrl] = useState(() =>
    typeof localStorage !== "undefined"
      ? (localStorage.getItem(DRAFT_KEY) ?? "")
      : "",
  );
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refresh, setActiveKey } = useTasks();
  const { t } = useTranslation("fetch");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detected = useMemo(() => detectProvider(url.trim()), [url]);

  function updateUrl(next: string) {
    setUrl(next);
    // Persist the draft so navigating away (e.g. to Settings) never loses it.
    if (next) {
      localStorage.setItem(DRAFT_KEY, next);
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    try {
      const { key } = await api.normalize(trimmed, detected ?? undefined);
      setActiveKey(key);
      await refresh();
      localStorage.removeItem(DRAFT_KEY);
      navigate(`/playlist/${encodeURIComponent(key)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so selecting the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;

    setError(null);
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(t("import.invalidJson"));
      }
      const portable = toPortableFile(parsed);
      const { key } = await api.importPlaylist(portable);
      setActiveKey(key);
      await refresh();
      navigate(`/playlist/${encodeURIComponent(key)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  const busy = loading || importing;

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-16">
      <h1 className="text-3xl font-semibold tracking-tight text-white">
        {t("title")}
      </h1>
      <p className="mt-2 text-center text-sm text-slate-400">
        {t("subtitle")}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 w-full">
        <div className="relative">
          <input
            type="url"
            value={url}
            onChange={(e) => updateUrl(e.target.value)}
            placeholder={t("placeholder")}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 pr-28 text-base text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            autoFocus
          />
          {detected && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <ProviderBadge provider={detected} />
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Spinner />
              {t("submitting")}
            </>
          ) : (
            t("submit")
          )}
        </button>
      </form>

      <div className="mt-6 flex w-full items-center gap-3 text-xs text-slate-500">
        <span className="h-px flex-1 bg-slate-700" />
        {t("or")}
        <span className="h-px flex-1 bg-slate-700" />
      </div>

      <div className="mt-6 w-full">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
        >
          {importing ? (
            <>
              <Spinner />
              {t("importing")}
            </>
          ) : (
            <>
              <UploadIcon />
              {t("importFile")}
            </>
          )}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          {t("importHelp")}
        </p>
      </div>
    </div>
  );
}

/**
 * Coerce parsed JSON into a portable playlist file. Accepts the
 * `nq2am-playlist` envelope or a bare `{ tracks }` object; missing fields
 * default so hand-written files still import. The server re-validates.
 */
function toPortableFile(parsed: unknown): PortablePlaylistFile {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const tracks = Array.isArray(obj.tracks) ? obj.tracks : [];
  const provider = obj.provider === "qq" || obj.provider === "netease" || obj.provider === "apple"
    ? obj.provider
    : "netease";
  return {
    format: "nq2am-playlist",
    version: 1,
    name: typeof obj.name === "string" ? obj.name : undefined,
    description: typeof obj.description === "string" ? obj.description : undefined,
    provider,
    tracks: tracks as PortablePlaylistFile["tracks"]
  };
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-white"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      className="h-4 w-4 text-slate-300"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
