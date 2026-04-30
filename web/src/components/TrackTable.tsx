import { useMemo, useState } from "react";
import type { NormalizedTrack } from "../types";
import TrackRow from "./TrackRow";

type Props = {
  tracks: NormalizedTrack[];
  onUpdateTrack: (idx: number, patch: Partial<NormalizedTrack>) => Promise<void>;
  onDeleteIndices: (indices: number[]) => Promise<void>;
};

export default function TrackTable({
  tracks,
  onUpdateTrack,
  onDeleteIndices,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const allSelected = useMemo(
    () => tracks.length > 0 && selected.size === tracks.length,
    [tracks.length, selected.size],
  );

  function toggleOne(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tracks.map((_, i) => i)));
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    const indices = Array.from(selected).sort((a, b) => a - b);
    setDeleting(true);
    try {
      await onDeleteIndices(indices);
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800">
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/80 px-4 py-2">
          <span className="text-sm text-slate-300">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={deleting}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete selected"}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-indigo-500"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 w-12">#</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Artists</th>
              <th className="px-3 py-2">Album</th>
              <th className="px-3 py-2">Album Artist</th>
            </tr>
          </thead>
          <tbody>
            {tracks.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-10 text-center text-sm text-slate-400"
                >
                  No tracks.
                </td>
              </tr>
            ) : (
              tracks.map((track, i) => (
                <TrackRow
                  key={`${track.source.provider}-${track.source.songId ?? i}`}
                  track={track}
                  index={i}
                  selected={selected.has(i)}
                  onToggleSelect={() => toggleOne(i)}
                  onSave={(patch) => onUpdateTrack(i, patch)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
