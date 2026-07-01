import { useTranslation } from "react-i18next";
import { fmtDelta, fmtDuration } from "../lib/duration";
import type { AppleCandidate } from "../types";

type Props = {
  candidate: AppleCandidate;
  sourceDurationMs?: number;
  selected: boolean;
  onChoose: () => void;
  busy?: boolean;
};

export default function CandidateCard({
  candidate,
  sourceDurationMs,
  selected,
  onChoose,
  busy,
}: Props) {
  const { t } = useTranslation("match");
  const delta = fmtDelta(candidate.durationMs, sourceDurationMs);
  const exact = delta === "exact";

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 ${
        selected
          ? "border-indigo-500 bg-indigo-500/10"
          : "border-slate-700 bg-slate-800"
      }`}
    >
      {candidate.artworkUrl ? (
        <img
          src={candidate.artworkUrl}
          alt=""
          className="h-14 w-14 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-14 w-14 flex-shrink-0 rounded bg-slate-700" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-100">
            {candidate.name}
          </span>
          {candidate.contentRating === "explicit" && (
            <span className="rounded bg-slate-600 px-1 text-[10px] font-semibold text-slate-200">
              E
            </span>
          )}
          {candidate.storefront && (
            <span className="flex-shrink-0 rounded bg-slate-700 px-1 text-[10px] font-semibold uppercase text-slate-300">
              {candidate.storefront}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-slate-400">
          {candidate.artistName}
          {candidate.albumName ? ` · ${candidate.albumName}` : ""}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
          <span>{fmtDuration(candidate.durationMs)}</span>
          {delta && (
            <span className={exact ? "text-green-400" : "text-amber-400"}>
              ({exact ? t("candidate.exact") : delta})
            </span>
          )}
          <span>· {t("candidate.score", { score: candidate.score.toFixed(2) })}</span>
          {candidate.url && (
            <a
              href={candidate.url}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline"
            >
              {t("candidate.open")}
            </a>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onChoose}
        disabled={busy || selected}
        className={`flex-shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${
          selected
            ? "bg-indigo-500 text-white"
            : "bg-slate-700 text-slate-100 hover:bg-slate-600"
        } disabled:opacity-60`}
      >
        {selected ? t("candidate.selected") : t("candidate.choose")}
      </button>
    </div>
  );
}
