import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api, detectProvider } from "../api";
import ProviderBadge from "../components/ProviderBadge";

export default function FetchPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const detected = useMemo(() => detectProvider(url.trim()), [url]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    try {
      const { key } = await api.normalize(
        trimmed,
        detected ?? undefined,
      );
      navigate(`/playlist/${encodeURIComponent(key)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-16">
      <h1 className="text-3xl font-semibold tracking-tight text-white">
        Fetch a playlist
      </h1>
      <p className="mt-2 text-center text-sm text-slate-400">
        Paste a QQ Music or NetEase Cloud Music playlist URL below.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 w-full">
        <div className="relative">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://y.qq.com/n/ryqq/playlist/..."
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
          disabled={loading || !url.trim()}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Spinner />
              Fetching…
            </>
          ) : (
            "Fetch & Normalize"
          )}
        </button>
      </form>
    </div>
  );
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
