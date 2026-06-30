import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useAuth } from "../auth";
import MatchingSettings from "../components/MatchingSettings";
import ProviderBadge from "../components/ProviderBadge";
import type { MusicProvider } from "../types";

const PROVIDER_IDS: MusicProvider[] = ["qq", "netease", "apple"];

export default function SettingsPage() {
  const { t } = useTranslation("settings");
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
        <h1 className="text-2xl font-semibold text-white">{t("title")}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t("subtitle")}
        </p>
      </div>

      {(error ?? authError) && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error ?? authError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {PROVIDER_IDS.map((id) => {
          const connected = status?.[id] === true;
          const busy = pending === id;
          return (
            <div
              key={id}
              className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-800 p-4"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">
                  {t(`providers.${id}.name`)}
                </h2>
                <ProviderBadge provider={id} />
              </div>
              <p className="text-sm text-slate-400">
                {t(`providers.${id}.description`)}
              </p>
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
                  {connected ? t("connection.connected") : t("connection.notConnected")}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  disabled={busy || !status}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    connected
                      ? "bg-slate-700 text-slate-100 hover:bg-slate-600"
                      : "bg-indigo-500 text-white hover:bg-indigo-400"
                  } disabled:opacity-50`}
                >
                  {busy
                    ? connected
                      ? t("buttons.loggingOut")
                      : t("buttons.openingBrowser")
                    : connected
                      ? t("buttons.logOut")
                      : t("buttons.logIn")}
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
