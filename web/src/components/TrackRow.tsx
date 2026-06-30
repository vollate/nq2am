import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NormalizedTrack } from "../types";

type EditableField = "originalName" | "artists" | "albumName" | "albumArtist";

type Props = {
  track: NormalizedTrack;
  index: number;
  selected: boolean;
  onToggleSelect: () => void;
  onSave: (patch: Partial<NormalizedTrack>) => Promise<void> | void;
};

export default function TrackRow({
  track,
  index,
  selected,
  onToggleSelect,
  onSave,
}: Props) {
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useTranslation("playlist");

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function beginEdit(field: EditableField) {
    if (saving) return;
    const current = readField(track, field);
    setDraft(current);
    setEditing(field);
  }

  function cancel() {
    setEditing(null);
    setDraft("");
  }

  async function commit() {
    if (!editing) return;
    const field = editing;
    const original = readField(track, field);
    if (draft === original) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<NormalizedTrack> = {};
      if (field === "artists") {
        patch.artists = draft
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        patch[field] = draft;
      }
      await onSave(patch);
      setEditing(null);
      setDraft("");
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function renderCell(field: EditableField, display: string) {
    if (editing === field) {
      return (
        <input
          ref={inputRef}
          className="w-full rounded bg-slate-700 px-2 py-1 text-sm text-slate-100 outline-none ring-1 ring-indigo-500"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={saving}
        />
      );
    }
    return (
      <span
        className="block cursor-text rounded px-1 py-0.5 hover:bg-slate-700/60"
        onDoubleClick={() => beginEdit(field)}
        title={t("doubleClickToEdit")}
      >
        {display || <span className="text-slate-500">—</span>}
      </span>
    );
  }

  return (
    <tr className="border-t border-slate-700 hover:bg-slate-800/60">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-indigo-500"
          checked={selected}
          onChange={onToggleSelect}
        />
      </td>
      <td className="px-3 py-2 text-sm text-slate-400">{index + 1}</td>
      <td className="px-3 py-2 text-sm text-slate-100">
        {renderCell("originalName", track.originalName)}
      </td>
      <td className="px-3 py-2 text-sm text-slate-200">
        {renderCell("artists", track.artists.join(", "))}
      </td>
      <td className="px-3 py-2 text-sm text-slate-300">
        {renderCell("albumName", track.albumName ?? "")}
      </td>
      <td className="px-3 py-2 text-sm text-slate-300">
        {renderCell("albumArtist", track.albumArtist ?? "")}
      </td>
    </tr>
  );
}

function readField(track: NormalizedTrack, field: EditableField): string {
  switch (field) {
    case "originalName":
      return track.originalName;
    case "artists":
      return track.artists.join(", ");
    case "albumName":
      return track.albumName ?? "";
    case "albumArtist":
      return track.albumArtist ?? "";
  }
}
