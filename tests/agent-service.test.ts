import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import type { Transport } from "../server/agent/llm.js";
import type { AppleApiSession } from "../src/apple/api.js";
import { emptyArtistAliasSnapshot } from "../src/apple/artistAliasIndex.js";
import { type AppleMatchResult, DEFAULT_MATCH_PREFERENCES, type NormalizedPlaylist } from "../src/types.js";

process.env.NQ2AM_DATA_DIR = await mkdtemp(join(tmpdir(), "agent-service-"));
const { AgentService } = await import("../server/agent/service.js");
const { AgentLog, AgentIOError } = await import("../server/agent/storage.js");
const state = await import("../server/state.js");
const { taskLock } = await import("../server/taskLocks.js");
const settings = { baseUrl: "http://localhost:9999/v1", model: "offline", apiKey: "secret-value" };
const session: AppleApiSession = {
  getStorefront: async () => "us",
  search: async () => [],
  songsByIsrc: async () => [],
  createPlaylist: async () => "never",
  getStats: () => ({ requestCount: 0, retryCount: 0 }),
  close: async () => {}
};
let serial = 0;
async function seed() {
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: `agent-${++serial}`,
    name: "Test",
    raw: {},
    tracks: Array.from({ length: 3 }, (_, i) => ({
      originalName: `Song ${i}`,
      artists: ["Artist"],
      source: { provider: "qq", raw: { Cookie: "not-in-logs" } }
    }))
  };
  const key = await state.addPlaylist(playlist);
  state.setMatchReport(key, {
    provider: "qq",
    results: playlist.tracks.map(
      (track, i): AppleMatchResult => ({
        track,
        status: "ambiguous",
        selectedId: "old",
        candidates: [{ id: String(i), name: track.originalName, artistName: "Artist", storefront: "us", score: 0.1 }]
      })
    )
  });
  await state.persistTasks();
  return { key, playlist, task: (await state.getTask(key))! };
}
function reply(outcome = "matched") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                type: "function",
                id: "finish",
                function: {
                  name: "complete_match",
                  arguments: JSON.stringify({
                    outcome,
                    ...(outcome === "matched" ? { candidateKey: "candidate-1" } : {}),
                    evidence: outcome === "matched" ? ["candidate-1"] : [],
                    reason: "Checked catalog metadata"
                  })
                }
              }
            ]
          }
        }
      ],
      usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } }
    })
  );
}
function service(transport: Transport, options: ConstructorParameters<typeof AgentService>[0] = {}) {
  return new AgentService({
    settings: async () => settings,
    preferences: async () => DEFAULT_MATCH_PREFERENCES,
    sessionFactory: async () => session,
    aliases: async () => emptyArtistAliasSnapshot(),
    transport,
    ...options
  });
}

test("batch only touches selected rows, applies successes durably, preserves non-success and manual override", async () => {
  const { key, task } = await seed();
  const untouched = task.matchReport!.results[1];
  const originalLast = structuredClone(task.matchReport!.results[2]);
  let calls = 0;
  const agent = service((async () => reply(++calls === 1 ? "matched" : "uncertain")) as Transport);
  const run = await agent.start(key, [0, 0, 2]);
  assert.equal(run.total, 2);
  await agent.wait(key);
  assert.equal(run.status, "completed");
  assert.equal(run.matched, 1);
  assert.equal(run.uncertain, 1);
  assert.equal(calls, 2);
  assert.equal(task.matchReport!.results[1], untouched);
  assert.equal(task.matchReport!.results[0].selectionSource, "agent");
  const { agentAttempt, ...preserved } = task.matchReport!.results[2];
  assert.deepEqual(preserved, originalLast);
  assert.equal(agentAttempt?.outcome, "uncertain");
  const disk = JSON.parse(await readFile(join(process.env.NQ2AM_DATA_DIR!, "tasks.json"), "utf8"));
  assert.equal(disk.find((t: any) => t.key === key).matchReport.results[0].selectionSource, "agent");
  const trace = await readFile(join(run.logDir, "track-0/trace.jsonl"), "utf8");
  assert.ok(trace.includes('"event":"request"'));
  assert.ok(trace.includes('"event":"response"'));
  assert.ok(!trace.includes("secret-value"));
  assert.ok(!trace.includes("not-in-logs"));
  assert.equal(JSON.parse(await readFile(join(run.logDir, "manifest.json"), "utf8")).usage.cachedTokens, 0);
  state.setTrackSelection(key, 0, "0");
  assert.equal(task.matchReport!.results[0].selectionSource, "manual");
  assert.equal(taskLock(key), undefined);
});

