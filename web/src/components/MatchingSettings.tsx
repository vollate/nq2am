import { type ReactNode, useEffect, useState } from "react";
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
  nativeSearch: true,
  cjkDetection: "source",
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
          <FieldTitle tooltip={t("matching.threshold.tooltip")}>
            {t("matching.threshold.label")}{" "}
            <span className="font-mono text-slate-100">
              {prefs.threshold.toFixed(2)}
            </span>
          </FieldTitle>
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
          <FieldTitle tooltip={t("matching.ambiguityGap.tooltip")}>
            {t("matching.ambiguityGap.label")}{" "}
            <span className="font-mono text-slate-100">
              {prefs.ambiguousGap.toFixed(2)}
            </span>
          </FieldTitle>
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
          <FieldTitle tooltip={t("matching.explicit.tooltip")}>
            {t("matching.explicit.label")}
          </FieldTitle>
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
          <FieldTitle tooltip={t("matching.storefront.tooltip")}>
            {t("matching.storefront.label")}
          </FieldTitle>
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
          <FieldTitle tooltip={t("matching.preferDurationTooltip")}>
            {t("matching.preferDuration")}
          </FieldTitle>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-500"
            checked={prefs.preferOriginalVersion}
            onChange={(e) => patch({ preferOriginalVersion: e.target.checked })}
          />
          <FieldTitle tooltip={t("matching.preferOriginalTooltip")}>
            {t("matching.preferOriginal")}
          </FieldTitle>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-500"
            checked={prefs.nativeSearch}
            onChange={(e) => patch({ nativeSearch: e.target.checked })}
          />
          <FieldTitle tooltip={t("matching.nativeSearchTooltip")}>
            {t("matching.nativeSearch")}
          </FieldTitle>
        </label>
        <span className="ml-6 text-xs text-slate-500">
          {t("matching.nativeSearchHelp")}
        </span>
      </div>

      {prefs.nativeSearch && (
        <label className="flex max-w-sm flex-col gap-1 text-sm text-slate-300">
          <FieldTitle tooltip={t("matching.cjk.tooltip")}>
            {t("matching.cjk.label")}
          </FieldTitle>
          <select
            value={prefs.cjkDetection}
            onChange={(e) =>
              patch({
                cjkDetection: e.target
                  .value as MatchPreferences["cjkDetection"],
              })
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="source">{t("matching.cjk.options.source")}</option>
            <option value="text">{t("matching.cjk.options.text")}</option>
          </select>
          <span className="text-xs text-slate-500">{t("matching.cjk.help")}</span>
        </label>
      )}

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

function FieldTitle({
  children,
  tooltip,
}: {
  children: ReactNode;
  tooltip: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="min-w-0">{children}</span>
      <HelpTooltip text={tooltip} />
    </span>
  );
}

function HelpTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex flex-shrink-0 align-middle">
      <span
        tabIndex={0}
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-500 text-[10px] font-bold leading-none text-slate-300 outline-none transition hover:border-indigo-400 hover:text-indigo-200 focus:border-indigo-400 focus:text-indigo-200"
      >
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 top-6 z-30 hidden w-72 max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-relaxed text-slate-200 shadow-xl group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}
