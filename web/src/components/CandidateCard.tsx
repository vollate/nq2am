import type { AppleCandidate } from "../types";

function fmtDuration(ms?: number): string {
  if (!ms) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDelta(candMs?: number, srcMs?: number): string | null {
  if (!candMs || !srcMs) return null;
  const diff = Math.round((candMs - srcMs) / 1000);
  if (diff === 0) return "exact";
  return `${diff > 0 ? "+" : ""}${diff}s`;
}

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
        </div>
        <div className="truncate text-xs text-slate-400">
          {candidate.artistName}
          {candidate.albumName ? ` · ${candidate.albumName}` : ""}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
          <span>{fmtDuration(candidate.durationMs)}</span>
          {delta && (
            <span className={exact ? "text-green-400" : "text-amber-400"}>
              ({delta})
            </span>
          )}
          <span>· score {candidate.score.toFixed(2)}</span>
          {candidate.url && (
            <a
              href={candidate.url}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline"
            >
              open ↗
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
        {selected ? "Selected" : "Choose"}
      </button>
    </div>
  );
}