test("duplicate starts are idempotent; all mutation routes reject cross-operation conflicts atomically", async () => {
  const { key, playlist, task } = await seed();
  const other = await seed();
  let entered!: () => void;
  const seen = new Promise<void>((r) => {
    entered = r;
  });
  let resolve!: (r: Response) => void;
  let calls = 0;
  const agent = service((() => {
    calls++;
    entered();
    return new Promise<Response>((r) => {
      resolve = r;
    });
  }) as Transport);
  const run = await agent.start(key, [0]);
  await seen;
  assert.equal((await agent.start(key, [0, 0])).runId, run.runId);
  assert.equal(calls, 1);
  await assert.rejects(agent.start(key, [1]), /busy/);
  await assert.rejects(state.addPlaylist(playlist), /busy/);
  await assert.rejects(state.updateTrack(key, 0, { originalName: "Changed" }), /busy/);
  await assert.rejects(state.deleteTracks(key, [0]), /busy/);
  await assert.rejects(state.deleteTasks([other.key, key]), /busy/);
  assert.ok(await state.getTask(other.key));
  assert.throws(() => state.setTrackSelection(key, 0, null), /busy/);
  const app = express();
  app.use(express.json());
  app.use("/api", (await import("../server/routes/match.js")).default);
  app.use("/api", (await import("../server/routes/playlists.js")).default);
  app.use(
    "/api/apple",
    (await import("../server/routes/apple.js")).createAppleRouter(async () => {
      throw new Error("should not run");
    })
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api`;
  try {
    const send = (path: string, body: unknown, method = "POST") =>
      fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await send("/match-apple", { playlistId: key })).status, 409);
    assert.equal((await send(`/match-apple/${key}/retry`, { scope: "all" })).status, 409);
    assert.equal((await send("/apple/create-playlist", { playlistId: key })).status, 409);
    assert.equal((await send(`/match-apple/${key}/tracks/0`, { appleMusicId: null }, "PUT")).status, 409);
    assert.equal((await send("/tasks", { keys: [other.key, key] }, "DELETE")).status, 409);
    const before = JSON.stringify(task.matchReport);
    const job = await (await fetch(`${url}/match-apple/${key}`)).json();
    assert.equal(job.status, "matching");
    assert.equal(job.agentRun.runId, run.runId);
    assert.equal(JSON.stringify(task.matchReport), before);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  assert.throws(() => agent.cancel(key, "old-run"), /not active/);
  agent.cancel(key, run.runId);
  await agent.wait(key);
  resolve(reply());
  await new Promise((r) => setImmediate(r));
  assert.equal(task.matchReport!.results[0].selectedId, "old");
  assert.equal(task.matchReport!.results[0].agentAttempt?.status, "cancelled");
  assert.equal(run.status, "cancelled");
  assert.equal(task.status, "matched");
  assert.match(await readFile(join(run.logDir, "track-0/trace.jsonl"), "utf8"), /run_stopped/);
});

test("restart recovery preserves completed matches, marks pending rows and logs interrupted without provider calls", async () => {
  const { key, task } = await seed();
  const agent = service((async () => reply()) as Transport);
  const run = await agent.start(key, [0, 1]);
  await agent.wait(key);
  const recovered = structuredClone(task);
  recovered.status = "matching";
  recovered.agentRun!.status = "running";
  recovered.matchReport!.results[1].agentAttempt!.status = "running";
  const completed = structuredClone(recovered.matchReport!.results[0]);
  const { interruptAgentTask } = await import("../server/agent/recovery.js");
  await interruptAgentTask(recovered, () => 1234);
  assert.equal(recovered.status, "matched");
  assert.equal(recovered.agentRun!.status, "interrupted");
  assert.deepEqual(recovered.matchReport!.results[0], completed);
  assert.equal(recovered.matchReport!.results[1].agentAttempt!.status, "interrupted");
  assert.equal(JSON.parse(await readFile(join(run.logDir, "manifest.json"), "utf8")).status, "interrupted");
  assert.match(await readFile(join(run.logDir, "track-1/trace.jsonl"), "utf8"), /interrupted/);
});

test("explicit ordinary retry replaces Agent rows and clears their attempts", async () => {
  const { key, task } = await seed();
  const agent = service((async () => reply()) as Transport);
  await agent.start(key, [0]);
  await agent.wait(key);
  const { retryAppleMusicResults } = await import("../src/apple/matcher.js");
  const next = await retryAppleMusicResults(task.matchReport!, [0], DEFAULT_MATCH_PREFERENCES, undefined, {
    sessionFactory: async () => session
  });
  assert.equal(next.results[0].agentAttempt, undefined);
  assert.notEqual(next.results[0].selectionSource, "agent");
  assert.equal(next.results[1], task.matchReport!.results[1]);
});

test("invalid selections never launch; fatal authentication failures stop remaining songs", async () => {
  const { key, task } = await seed();
  let calls = 0;
  const agent = service((async () => {
    calls++;
    return new Response("{}", { status: 401 });
  }) as Transport);
  for (const indices of [[], [0.5], [-1], [3], ["0"], null]) await assert.rejects(agent.start(key, indices), /indices/);
  assert.equal(calls, 0);
  const run = await agent.start(key, [0, 1, 2]);
  await agent.wait(key);
  assert.equal(run.status, "failed");
  assert.equal(calls, 1);
  assert.equal(task.matchReport!.results[1].agentAttempt?.status, "failed");
  assert.equal(task.matchReport!.results[1].selectedId, "old");
});

test("cancel during result logging is a write barrier; settings are snapshotted per batch", async () => {
  const { key, task } = await seed();
  let logging!: () => void;
  const logged = new Promise<void>((r) => {
    logging = r;
  });
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  class SlowLog extends AgentLog {
    override async json(name: string, value: any) {
      await super.json(name, value);
      if (name === "track-0/result.json" && value.conclusion?.outcome === "matched") {
        logging();
        await held;
      }
    }
  }
  const mutable = { ...settings };
  const transport = (async (_url, init) => {
    assert.equal(JSON.parse(init!.body as string).model, "offline");
    return reply();
  }) as Transport;
  const agent = service(transport, {
    settings: async () => mutable,
    logFactory: (dir, secrets) => new SlowLog(dir, secrets)
  });
  const run = await agent.start(key, [0, 1]);
  mutable.model = "changed-after-start";
  await logged;
  agent.cancel(key, run.runId);
  release();
  await agent.wait(key);
  assert.equal(run.status, "cancelled");
  assert.equal(task.matchReport!.results[0].selectedId, "old");
  assert.equal(task.matchReport!.results[0].agentAttempt?.status, "cancelled");
});

test("unwritable preflight and mid-run log/result persistence failures stop paid work", async () => {
  const first = await seed();
  let calls = 0;
  const transport = (async () => {
    calls++;
    return reply();
  }) as Transport;
  const blocker = join(process.env.NQ2AM_DATA_DIR!, "file-not-dir");
  await writeFile(blocker, "x");
  const preflight = service(transport, { logFactory: () => new AgentLog(join(blocker, "run")) });
  await assert.rejects(preflight.start(first.key, [0]), /persistence/);
  assert.equal(calls, 0);
  assert.equal(taskLock(first.key), undefined);
  class BrokenLog extends AgentLog {
    override trace(index: number) {
      const trace = super.trace(index);
      return async (event: any) => {
        if (event.event === "response") throw new AgentIOError();
        await trace(event);
      };
    }
  }
  const second = await seed();
  const middle = service(transport, { logFactory: (dir, secrets) => new BrokenLog(dir, secrets) });
  const run = await middle.start(second.key, [0, 1]);
  await middle.wait(second.key);
  assert.equal(calls, 1);
  assert.equal(run.status, "failed");
  assert.equal(second.task.matchReport!.results[0].selectedId, "old");
  assert.match(run.error ?? "", /persistence/);
  const third = await seed();
  let writes = 0;
  const brokenResult = service(transport, {
    persist: async () => {
      if (++writes >= 3) throw new Error("disk full");
      await state.persistTasks();
    }
  });
  const last = await brokenResult.start(third.key, [0, 1]);
  await brokenResult.wait(third.key);
  assert.equal(last.status, "failed");
  assert.equal(calls, 2);
  assert.equal(taskLock(third.key), undefined);
});
