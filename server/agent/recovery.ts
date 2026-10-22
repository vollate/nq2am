import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "../../src/fetchers/auth.js";
import type { Task } from "../state.js";
import { AgentLog } from "./storage.js";

/** Recovery never creates a session or calls a provider. Completed rows remain untouched. */
export async function interruptAgentTask(task: Task, now = Date.now): Promise<void> {
  const run = task.agentRun;
  if (!run || run.status !== "running") return;
  run.status = "interrupted";
  run.currentIndex = undefined;
  run.error = "Agent interrupted by server restart; not resumed.";
  task.status = task.matchReport ? "matched" : "match_failed";
  task.matchProgress = undefined;
  const interrupted: number[] = [];
  for (const [index, row] of (task.matchReport?.results ?? []).entries()) {
    if (row.agentAttempt?.runId === run.runId && ["pending", "running"].includes(row.agentAttempt.status)) {
      row.agentAttempt.status = "interrupted";
      row.agentAttempt.error = run.error;
      row.agentAttempt.completedAt = new Date(now()).toISOString();
      interrupted.push(index);
    }
  }
  try {
    if (!/^[0-9a-f-]{36}$/i.test(run.runId)) throw new Error("Invalid persisted run ID");
    // Reconstruct paths; never trust an arbitrary path in persisted task data.
    const log = new AgentLog(join(getDataDir(), "agent-runs", run.runId));
    const previous = JSON.parse(await readFile(join(log.dir, "manifest.json"), "utf8"));
    for (const index of interrupted) {
      const row = task.matchReport!.results[index];
      const stored = JSON.parse(await readFile(join(log.dir, `track-${index}/result.json`), "utf8"));
      await log.trace(index)({ event: "interrupted", attempt: row.agentAttempt });
      await log.json(`track-${index}/result.json`, { ...stored, conclusion: row.agentAttempt, applied: row });
    }
    await log.json("manifest.json", { ...previous, ...run });
  } catch {
    run.error += " Recovery log update failed; check the data directory.";
  }
}
