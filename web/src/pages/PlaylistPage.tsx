import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import ProviderBadge from "../components/ProviderBadge";
import TrackTable from "../components/TrackTable";
import { useTasks } from "../tasks";
import type { NormalizedPlaylist, NormalizedTrack } from "../types";

export default function PlaylistPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<NormalizedPlaylist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const navigate = useNavigate();
  const { refresh, setActiveKey } = useTasks();

  useEffect(() => {
    setActiveKey(id);
  }, [id, setActiveKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getPlaylist(id)
      .then((p) => {
        if (!cancelled) setPlaylist(p);
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

  const handleUpdateTrack = useCallback(
    async (idx: number, patch: Partial<NormalizedTrack>) => {
      const updated = await api.updateTrack(id, idx, patch);
      setPlaylist((prev) => {
        if (!prev) return prev;
        const tracks = prev.tracks.slice();
        tracks[idx] = updated;
        return { ...prev, tracks };
      });
    },
    [id],
  );

  const handleDelete = useCallback(
    async (indices: number[]) => {
      const updated = await api.deleteTracks(id, indices);
      setPlaylist(updated);
    },
    [id],
  );

  function exportJson() {
    if (!playlist) return;
    const blob = new Blob([JSON.stringify(playlist, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${playlist.name ?? "playlist"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function startMatch() {
    if (!playlist) return;
    setMatching(true);
    try {
      // Fire-and-forget: the match runs server-side and the match page polls
      // for progress, so it survives navigating away.
      await api.runMatch(id);
      await refresh();
      navigate(`/match/${encodeURIComponent(id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMatching(false);
    }
  }

  if (loading) {
    return <div className="text-slate-400">Loading playlist…</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">
        {error}
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="text-slate-400">
        Playlist not found.{" "}
        <Link to="/" className="text-indigo-400 hover:underline">
          Fetch one
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
        {playlist.coverUrl ? (
          <img
            src={playlist.coverUrl}
            alt=""
            className="h-28 w-28 flex-shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="h-28 w-28 flex-shrink-0 rounded-md bg-slate-700" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold text-white">
              {playlist.name ?? "Untitled playlist"}
            </h1>
            <ProviderBadge provider={playlist.provider} />
          </div>
          {playlist.description && (
            <p className="mt-1 line-clamp-2 text-sm text-slate-400">
              {playlist.description}
            </p>
          )}
          <p className="mt-2 text-sm text-slate-400">
            {playlist.tracks.length} tracks
          </p>
        </div>
      </div>

      <TrackTable
        tracks={playlist.tracks}
        onUpdateTrack={handleUpdateTrack}
        onDeleteIndices={handleDelete}
      />

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={exportJson}
          className="rounded-md border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={startMatch}
          disabled={matching}
          className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {matching ? "Matching…" : "Match to Apple Music →"}
        </button>
      </div>
    </div>
  );
}
