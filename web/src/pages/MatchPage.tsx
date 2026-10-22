import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { downloadJson, sanitizeFilename } from "../lib/download";
import CreateApplePlaylistDialog from "../components/CreateApplePlaylistDialog";
import ProviderBadge from "../components/ProviderBadge";
import ReviewCard from "../components/ReviewCard";
import AgentAttempt from "../components/AgentAttempt";
import MatchScopeAction from "../components/MatchScopeAction";
import type { ApplePlaylistCreationDraft } from "../../../src/applePlaylistCreation";
import {
  areReviewOptionsCollapsed,
  collapseReviewOptionsAfterChoice,
  toggleReviewOptions,
} from "../../../src/reviewCollapse";
import { shouldShowGoTopButton } from "../../../src/scrollUi";
import {
  getAmbiguousIndices,
  getNotFoundIndices,
  getRequestFailedIndices,
  getRetryIndices,
  getScoreRejectedIndices,
  retryScopeForTab,
} from "../../../src/matchFilters";
import { useTasks } from "../tasks";
import type {
  AppleMatchReport,
  AppleMatchResult,
  AppleMatchStatus,
  MatchJob,
  MatchReviewTab,
  MatchRetryScope,
  MusicProvider,
  PortablePlaylistFile,
  PortableTrack,
} from "../types";

const STATUS_STYLE: Record<AppleMatchStatus, string> = {
  matched: "bg-green-600/20 text-green-300 ring-green-500/40",
  not_found: "bg-red-600/20 text-red-300 ring-red-500/40",
  score_rejected: "bg-fuchsia-600/20 text-fuchsia-200 ring-fuchsia-500/40",
  ambiguous: "bg-yellow-600/20 text-yellow-200 ring-yellow-500/40",
  request_failed: "bg-orange-600/20 text-orange-200 ring-orange-500/40",
  not_implemented: "bg-slate-600/30 text-slate-300 ring-slate-500/40",
};

