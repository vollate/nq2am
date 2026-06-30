import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import ProviderBadge from "../components/ProviderBadge";
import TaskStatusBadge from "../components/TaskStatusBadge";
import { useTasks } from "../tasks";
import type { TaskSummary } from "../types";

export default function TasksPage() {
  const { tasks, loading, error, refresh, activeKey, setActiveKey } =
    useTasks();
  const { t } = useTranslation(["tasks", "common"]);
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Refresh on mount and poll while any task is mid-flight, so progress updates
  // without a manual reload.
  useEffect(() => {
    void refresh();
    const anyRunning = tasks.some(
      (t) => t.status === "matching" || t.status === "creating",
    );
    if (!anyRunning) return;
    const id = setInterval(() => void refresh(), 1500);
    return () => clearInterval(id);
  }, [refresh, tasks]);

  // Drop selections that no longer exist after a refresh/delete.
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(tasks.map((t) => t.key));
      const next = new Set([...prev].filter((k) => live.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const completedCount = useMemo(
    () => tasks.filter((t) => t.status === "created").length,
    [tasks],
  );
  // Selected tasks whose match failed and can be retried.
  const retryableSelected = useMemo(
    () =>
      tasks.filter(
        (t) => selected.has(t.key) && t.status === "match_failed",
      ),
    [tasks, selected],
  );
  const allSelected = tasks.length > 0 && selected.size === tasks.length;

  function toggleOne(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(tasks.map((t) => t.key)));
  }

  function open(task: TaskSummary) {
    setActiveKey(task.key);
    const dest =
      task.status === "fetched"
        ? `/playlist/${encodeURIComponent(task.key)}`
        : `/match/${encodeURIComponent(task.key)}`;
    navigate(dest);
  }

  async function runAction(fn: () => Promise<string[]>) {
    setActionError(null);
    setBusy(true);
    try {
      const removedKeys = await fn();
      if (activeKey && removedKeys.includes(activeKey)) {
        setActiveKey(null);
      }
      setSelected(new Set());
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    const keys = [...selected];
    if (keys.length === 0) return;
    await runAction(async () => {
      await api.deleteTasks(keys);
      return keys;
    });
  }

  async function clearCompleted() {
    await runAction(async () => {
      const res = await api.clearCompletedTasks();
      return res.keys;
    });
  }

  async function retrySelected() {
    if (retryableSelected.length === 0) return;
    setActionError(null);
    setBusy(true);
    try {
      // Re-kick the background match for each failed task; polling below picks
      // up the live progress.
      await Promise.all(retryableSelected.map((t) => api.runMatch(t.key)));
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && tasks.length === 0) {
    return <div className="text-slate-400">{t("loadingTasks")}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("title")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
        </div>
        <Link
          to="/"
          className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
        >
          {t("fetchNew")}
        </Link>
      </div>

      {(error || actionError) && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {actionError ?? error}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800/50 px-6 py-12 text-center text-slate-400">
          {t("empty.prefix")}{" "}
          <Link to="/" className="text-indigo-400 hover:underline">
            {t("empty.link")}
          </Link>{" "}
          {t("empty.suffix")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
          <div className="flex items-center justify-between gap-3 border-b border-slate-700 bg-slate-800/80 px-4 py-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-500"
                checked={allSelected}
                onChange={toggleAll}
                aria-label={t("selectAllAria")}
              />
              {selected.size > 0
                ? t("selectedCount", { count: selected.size })
                : t("selectAll")}
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={retrySelected}
                disabled={busy || retryableSelected.length === 0}
                className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
                title={t("retryMatchTitle")}
              >
                {retryableSelected.length > 0
                  ? t("retryMatchN", { count: retryableSelected.length })
                  : t("retryMatch")}
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                disabled={busy || selected.size === 0}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
              >
                {busy ? t("common:actions.working") : t("deleteSelected")}
              </button>
              <button
                type="button"
                onClick={clearCompleted}
                disabled={busy || completedCount === 0}
                className="rounded-md border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-40"
                title={t("clearCompletedTitle")}
              >
                {completedCount > 0
                  ? t("clearCompletedN", { count: completedCount })
                  : t("clearCompleted")}
              </button>
            </div>
          </div>

          <ul className="divide-y divide-slate-700">
            {tasks.map((task) => (
              <li key={task.key}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 flex-shrink-0 accent-indigo-500"
                    checked={selected.has(task.key)}
                    onChange={() => toggleOne(task.key)}
                    aria-label={t("selectAria", {
                      name: task.name ?? t("playlistFallback"),
                    })}
                  />
                  <button
                    type="button"
                    onClick={() => open(task)}
                    className="flex min-w-0 flex-1 items-center gap-4 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">
                          {task.name ?? t("untitledPlaylist")}
                        </span>
                        <ProviderBadge provider={task.provider} />
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {t("trackCount", { count: task.trackCount })}
                        {task.matched !== undefined &&
                          ` · ${t("matchedCount", { count: task.matched })}`}
                        {task.status === "matching" &&
                          task.matchProgress &&
                          ` · ${task.matchProgress.processed}/${task.matchProgress.total}`}
                        {task.error && (
                          <span className="text-red-300"> · {task.error}</span>
                        )}
                      </div>
                    </div>
                    <TaskStatusBadge status={task.status} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
