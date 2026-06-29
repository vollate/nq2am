import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import CandidateCard from "../components/CandidateCard";
import ProviderBadge from "../components/ProviderBadge";
import { useTasks } from "../tasks";
import type { AppleMatchReport, AppleMatchStatus, MatchJob } from "../types";

const STATUS_LABEL: Record<AppleMatchStatus, string> = {
  matched: "Matched",
  not_found: "Not found",
  ambiguous: "Ambiguous",
  not_implemented: "Not implemented",
};

const STATUS_STYLE: Record<AppleMatchStatus, string> = {
  matched: "bg-green-600/20 text-green-300 ring-green-500/40",
  not_found: "bg-red-600/20 text-red-300 ring-red-500/40",
  ambiguous: "bg-yellow-600/20 text-yellow-200 ring-yellow-500/40",
  not_implemented: "bg-slate-600/30 text-slate-300 ring-slate-500/40",
};

type Tab = "all" | "review" | "matched";

export default function MatchPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { setActiveKey, refresh: refreshTasks } = useTasks();
  const [job, setJob] = useState<MatchJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [selectingIdx, setSelectingIdx] = useState<number | null>(null);

  const report: AppleMatchReport | null = job?.report ?? null;
  const isMatching = job?.status === "matching";

  useEffect(() => {
    setActiveKey(id);
  }, [id, setActiveKey]);

  // Load the job, then keep polling while the match is still running so the page
  // shows live progress and survives being navigated away and back.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const next = await api.getMatchJob(id);
        if (cancelled) return;
        setJob(next);
        setError(null);
        setLoading(false);
        if (next.status === "matching" || next.status === "creating") {
          timer = setTimeout(poll, 1200);
        } else {
          void refreshTasks();
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    setLoading(true);
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, refreshTasks]);

  const stats = useMemo(() => {
    const base = {
      total: 0,
      matched: 0,
      not_found: 0,
      ambiguous: 0,
      not_implemented: 0,
    };
    if (!report) return base;
    base.total = report.results.length;
    for (const r of report.results) {
      base[r.status] += 1;
    }
    return base;
  }, [report]);

  function exportReport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.playlistName ?? "match-report"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCreatePlaylist() {
    if (!report) return;
    setCreateError(null);
    setCreateMessage(null);
    setCreating(true);
    try {
      const res = await api.createApplePlaylist(id, report.playlistName);
      setCreateMessage(
        `Apple Music playlist created${res.playlistId ? ` (ID: ${res.playlistId})` : ""}.`,
      );
      void refreshTasks();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function chooseCandidate(idx: number, appleMusicId: string) {
    setSelectingIdx(idx);
    try {
      const updated = await api.selectTrack(id, idx, appleMusicId);
      // Patch the single result in place so the row reflects the new selection.
      setJob((prev) => {
        if (!prev?.report) return prev;
        const results = prev.report.results.slice();
        results[idx] = updated;
        return { ...prev, report: { ...prev.report, results } };
      });
      void refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSelectingIdx(null);
    }
  }

  // Tracks needing manual attention: ambiguous, or not-found but with candidates.
  const reviewIndices = useMemo(() => {
    if (!report) return [];
    return report.results
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r }) =>
          r.status === "ambiguous" ||
          (r.status === "not_found" && (r.candidates?.length ?? 0) > 0),
      )
      .map(({ i }) => i);
  }, [report]);

  if (loading) {
    return <div className="text-slate-400">Loading match report…</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">
        {error}
      </div>
    );
  }

  if (job?.status === "match_failed") {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">
          Match failed: {job.error ?? "unknown error"}
        </div>
        <Link
          to={`/playlist/${encodeURIComponent(id)}`}
          className="text-indigo-400 hover:underline"
        >
          Back to playlist to retry
        </Link>
      </div>
    );
  }

  if (isMatching) {
    const p = job?.progress;
    const pct = p && p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
    return (
      <div className="mx-auto max-w-md space-y-4 pt-16 text-center">
        <h1 className="text-xl font-semibold text-white">Matching to Apple Music…</h1>
        <p className="text-sm text-slate-400">
          {p ? `${p.processed} of ${p.total} tracks` : "Starting…"}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full bg-indigo-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-slate-500">
          You can leave this page — matching continues in the background.
        </p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-slate-400">
        No report yet.{" "}
        <Link
          to={`/playlist/${encodeURIComponent(id)}`}
          className="text-indigo-400 hover:underline"
        >
          Back to playlist
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-white">
          {report.playlistName ?? "Match report"}
        </h1>
        <ProviderBadge provider={report.provider} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total" value={stats.total} tone="neutral" />
        <StatCard label="Matched" value={stats.matched} tone="success" />
        <StatCard label="Not found" value={stats.not_found} tone="danger" />
        <StatCard label="Ambiguous" value={stats.ambiguous} tone="warning" />
        <StatCard
          label="Pending"
          value={stats.not_implemented}
          tone="neutral"
        />
      </div>

      <div className="flex items-center gap-1 border-b border-slate-700">
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All ({stats.total})
        </TabButton>
        <TabButton active={tab === "review"} onClick={() => setTab("review")}>
          Needs review ({reviewIndices.length})
        </TabButton>
        <TabButton active={tab === "matched"} onClick={() => setTab("matched")}>
          Matched ({stats.matched})
        </TabButton>
      </div>

      {tab === "review" ? (
        reviewIndices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800/50 px-6 py-10 text-center text-slate-400">
            Nothing to review — every track is matched or has no candidates.
          </div>
        ) : (
          <div className="space-y-5">
            {reviewIndices.map((i) => {
              const r = report.results[i];
              return (
                <div
                  key={i}
                  className="rounded-lg border border-slate-700 bg-slate-800/50 p-4"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">
                      {r.track.originalName}
                    </span>
                    <span className="text-xs text-slate-400">
                      {r.track.artists.join(", ")}
                    </span>
                    <span
                      className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(r.candidates ?? []).map((c) => (
                      <CandidateCard
                        key={c.id}
                        candidate={c}
                        sourceDurationMs={r.track.durationMs}
                        selected={r.selectedId === c.id}
                        busy={selectingIdx === i}
                        onChoose={() => chooseCandidate(i, c.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800">
          <table className="w-full text-left">
            <thead className="bg-slate-800 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 w-12">#</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Artists</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Apple ID / Reason</th>
              </tr>
            </thead>
            <tbody>
              {report.results
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => tab === "all" || r.status === "matched")
                .map(({ r, i }) => (
                  <tr
                    key={i}
                    className="border-t border-slate-700 hover:bg-slate-800/60"
                  >
                    <td className="px-3 py-2 text-sm text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2 text-sm text-slate-100">
                      {r.track.originalName}
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-300">
                      {r.track.artists.join(", ")}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.selectionSource === "manual" && (
                        <span className="ml-1 text-[10px] text-slate-500">
                          (manual)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-400">
                      {r.appleMusicId ?? r.reason ?? "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {createError && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {createError}
          </div>
        )}
        {createMessage && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-200">
            {createMessage}
          </div>
        )}
        <div className="flex justify-end gap-2">
          {stats.matched > 0 && (
            <button
              type="button"
              onClick={handleCreatePlaylist}
              disabled={creating}
              className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create Apple Music Playlist"}
            </button>
          )}
          <button
            type="button"
            onClick={exportReport}
            className="rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-600"
          >
            Export Report
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-indigo-500 text-white"
          : "border-transparent text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "warning" | "neutral";
}) {
  const toneClasses: Record<typeof tone, string> = {
    success: "text-green-300",
    danger: "text-red-300",
    warning: "text-yellow-200",
    neutral: "text-slate-100",
  };
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClasses[tone]}`}>
        {value}
      </div>
    </div>
  );
}
