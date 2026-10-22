import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AgentRun, AgentSettings } from "../../src/agent/types.js";
import { type AppleApiSession, createAppleApiSession } from "../../src/apple/api.js";
import { loadArtistAliasCatalogSnapshot } from "../../src/apple/artistAliasCatalog.js";
import { getDataDir } from "../../src/fetchers/auth.js";
import type { AppleMatchResult, MatchPreferences } from "../../src/types.js";
import { getPreferences } from "../preferences.js";
import { getTask, persistTasks, type Task } from "../state.js";
import { acquireTask, releaseTask, TaskBusyError, taskLock } from "../taskLocks.js";
import { addUsage, emptyUsage, type Transport } from "./llm.js";
import { PREFIX_BYTES, PREFIX_HASH, PROMPT_VERSION } from "./protocol.js";
import { abortable, runAgentTrack } from "./runner.js";
import { agentSettings } from "./settings.js";
import { AgentIOError, AgentLog } from "./storage.js";

export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}
export type AgentServiceDependencies = {
  settings?: () => Promise<AgentSettings>;
  preferences?: () => Promise<MatchPreferences>;
  sessionFactory?: typeof createAppleApiSession;
  aliases?: typeof loadArtistAliasCatalogSnapshot;
  transport?: Transport;
  now?: () => number;
  persist?: () => Promise<void>;
  logFactory?: (dir: string, secrets: string[]) => AgentLog;
};
type Active = { runId: string; controller: AbortController; ready: Promise<AgentRun>; done?: Promise<void> };

