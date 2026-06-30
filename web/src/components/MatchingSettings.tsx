import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { MatchPreferences } from "../types";

const DEFAULTS: MatchPreferences = {
  threshold: 0.7,
  ambiguousGap: 0.1,
  preferDurationMatch: true,
  explicitPreference: "none",
  preferOriginalVersion: true,
  storefront: "",
};

export default function MatchingSettings() {
  const { t } = useTranslation("settings");
  const [prefs, setPrefs] = useState<MatchPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPreferences()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(p: Partial<MatchPreferences>) {
    setPrefs((prev) => ({ ...(prev ?? DEFAULTS), ...p }));
    setSaved(false);
  }

  async function save() {
    if (!prefs) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.putPreferences(prefs);
      setPrefs(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-sm text-slate-400">
        {t("matching.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-800 p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">{t("matching.title")}</h2>
        <p className="mt-1 text-sm text-slate-400">
          {t("matching.description")}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <span>
            {t("matching.threshold.label")}{" "}
            <span className="font-mono text-slate-100">
              {prefs.threshold.toFixed(2)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.threshold}
            onChange={(e) => patch({ threshold: Number(e.target.value) })}
            className="accent-indigo-500"
          />
          <span className="text-xs text-slate-500">
            {t("matching.threshold.help")}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <span>
            {t("matching.ambiguityGap.label")}{" "}
            <span className="font-mono text-slate-100">
              {prefs.ambiguousGap.toFixed(2)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.05}
            value={prefs.ambiguousGap}
            onChange={(e) => patch({ ambiguousGap: Number(e.target.value) })}
            className="accent-indigo-500"
          />
          <span className="text-xs text-slate-500">
            {t("matching.ambiguityGap.help")}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <span>{t("matching.explicit.label")}</span>
          <select
            value={prefs.explicitPreference}
            onChange={(e) =>
              patch({
                explicitPreference: e.target
                  .value as MatchPreferences["explicitPreference"],
              })
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="none">{t("matching.explicit.options.none")}</option>
            <option value="explicit">
              {t("matching.explicit.options.explicit")}
            </option>
            <option value="clean">
              {t("matching.explicit.options.clean")}
            </option>
          </select>
          <span className="text-xs text-slate-500">
            {t("matching.explicit.help")}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <span>{t("matching.storefront.label")}</span>
          <input
            type="text"
            value={prefs.storefront}
            onChange={(e) => patch({ storefront: e.target.value })}
            placeholder={t("matching.storefront.placeholder")}
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">
            {t("matching.storefront.help")}
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-500"
            checked={prefs.preferDurationMatch}
            onChange={(e) => patch({ preferDurationMatch: e.target.checked })}
          />
          {t("matching.preferDuration")}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-500"
            checked={prefs.preferOriginalVersion}
            onChange={(e) => patch({ preferOriginalVersion: e.target.checked })}
          />
          {t("matching.preferOriginal")}
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {saving ? t("matching.saving") : t("matching.save")}
        </button>
        {saved && (
          <span className="text-sm text-green-300">{t("matching.saved")}</span>
        )}
      </div>
    </div>
  );
}
