import { useTranslation } from "react-i18next";
import type { TaskStatus } from "../types";

const STATUS_STYLES: Record<TaskStatus, string> = {
  fetched: "bg-slate-600/30 text-slate-300 ring-slate-500/40",
  matching: "bg-indigo-600/20 text-indigo-300 ring-indigo-500/40",
  matched: "bg-green-600/20 text-green-300 ring-green-500/40",
  match_failed: "bg-red-600/20 text-red-300 ring-red-500/40",
  creating: "bg-indigo-600/20 text-indigo-300 ring-indigo-500/40",
  created: "bg-pink-600/20 text-pink-300 ring-pink-500/40",
  create_failed: "bg-red-600/20 text-red-300 ring-red-500/40",
};

export default function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation("tasks");
  const styles = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}
