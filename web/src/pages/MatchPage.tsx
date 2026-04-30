import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import ProviderBadge from "../components/ProviderBadge";
import type { AppleMatchReport, AppleMatchStatus } from "../types";

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

export default function MatchPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [report, setReport] = useState<AppleMatchReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getMatch(id)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

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
            {report.results.map((r, i) => (
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
                </td>
                <td className="px-3 py-2 text-sm text-slate-400">
                  {r.appleMusicId ?? r.reason ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
