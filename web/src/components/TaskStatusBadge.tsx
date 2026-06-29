import type { TaskStatus } from "../types";

const STATUS_META: Record<TaskStatus, { label: string; styles: string }> = {
  fetched: { label: "Fetched", styles: "bg-slate-600/30 text-slate-300 ring-slate-500/40" },
  matching: { label: "Matching…", styles: "bg-indigo-600/20 text-indigo-300 ring-indigo-500/40" },
  matched: { label: "Matched", styles: "bg-green-600/20 text-green-300 ring-green-500/40" },
  match_failed: { label: "Match failed", styles: "bg-red-600/20 text-red-300 ring-red-500/40" },
  creating: { label: "Creating…", styles: "bg-indigo-600/20 text-indigo-300 ring-indigo-500/40" },
  created: { label: "Created", styles: "bg-pink-600/20 text-pink-300 ring-pink-500/40" },
  create_failed: { label: "Create failed", styles: "bg-red-600/20 text-red-300 ring-red-500/40" },
};

export default function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { label, styles } = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {label}
    </span>
  );
}
