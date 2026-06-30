import { useTranslation } from "react-i18next";
import { fmtDuration } from "../lib/duration";
import type { AppleMatchResult, AppleMatchStatus, MusicProvider } from "../types";
import CandidateCard from "./CandidateCard";
import ProviderBadge from "./ProviderBadge";

const STATUS_STYLE: Record<AppleMatchStatus, string> = {
  matched: "bg-green-600/20 text-green-300 ring-green-500/40",
  not_found: "bg-red-600/20 text-red-300 ring-red-500/40",
  ambiguous: "bg-yellow-600/20 text-yellow-200 ring-yellow-500/40",
  not_implemented: "bg-slate-600/30 text-slate-300 ring-slate-500/40",
};

type Props = {
  result: AppleMatchResult;
  provider: MusicProvider;
  busy: boolean;
  onChoose: (appleMusicId: string | null) => void;
};

/**
 * A track's original metadata plus its Apple Music candidate list, where the
 * user can pick (or re-pick) which version is selected. Used in both the
 * "Needs review" and "Matched" tabs — matched tracks keep their full candidate
 * list so the choice can always be changed.
 */
export default function ReviewCard({ result: r, provider, busy, onChoose }: Props) {
  const { t } = useTranslation("match");
  const artistLine = r.track.artists.join(", ");

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="mb-3 flex items-start gap-3 pr-3">
        {r.track.albumCoverUrl ? (
          <img
            src={r.track.albumCoverUrl}
            alt=""
            className="h-20 w-20 flex-shrink-0 rounded object-cover"
          />
        ) : (
          <div className="h-20 w-20 flex-shrink-0 rounded bg-slate-700" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("original.heading")}
            </span>
            <ProviderBadge provider={provider} />
            <span
              className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[r.status]}`}
            >
              {t(`status.${r.status}`)}
            </span>
            {r.selectionSource === "manual" && (
              <span className="text-[10px] text-slate-500">{t("manual")}</span>
            )}
          </div>
          <div className="mt-1 truncate text-base font-semibold text-white">
            {r.track.originalName}
          </div>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="w-24 flex-shrink-0 text-slate-500">
                {t("original.singer")}
              </dt>
              <dd className="min-w-0 flex-1 truncate text-slate-300">
                {artistLine}
              </dd>
            </div>
            {r.track.albumName && (
              <div className="flex gap-2">
                <dt className="w-24 flex-shrink-0 text-slate-500">
                  {t("original.album")}
                </dt>
                <dd className="min-w-0 flex-1 truncate text-slate-300">
                  {r.track.albumName}
                </dd>
              </div>
            )}
            {r.track.albumArtist && r.track.albumArtist !== artistLine && (
              <div className="flex gap-2">
                <dt className="w-24 flex-shrink-0 text-slate-500">
                  {t("original.albumArtist")}
                </dt>
                <dd className="min-w-0 flex-1 truncate text-slate-300">
                  {r.track.albumArtist}
                </dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="w-24 flex-shrink-0 text-slate-500">
                {t("original.duration")}
              </dt>
              <dd className="min-w-0 flex-1 truncate text-slate-300">
                {fmtDuration(r.track.durationMs)}
              </dd>
            </div>
          </dl>
        </div>
        <button
          type="button"
          onClick={() => onChoose(null)}
          disabled={busy}
          className={`flex-shrink-0 self-center rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
            r.selectionSource === "manual" && r.status === "not_found"
              ? "bg-red-600 text-white"
              : "bg-red-600/20 text-red-300 ring-1 ring-inset ring-red-500/40 hover:bg-red-600/30"
          }`}
        >
          {r.selectionSource === "manual" && r.status === "not_found"
            ? t("noMatchSelected")
            : t("noMatch")}
        </button>
      </div>
      <div className="space-y-2">
        {(r.candidates ?? []).map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            sourceDurationMs={r.track.durationMs}
            selected={r.selectedId === c.id}
            busy={busy}
            onChoose={() => onChoose(c.id)}
          />
        ))}
      </div>
    </div>
  );
}