export class AgentService {
  private readonly active = new Map<string, Active>();
  constructor(private readonly deps: AgentServiceDependencies = {}) {}
  async start(key: string, value: unknown): Promise<AgentRun> {
    const task = await getTask(key);
    if (!task) throw new AgentRequestError("Task not found", 404);
    if (!task.matchReport) throw new AgentRequestError("Match report required");
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((i) => !Number.isInteger(i) || i < 0 || i >= task.matchReport!.results.length)
    )
      throw new AgentRequestError("indices must be non-empty, in-range integers");
    const indices = [...new Set<number>(value)].sort((a, b) => a - b);
    const identity = JSON.stringify(indices);
    const lock = taskLock(key);
    if (lock) {
      const active = this.active.get(key);
      if (lock.operation === "agent" && lock.identity === identity && active) return active.ready;
      throw new TaskBusyError();
    }
    const runId = randomUUID();
    acquireTask(key, { operation: "agent", token: runId, identity });
    const controller = new AbortController();
    const originals = new Map(indices.map((index) => [index, structuredClone(task.matchReport!.results[index])]));
    const ready = this.prepare(task, indices, originals, runId, controller);
    const active: Active = { runId, controller, ready };
    this.active.set(key, active);
    try {
      return await ready;
    } catch (error) {
      releaseTask(key, runId);
      this.active.delete(key);
      throw error;
    }
  }
  cancel(key: string, runId: unknown): void {
    if (typeof runId !== "string") throw new AgentRequestError("runId required");
    const active = this.active.get(key);
    if (!active || active.runId !== runId) throw new AgentRequestError("This Agent run is not active", 409);
    active.controller.abort(new Error("Agent cancelled"));
  }
  async wait(key: string): Promise<void> {
    const active = this.active.get(key);
    await active?.ready;
    await active?.done;
  }
  private async persist(): Promise<void> {
    try {
      await (this.deps.persist ?? persistTasks)();
    } catch {
      throw new AgentIOError();
    }
  }
  private async prepare(
    task: Task,
    indices: number[],
    originals: Map<number, AppleMatchResult>,
    runId: string,
    controller: AbortController
  ): Promise<AgentRun> {
    const settings = structuredClone(await (this.deps.settings ?? (() => agentSettings.get()))());
    if (!settings.model) throw new AgentRequestError("Configure an Agent model first");
    const prefs = structuredClone(await (this.deps.preferences ?? getPreferences)());
    const logDir = join(getDataDir(), "agent-runs", runId);
    const log =
      this.deps.logFactory?.(logDir, [settings.apiKey ?? ""]) ?? new AgentLog(logDir, [settings.apiKey ?? ""]);
    const run: AgentRun = {
      runId,
      status: "running",
      indices,
      total: indices.length,
      processed: 0,
      matched: 0,
      noMatch: 0,
      uncertain: 0,
      failed: 0,
      model: settings.model,
      logDir,
      promptVersion: PROMPT_VERSION,
      prefixHash: PREFIX_HASH,
      prefixBytes: PREFIX_BYTES,
      usage: emptyUsage()
    };
    await log.init();
    const manifest = () => log.json("manifest.json", { ...run, baseUrl: settings.baseUrl, preferences: prefs });
    try {
      await manifest();
      for (const [index, original] of originals) {
        await log.trace(index)({ event: "queued" });
        await log.json(`track-${index}/result.json`, { original, status: "pending" });
      }
    } catch (error) {
      run.status = "failed";
      run.error = "Agent log preflight failed; no LLM requests sent";
      await manifest().catch(() => {});
      throw error;
    }
    const oldRun = task.agentRun;
    const oldStatus = task.status;
    const oldError = task.error;
    const oldProgress = task.matchProgress;
    task.agentRun = run;
    task.status = "matching";
    task.error = undefined;
    task.matchProgress = undefined;
    for (const [index, original] of originals)
      task.matchReport!.results[index] = {
        ...original,
        agentAttempt: { runId, status: "pending", model: settings.model }
      };
    try {
      await this.persist();
    } catch (error) {
      task.agentRun = oldRun;
      task.status = oldStatus;
      task.error = oldError;
      task.matchProgress = oldProgress;
      for (const [index, original] of originals) task.matchReport!.results[index] = original;
      run.status = "failed";
      run.error = "Agent persistence failed before launch";
      await manifest();
      throw error;
    }
    // No paid work until all preflight log/result/task writes succeeded.
    const active = this.active.get(task.key)!;
    active.done = this.execute(task, run, originals, settings, prefs, controller, log, manifest);
    return run;
  }
  private async execute(
    task: Task,
    run: AgentRun,
    originals: Map<number, AppleMatchResult>,
    settings: AgentSettings,
    prefs: MatchPreferences,
    controller: AbortController,
    log: AgentLog,
    manifest: () => Promise<void>
  ): Promise<void> {
    let session: AppleApiSession | undefined;
    const signal = controller.signal;
    try {
      const aliases = await (this.deps.aliases ?? (() => loadArtistAliasCatalogSnapshot(true)))();
      signal.throwIfAborted();
      const sessionPromise = (this.deps.sessionFactory ?? createAppleApiSession)({
        signal,
        requestTimeoutMs: prefs.appleRequestTimeoutMs,
        minRequestIntervalMs: prefs.appleRequestIntervalMs,
        maxAttempts: prefs.appleMaxAttempts,
        baseRetryDelayMs: prefs.appleRetryBaseDelayMs,
        randomPauseEnabled: prefs.appleRandomPauseEnabled,
        randomPauseMinMs: prefs.appleRandomPauseMinMs,
        randomPauseMaxMs: prefs.appleRandomPauseMaxMs
      });
      void sessionPromise.then(
        (s) => {
          if (signal.aborted) void s.close().catch(() => {});
        },
        () => {}
      );
      session = await abortable(sessionPromise, signal);
      const accountStore = await abortable(session.getStorefront(), signal);
      if (!/^[a-z]{2}$/.test(accountStore)) throw new Error("Invalid account storefront");
      const cache = new Map();
      for (const [index, original] of originals) {
        signal.throwIfAborted();
        run.currentIndex = index;
        task.matchReport!.results[index].agentAttempt!.status = "running";
        await this.persist();
        await manifest();
        const execution = await runAgentTrack({
          runId: run.runId,
          settings,
          original,
          prefs,
          session,
          aliases,
          accountStore,
          cache,
          signal,
          trace: log.trace(index),
          transport: this.deps.transport,
          now: this.deps.now
        });
        addUsage(run.usage, execution.usage);
        // Cancellation is a write barrier even if a provider/transport ignores abort.
        if (signal.aborted || taskLock(task.key)?.token !== run.runId) break;
        await log.json(`track-${index}/result.json`, {
          original,
          conclusion: execution.result.agentAttempt,
          applied: execution.result
        });
        if (signal.aborted || taskLock(task.key)?.token !== run.runId) break;
        task.matchReport!.results[index] = execution.result;
        const attempt = execution.result.agentAttempt!;
        run.processed++;
        if (attempt.outcome === "matched") run.matched++;
        else if (attempt.outcome === "no_match") run.noMatch++;
        else if (attempt.outcome === "uncertain") run.uncertain++;
        else run.failed++;
        task.updatedAt = (this.deps.now ?? Date.now)();
        await this.persist();
        await manifest();
        if (execution.fatal) {
          run.status = "failed";
          run.error = attempt.error;
          break;
        }
      }
      if (run.status === "running") run.status = signal.aborted ? "cancelled" : "completed";
    } catch (error) {
      run.status = signal.aborted ? "cancelled" : "failed";
      run.error =
        error instanceof AgentIOError
          ? error.message
          : signal.aborted
            ? "Agent cancelled"
            : "Agent setup/execution failed";
    } finally {
      // Abort this isolated session, never the shared browser or another task's session.
      controller.abort();
      try {
        const stopped: Array<{ index: number; original: AppleMatchResult; result: AppleMatchResult }> = [];
        for (const [index, original] of originals) {
          const row = task.matchReport!.results[index];
          if (row.agentAttempt?.runId !== run.runId || !["pending", "running"].includes(row.agentAttempt.status))
            continue;
          const result: AppleMatchResult = {
            ...original,
            agentAttempt: {
              runId: run.runId,
              model: settings.model,
              status: run.status === "cancelled" ? "cancelled" : "failed",
              error: run.error ?? "Agent run stopped",
              completedAt: new Date((this.deps.now ?? Date.now)()).toISOString()
            }
          };
          task.matchReport!.results[index] = result;
          if (run.status !== "cancelled") run.failed++;
          stopped.push({ index, original, result });
        }
        run.currentIndex = undefined;
        for (const { index, original, result } of stopped) {
          await log.trace(index)({ event: "run_stopped", attempt: result.agentAttempt });
          await log.json(`track-${index}/result.json`, { original, conclusion: result.agentAttempt, applied: result });
        }
        run.currentIndex = undefined;
        task.status = "matched";
        task.updatedAt = (this.deps.now ?? Date.now)();
        await this.persist();
        await manifest();
      } catch {
        run.status = "failed";
        run.error = "Agent log/result persistence failed; remaining work stopped.";
        task.status = "matched";
        // Best effort final diagnostics after a storage failure; never resume paid work.
        await manifest().catch(() => {});
        await this.persist().catch(() => {});
      } finally {
        await session?.close().catch(() => {});
        releaseTask(task.key, run.runId);
        this.active.delete(task.key);
      }
    }
  }
}
export const agentService = new AgentService();