export default function MatchPage() {
  const { t } = useTranslation(["match", "common"]);
  const { id = "" } = useParams<{ id: string }>();
  const { setActiveKey, refresh: refreshTasks } = useTasks();
  const [job, setJob] = useState<MatchJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [agentConfigured, setAgentConfigured] = useState(false);
  const [agentPending, setAgentPending] = useState(false);
  const [retryScope, setRetryScope] =
    useState<MatchRetryScope>("not_found");
  const [agentScope, setAgentScope] = useState<MatchRetryScope>("selected");
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [tab, setTab] = useState<MatchReviewTab>("all");
  const [selectingIdx, setSelectingIdx] = useState<number | null>(null);
  const [reselectIdx, setReselectIdx] = useState<number | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const [showGoTop, setShowGoTop] = useState(false);
  const [collapsedReviewOptions, setCollapsedReviewOptions] = useState<Set<number>>(
    () => new Set(),
  );
  const [expandedReviewOptions, setExpandedReviewOptions] = useState<Set<number>>(
    () => new Set(),
  );
  const [retrySelectedIndices, setRetrySelectedIndices] = useState<Set<number>>(
    () => new Set(),
  );
  const createPlaylistButtonRef = useRef<HTMLButtonElement>(null);

  const report: AppleMatchReport | null = job?.report ?? null;
  const isMatching = job?.status === "matching";
  const isAgentRunning = job?.agentRun?.status === "running";
  const taskBusy = isMatching || job?.status === "creating" || retrying || creating || agentPending;

  useEffect(() => {
    let active = true;
    api.getAgentSettings().then((settings) => { if (active) setAgentConfigured(settings.configured); }).catch(() => { if (active) setAgentConfigured(false); });
    return () => { active = false; };
  }, [id]);

  async function handleAgent(cancel = false) {
    const indices = cancel ? [] : getRetryIndices(report?.results ?? [], agentScope, [...retrySelectedIndices]);
    if (cancel ? !job?.agentRun : !indices.length || !agentConfigured || taskBusy || selectingIdx !== null) return;
    setAgentPending(true); setRetryError(null);
    try {
      if (cancel && job?.agentRun) await api.cancelAgent(id, job.agentRun.runId);
      else await api.startAgent(id, indices);
      setJob(await api.getMatchJob(id));
      setPollNonce((n) => n + 1);
      void refreshTasks();
    } catch (error) { setRetryError(error instanceof Error ? error.message : String(error)); }
    finally { setAgentPending(false); }
  }

  useEffect(() => {
    setActiveKey(id);
    setLoading(true);
    setCollapsedReviewOptions(new Set());
    setExpandedReviewOptions(new Set());
    setRetrySelectedIndices(new Set());
  }, [id, setActiveKey]);

  useEffect(() => {
    setRetrySelectedIndices((prev) => {
      if (!report) return prev.size === 0 ? prev : new Set();
      const next = new Set(
        [...prev].filter((idx) => idx >= 0 && idx < report.results.length),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [report]);

  useEffect(() => {
    function updateGoTopVisibility() {
      setShowGoTop(shouldShowGoTopButton(window.scrollY));
    }

    updateGoTopVisibility();
    window.addEventListener("scroll", updateGoTopVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateGoTopVisibility);
  }, []);

  useEffect(() => {
    setRetryScope((scope) => retryScopeForTab(tab, scope));
    setAgentScope((scope) => retryScopeForTab(tab, scope));
  }, [tab]);

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

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, refreshTasks, pollNonce]);

  const stats = useMemo(() => {
    const base = {
      total: 0,
      matched: 0,
      not_found: 0,
      score_rejected: 0,
      ambiguous: 0,
      request_failed: 0,
      not_implemented: 0,
    };
    if (!report) return base;
    base.total = report.results.length;
    for (const r of report.results) {
      base[r.status] += 1;
    }
    return base;
  }, [report]);

  const unmatchedCount = stats.total - stats.matched;

  async function handleCreatePlaylist(draft: ApplePlaylistCreationDraft) {
    if (!report) return;
    setCreateMessage(null);
    setCreating(true);
    try {
      const res = await api.createApplePlaylist(
        id,
        draft.name,
        draft.description,
      );
      setCreateMessage(
        t("createdMessage", {
          idSuffix: res.playlistId
            ? t("createdIdSuffix", { playlistId: res.playlistId })
            : "",
        }),
      );
      setCreateDialogOpen(false);
      void refreshTasks();
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      setCreating(false);
    }
  }

  function handleExportUnmatched() {
    if (!report) return;
    const unmatched = report.results.filter((r) => r.status !== "matched");
    if (unmatched.length === 0) return;
    const file: PortablePlaylistFile = {
      format: "nq2am-playlist",
      version: 1,
      name: report.playlistName,
      provider: report.provider,
      tracks: unmatched.map<PortableTrack>((r) => ({
        name: r.track.originalName,
        artists: r.track.artists,
        album: r.track.albumName,
        durationMs: r.track.durationMs,
      })),
    };
    downloadJson(
      `${sanitizeFilename(report.playlistName ?? "playlist")}-unmatched.json`,
      file,
    );
  }

  async function handleRetry() {
    const retryIndices =
      retryScope === "selected" ? [...retrySelectedIndices] : [];
    const retryTotal = scopeCounts[retryScope];
    if (retryTotal === 0) return;
    setRetryError(null);
    setCreateMessage(null);
    setRetrying(true);
    try {
      await api.retryMatch(id, retryScope, retryIndices);
      setTab(
        retryScope === "not_found"
          ? "not_found"
          : retryScope === "score_rejected"
            ? "score_rejected"
            : retryScope === "ambiguous"
              ? "ambiguous"
              : retryScope === "request_failed"
                ? "request_failed"
                : "all",
      );
      setRetrySelectedIndices(new Set());
      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: "matching",
              progress: { processed: 0, total: retryTotal },
            }
          : prev,
      );
      setPollNonce((n) => n + 1);
      void refreshTasks();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  }

  function toggleRetrySelected(idx: number) {
    setRetrySelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  async function chooseCandidate(
    idx: number,
    appleMusicId: string | null,
    options: { collapseReviewOptions?: boolean } = {},
  ) {
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
      if (options.collapseReviewOptions) {
        setCollapsedReviewOptions((prev) =>
          collapseReviewOptionsAfterChoice(prev, idx),
        );
        setExpandedReviewOptions((prev) => {
          const next = new Set(prev);
          next.delete(idx);
          return next;
        });
      }
      void refreshTasks();
      // Close the reselect popup (if open) once the new pick is saved.
      setReselectIdx(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSelectingIdx(null);
    }
  }

  const ambiguousResultIndices = useMemo(() => {
    if (!report) return [];
    return getAmbiguousIndices(report.results);
  }, [report]);

  const notFoundIndices = useMemo(() => {
    if (!report) return [];
    return getNotFoundIndices(report.results);
  }, [report]);

  const requestFailedIndices = useMemo(() => {
    if (!report) return [];
    return getRequestFailedIndices(report.results);
  }, [report]);

  const scoreRejectedIndices = useMemo(() => {
    if (!report) return [];
    return getScoreRejectedIndices(report.results);
  }, [report]);

  const scopeCounts = useMemo(
    () => ({
      request_failed: requestFailedIndices.length,
      not_found: notFoundIndices.length,
      score_rejected: scoreRejectedIndices.length,
      ambiguous: ambiguousResultIndices.length,
      selected: retrySelectedIndices.size,
      all: report?.results.length ?? 0,
    }),
    [
      ambiguousResultIndices.length,
      notFoundIndices.length,
      report,
      requestFailedIndices.length,
      scoreRejectedIndices.length,
      retrySelectedIndices.size,
    ],
  );

  if (loading) {
    return <div className="text-slate-400">{t("loading")}</div>;
  }

  if (error && !report) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">
        {error}
      </div>
    );
  }

  if (job?.status === "match_failed" && !job.agentRun) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">
          {t("matchFailed", { error: job.error ?? t("unknownError") })}
        </div>
        <Link
          to={`/playlist/${encodeURIComponent(id)}`}
          className="text-indigo-400 hover:underline"
        >
          {t("backToRetry")}
        </Link>
      </div>
    );
  }

  if (isMatching && !isAgentRunning) {
    const p = job?.progress;
    const pct = p && p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
    return (
      <div className="mx-auto max-w-md space-y-4 pt-16 text-center">
        <h1 className="text-xl font-semibold text-white">{t("matching.title")}</h1>
        <p className="text-sm text-slate-400">
          {p
            ? t("matching.progress", { processed: p.processed, total: p.total })
            : t("matching.starting")}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full bg-indigo-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-slate-500">{t("matching.background")}</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-slate-400">
        {t("noReport")}{" "}
        <Link
          to={`/playlist/${encodeURIComponent(id)}`}
          className="text-indigo-400 hover:underline"
        >
          {t("backToPlaylist")}
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold text-white">
              {report.playlistName ?? t("title")}
            </h1>
            <ProviderBadge provider={report.provider} />
          </div>
          <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
            <MatchScopeAction
              scope={agentScope}
              counts={scopeCounts}
              onScopeChange={setAgentScope}
              onAction={() => void handleAgent()}
              scopeLabel={t("agent.scopeLabel")}
              actionLabel={t("agent.start", { count: scopeCounts[agentScope] })}
              title={t("agent.billing")}
              disabled={taskBusy}
              actionDisabled={!agentConfigured || selectingIdx !== null}
              tone="agent"
            />
            <MatchScopeAction
              scope={retryScope}
              counts={scopeCounts}
              onScopeChange={setRetryScope}
              onAction={() => void handleRetry()}
              scopeLabel={t("retry.scopeLabel")}
              actionLabel={retrying ? t("retry.running") : t("retry.action")}
              title={t("retry.title")}
              disabled={taskBusy}
              actionDisabled={selectingIdx !== null}
            />
            {unmatchedCount > 0 && (
              <button
                type="button"
                onClick={handleExportUnmatched}
                disabled={taskBusy}
                className="rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                title={t("exportUnmatchedTitle")}
              >
                {t("exportUnmatched", { count: unmatchedCount })}
              </button>
            )}
            {stats.matched > 0 && (
              <button
                ref={createPlaylistButtonRef}
                type="button"
                onClick={() => {
                  setCreateMessage(null);
                  setCreateDialogOpen(true);
                }}
                disabled={taskBusy || selectingIdx !== null}
                className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
              >
                {creating ? t("creating") : t("createPlaylist")}
              </button>
            )}
          </div>
        </div>
        {!agentConfigured && <Link to="/settings" className="text-sm text-violet-300">{t("agent.configure")}</Link>}
        <p className="text-xs text-slate-400">{t("agent.billing")}</p>
        {job?.agentRun && <section className="space-y-2 rounded-md border border-violet-500/30 bg-violet-500/10 p-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <span>{t(`agent.states.${job.agentRun.status}`)} · {job.agentRun.processed}/{job.agentRun.total}</span>
            {job.agentRun.currentIndex !== undefined && <span>{report.results[job.agentRun.currentIndex]?.track.originalName}</span>}
            {isAgentRunning && <button type="button" disabled={agentPending} onClick={() => void handleAgent(true)} className="rounded bg-slate-700 px-3 py-1">{t("agent.cancel")}</button>}
          </div>
          <progress className="w-full" value={job.agentRun.processed} max={job.agentRun.total} />
          <p className="text-sm">{t("agent.summary", { matched: job.agentRun.matched, noMatch: job.agentRun.noMatch, uncertain: job.agentRun.uncertain, failed: job.agentRun.failed })}</p>
          {job.agentRun.error && <p className="text-sm text-red-200">{job.agentRun.error}</p>}
          <div className="flex flex-wrap gap-2 text-xs text-slate-300"><span>{t("agent.logs")}</span><code className="select-all break-all">{job.agentRun.logDir}</code>
            <button type="button" onClick={() => void navigator.clipboard.writeText(job.agentRun!.logDir).catch(() => setRetryError(t("agent.copyFailed")))}>{t("agent.copy")}</button>
          </div>
        </section>}
        {error && <p className="text-sm text-red-200">{error}</p>}
        {retryError && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {retryError}
          </div>
        )}
        {createMessage && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-200">
            {createMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <StatCard label={t("stats.total")} value={stats.total} tone="neutral" />
        <StatCard
          label={t("stats.matched")}
          value={stats.matched}
          tone="success"
        />
        <StatCard
          label={t("stats.not_found")}
          value={stats.not_found}
          tone="danger"
        />
        <StatCard
          label={t("stats.score_rejected")}
          value={stats.score_rejected}
          tone="rejected"
        />
        <StatCard
          label={t("stats.ambiguous")}
          value={stats.ambiguous}
          tone="warning"
        />
        <StatCard
          label={t("stats.request_failed")}
          value={stats.request_failed}
          tone="failure"
        />
        <StatCard
          label={t("stats.pending")}
          value={stats.not_implemented}
          tone="neutral"
        />
      </div>

      <div className="sticky top-14 z-20 -mx-4 border-b border-slate-700 bg-slate-900/95 px-4 pt-2 backdrop-blur">
        <div className="flex items-center gap-1 overflow-x-auto">
          <TabButton active={tab === "all"} onClick={() => setTab("all")}>
            {t("tabs.all", { count: stats.total })}
          </TabButton>
          <TabButton
            active={tab === "ambiguous"}
            onClick={() => setTab("ambiguous")}
          >
            {t("tabs.ambiguous", { count: ambiguousResultIndices.length })}
          </TabButton>
          <TabButton
            active={tab === "score_rejected"}
            onClick={() => setTab("score_rejected")}
          >
            {t("tabs.score_rejected", { count: scoreRejectedIndices.length })}
          </TabButton>
          <TabButton
            active={tab === "request_failed"}
            onClick={() => setTab("request_failed")}
          >
            {t("tabs.request_failed", { count: requestFailedIndices.length })}
          </TabButton>
          <TabButton
            active={tab === "not_found"}
            onClick={() => setTab("not_found")}
          >
            {t("tabs.not_found", { count: notFoundIndices.length })}
          </TabButton>
          <TabButton active={tab === "matched"} onClick={() => setTab("matched")}>
            {t("tabs.matched", { count: stats.matched })}
          </TabButton>
        </div>
      </div>

      <fieldset disabled={taskBusy}>
      {tab === "ambiguous" ? (
        ambiguousResultIndices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800/50 px-6 py-10 text-center text-slate-400">
            {t("emptyAmbiguous")}
          </div>
        ) : (
          <div className="space-y-5">
            {ambiguousResultIndices.map((i) => (
              <ReviewCard
                key={i}
                result={report.results[i]}
                provider={report.provider}
                busy={selectingIdx === i}
                retrySelected={retrySelectedIndices.has(i)}
                onToggleRetrySelected={() => toggleRetrySelected(i)}
                collapsed={areReviewOptionsCollapsed(
                  report.results[i],
                  i,
                  collapsedReviewOptions,
                  expandedReviewOptions,
                )}
                onToggleCollapsed={() => {
                  setCollapsedReviewOptions((prev) => toggleReviewOptions(prev, i));
                  setExpandedReviewOptions((prev) => toggleReviewOptions(prev, i));
                }}
                onChoose={(appleMusicId) =>
                  chooseCandidate(i, appleMusicId, { collapseReviewOptions: true })
                }
              />
            ))}
          </div>
        )
      ) : tab === "score_rejected" ? (
        scoreRejectedIndices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800/50 px-6 py-10 text-center text-slate-400">
            {t("emptyScoreRejected")}
          </div>
        ) : (
          <div className="space-y-5">
            {scoreRejectedIndices.map((i) => (
              <ReviewCard
                key={i}
                result={report.results[i]}
                provider={report.provider}
                busy={selectingIdx === i}
                retrySelected={retrySelectedIndices.has(i)}
                onToggleRetrySelected={() => toggleRetrySelected(i)}
                collapsed={areReviewOptionsCollapsed(
                  report.results[i],
                  i,
                  collapsedReviewOptions,
                  expandedReviewOptions,
                )}
                onToggleCollapsed={() => {
                  setCollapsedReviewOptions((prev) => toggleReviewOptions(prev, i));
                  setExpandedReviewOptions((prev) => toggleReviewOptions(prev, i));
                }}
                onChoose={(appleMusicId) =>
                  chooseCandidate(i, appleMusicId, { collapseReviewOptions: true })
                }
              />
            ))}
          </div>
        )
      ) : tab === "request_failed" ? (
        requestFailedIndices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800/50 px-6 py-10 text-center text-slate-400">
            {t("emptyRequestFailed")}
          </div>
        ) : (
          <div className="space-y-5">
            {requestFailedIndices.map((i) => (
              <RequestFailedCard
                key={i}
                result={report.results[i]}
                provider={report.provider}
                retrySelected={retrySelectedIndices.has(i)}
                onToggleRetrySelected={() => toggleRetrySelected(i)}
              />
            ))}
          </div>
        )
      ) : tab === "not_found" ? (
        notFoundIndices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800/50 px-6 py-10 text-center text-slate-400">
            {t("emptyNotFound")}
          </div>
        ) : (
          <div className="space-y-5">
            {notFoundIndices.map((i) => {
              const result = report.results[i];
              return (result.candidates?.length ?? 0) > 0 ? (
                <ReviewCard
                  key={i}
                  result={result}
                  provider={report.provider}
                  busy={selectingIdx === i}
                  retrySelected={retrySelectedIndices.has(i)}
                  onToggleRetrySelected={() => toggleRetrySelected(i)}
                  collapsed={areReviewOptionsCollapsed(
                    result,
                    i,
                    collapsedReviewOptions,
                    expandedReviewOptions,
                  )}
                  onToggleCollapsed={() => {
                    setCollapsedReviewOptions((prev) =>
                      toggleReviewOptions(prev, i),
                    );
                    setExpandedReviewOptions((prev) => toggleReviewOptions(prev, i));
                  }}
                  onChoose={(appleMusicId) =>
                    chooseCandidate(i, appleMusicId, {
                      collapseReviewOptions: true,
                    })
                  }
                />
              ) : (
                <NotFoundCard
                  key={i}
                  result={result}
                  provider={report.provider}
                  retrySelected={retrySelectedIndices.has(i)}
                  onToggleRetrySelected={() => toggleRetrySelected(i)}
                />
              );
            })}
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800">
          <table className="w-full text-left">
            <thead className="bg-slate-800 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="w-16 min-w-16 whitespace-nowrap px-3 py-2">
                  {t("table.retry")}
                </th>
                <th className="w-12 whitespace-nowrap px-3 py-2">
                  {t("table.index")}
                </th>
                <th className="px-3 py-2">{t("table.name")}</th>
                <th className="px-3 py-2">{t("table.artists")}</th>
                <th className="min-w-28 whitespace-nowrap px-3 py-2">
                  {t("table.status")}
                </th>
                <th className="px-3 py-2">{t("table.appleIdReason")}</th>
                <th className="w-28 min-w-28 px-3 py-2" />
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
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={retrySelectedIndices.has(i)}
                        onChange={() => toggleRetrySelected(i)}
                        className="h-4 w-4 accent-indigo-500"
                        aria-label={t("retry.selectTrack", {
                          name: r.track.originalName,
                        })}
                      />
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2 text-sm text-slate-100">
                      {r.track.originalName}
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-300">
                      {r.track.artists.join(", ")}
                    </td>
                    <td className="min-w-28 whitespace-nowrap px-3 py-2 text-sm">
                      <span
                        className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[r.status]}`}
                      >
                        {t(`status.${r.status}`)}
                      </span>
                      {r.selectionSource === "manual" && (
                        <span className="ml-1 text-[10px] text-slate-500">
                          {t("manual")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-400">
                      {r.appleMusicId ?? r.reason ?? "—"}
                      <AgentAttempt result={r} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {(r.candidates?.length ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => setReselectIdx(i)}
                          disabled={taskBusy}
                          className="rounded-md border border-slate-600 bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-600"
                        >
                          {t("reselect")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {reselectIdx !== null && report.results[reselectIdx] && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/90 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setReselectIdx(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setReselectIdx(null);
          }}
        >
          <div
            className="w-full max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {t("reselectTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setReselectIdx(null)}
                className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-slate-700 hover:text-slate-100"
                aria-label={t("common:actions.cancel")}
              >
                ✕
              </button>
            </div>
            <ReviewCard
              result={report.results[reselectIdx]}
              provider={report.provider}
              busy={selectingIdx === reselectIdx}
              onChoose={(appleMusicId) =>
                chooseCandidate(reselectIdx, appleMusicId)
              }
            />
          </div>
        </div>
      )}

      </fieldset>
      {createDialogOpen && (
        <CreateApplePlaylistDialog
          source={{
            name: job?.sourcePlaylist?.name ?? report.playlistName,
            description: job?.sourcePlaylist?.description,
          }}
          returnFocusRef={createPlaylistButtonRef}
          onCancel={() => setCreateDialogOpen(false)}
          onConfirm={handleCreatePlaylist}
        />
      )}

      {showGoTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-slate-600 bg-slate-800/95 text-lg font-semibold text-slate-100 shadow-lg shadow-slate-950/30 backdrop-blur hover:bg-slate-700"
          aria-label={t("goTop")}
          title={t("goTop")}
        >
          ↑
        </button>
      )}
    </div>
  );
}

function NotFoundCard({
  result: r,
  provider,
  retrySelected = false,
  onToggleRetrySelected,
}: {
  result: AppleMatchResult;
  provider: MusicProvider;
  retrySelected?: boolean;
  onToggleRetrySelected?: () => void;
}) {
  const { t } = useTranslation("match");
  const artistLine = r.track.artists.join(", ");

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex items-start gap-3">
        {onToggleRetrySelected && (
          <input
            type="checkbox"
            checked={retrySelected}
            onChange={onToggleRetrySelected}
            className="mt-6 h-4 w-4 flex-shrink-0 accent-indigo-500"
            aria-label={t("retry.selectTrack", {
              name: r.track.originalName,
            })}
          />
        )}
        {r.track.albumCoverUrl ? (
          <img
            src={r.track.albumCoverUrl}
            alt=""
            className="h-16 w-16 flex-shrink-0 rounded object-cover"
          />
        ) : (
          <div className="h-16 w-16 flex-shrink-0 rounded bg-slate-700" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("original.heading")}
            </span>
            <ProviderBadge provider={provider} />
            <span className={`ml-auto inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE.not_found}`}>
              {t("status.not_found")}
            </span>
          </div>
          <div className="mt-1 truncate text-base font-semibold text-white">
            {r.track.originalName}
          </div>
          <div className="truncate text-sm text-slate-300">{artistLine}</div>
          {r.track.albumName && (
            <div className="truncate text-xs text-slate-500">
              {r.track.albumName}
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500">
            {r.reason ?? t("notFoundNoReason")}
          </div>
          <AgentAttempt result={r} />
        </div>
      </div>
    </div>
  );
}

function RequestFailedCard({
  result: r,
  provider,
  retrySelected = false,
  onToggleRetrySelected,
}: {
  result: AppleMatchResult;
  provider: MusicProvider;
  retrySelected?: boolean;
  onToggleRetrySelected?: () => void;
}) {
  const { t } = useTranslation("match");
  const artistLine = r.track.artists.join(", ");

  return (
    <div className="rounded-lg border border-orange-500/30 bg-slate-800/50 p-4">
      <div className="flex items-start gap-3">
        {onToggleRetrySelected && (
          <input
            type="checkbox"
            checked={retrySelected}
            onChange={onToggleRetrySelected}
            className="mt-6 h-4 w-4 flex-shrink-0 accent-indigo-500"
            aria-label={t("retry.selectTrack", {
              name: r.track.originalName,
            })}
          />
        )}
        {r.track.albumCoverUrl ? (
          <img
            src={r.track.albumCoverUrl}
            alt=""
            className="h-16 w-16 flex-shrink-0 rounded object-cover"
          />
        ) : (
          <div className="h-16 w-16 flex-shrink-0 rounded bg-slate-700" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("original.heading")}
            </span>
            <ProviderBadge provider={provider} />
            <span
              className={`ml-auto inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE.request_failed}`}
            >
              {t("status.request_failed")}
            </span>
          </div>
          <div className="mt-1 truncate text-base font-semibold text-white">
            {r.track.originalName}
          </div>
          <div className="truncate text-sm text-slate-300">{artistLine}</div>
          {r.track.albumName && (
            <div className="truncate text-xs text-slate-500">
              {r.track.albumName}
            </div>
          )}
          <div className="mt-2 break-words text-xs text-orange-200/80">
            {r.reason ?? t("requestFailedNoReason")}
          </div>
          <AgentAttempt result={r} />
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
  tone: "success" | "danger" | "rejected" | "warning" | "failure" | "neutral";
}) {
  const toneClasses: Record<typeof tone, string> = {
    success: "text-green-300",
    danger: "text-red-300",
    rejected: "text-fuchsia-200",
    warning: "text-yellow-200",
    failure: "text-orange-200",
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
