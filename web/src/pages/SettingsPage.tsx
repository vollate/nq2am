import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import MatchingSettings from "../components/MatchingSettings";
import ProviderBadge from "../components/ProviderBadge";
import type { MusicProvider } from "../types";

const PROVIDERS: { id: MusicProvider; name: string; description: string }[] = [
  {
    id: "qq",
    name: "QQ Music",
    description: "Log in to access private playlists on y.qq.com.",
  },
  {
    id: "netease",
    name: "NetEase Cloud Music",
    description: "Log in to access private playlists on music.163.com.",
  },
  {
    id: "apple",
    name: "Apple Music",
    description: "Log in to search, match tracks, and create playlists on music.apple.com.",
  },
];

export default function SettingsPage() {
  const { status, error: authError, setStatus } = useAuth();
  const [pending, setPending] = useState<MusicProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(provider: MusicProvider) {
    setError(null);
    setPending(provider);
    try {
      const connected = status?.[provider] === true;
      const next = connected
        ? await api.logout(provider)
        : await api.login(provider);
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Connect your music accounts to fetch private playlists and create Apple Music playlists.
        </p>
      </div>

      {(error ?? authError) && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error ?? authError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {PROVIDERS.map((p) => {
          const connected = status?.[p.id] === true;
          const busy = pending === p.id;
          return (
            <div
              key={p.id}
              className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-800 p-4"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">{p.name}</h2>
                <ProviderBadge provider={p.id} />
              </div>
              <p className="text-sm text-slate-400">{p.description}</p>
              <div className="mt-auto flex items-center justify-between">
                <span
                  className={`inline-flex items-center gap-1.5 text-sm ${
                    connected ? "text-green-300" : "text-slate-400"
                  }`}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      connected ? "bg-green-400" : "bg-slate-500"
                    }`}
                  />
                  {connected ? "Connected" : "Not connected"}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  disabled={busy || !status}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    connected
                      ? "bg-slate-700 text-slate-100 hover:bg-slate-600"
                      : "bg-indigo-500 text-white hover:bg-indigo-400"
                  } disabled:opacity-50`}
                >
                  {busy
                    ? connected
                      ? "Logging out…"
                      : "Opening browser…"
                    : connected
                      ? "Log out"
                      : "Log in"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <MatchingSettings />
    </div>
  );
}
