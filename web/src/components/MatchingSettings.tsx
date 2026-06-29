import { useEffect, useState } from "react";
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
        Loading matching preferences…
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-800 p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Matching</h2>
        <p className="mt-1 text-sm text-slate-400">
          How tracks are auto-matched to Apple Music. Changes apply the next time
          you run or retry a match.
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
            Match threshold:{" "}
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
            Minimum confidence to auto-accept a match.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <span>
            Ambiguity gap:{" "}
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
            If the top two are closer than this, it needs review.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <span>Explicit / clean preference</span>
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
            <option value="none">No preference</option>
            <option value="explicit">Prefer explicit</option>
            <option value="clean">Prefer clean</option>
          </select>
          <span className="text-xs text-slate-500">
            Tie-breaker when both versions exist.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          <span>Storefront</span>
          <input
            type="text"
            value={prefs.storefront}
            onChange={(e) => patch({ storefront: e.target.value })}
            placeholder="auto (from your account)"
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">
            Two-letter region, e.g. us, jp, cn. Leave blank to auto-detect.
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
          Prefer candidates whose duration is closest to the source track
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-500"
            checked={prefs.preferOriginalVersion}
            onChange={(e) => patch({ preferOriginalVersion: e.target.checked })}
          />
          Prefer original studio versions over remaster / live / karaoke
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save preferences"}
        </button>
        {saved && <span className="text-sm text-green-300">Saved.</span>}
      </div>
    </div>
  );
}
