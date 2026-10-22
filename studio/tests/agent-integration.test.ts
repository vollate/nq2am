import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAgentTrack } from "../../server/agent/runner.js";
import { AgentLog } from "../../server/agent/storage.js";
import { emptyArtistAliasSnapshot } from "../../src/apple/artistAliasIndex.js";
import { type AppleMatchResult, DEFAULT_MATCH_PREFERENCES } from "../../src/types.js";
import { traceIdFor } from "../src/project.js";
import { createStudioRuntime } from "../src/runtime.js";

test("the unchanged Agent runner's actual offline output is readable by Studio without rerunning matching", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "nq2am studio agent "));
  const runId = randomUUID();
  const log = new AgentLog(join(dataDir, "agent-runs", runId), ["offline-secret"]);
  await log.init();
  await log.json("manifest.json", { runId, model: "offline", status: "completed" });
  await log.trace(0)({ event: "queued" });
  const original: AppleMatchResult = {
    track: {
      originalName: "Offline actual runner",
      artists: ["Fixture"],
      source: { provider: "qq", raw: { cookie: "not-exported" } }
    },
    status: "ambiguous",
    selectedId: "old-selection",
    candidates: []
  };
  let llmCalls = 0;
  const execution = await runAgentTrack({
    runId,
    original,
    settings: { baseUrl: "http://localhost:9999/v1", model: "offline", apiKey: "offline-secret" },
    prefs: DEFAULT_MATCH_PREFERENCES,
    aliases: emptyArtistAliasSnapshot(),
    accountStore: "us",
    cache: new Map(),
    signal: new AbortController().signal,
    trace: log.trace(0),
    session: {
      getStorefront: async () => "us",
      search: async () => [],
      songsByIsrc: async () => [],
      createPlaylist: async () => {
        throw new Error("Must not create playlists");
      },
      close: async () => {},
      getStats: () => ({ requestCount: 0, retryCount: 0 })
    },
    transport: async () => {
      llmCalls++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                reasoning_content: "Offline provider field",
                tool_calls: [
                  {
                    id: "finish",
                    type: "function",
                    function: {
                      name: "complete_match",
                      arguments: JSON.stringify({ outcome: "no_match", reason: "Offline fixture", evidence: [] })
                    }
                  }
                ]
              }
            }
          ]
        })
      );
    }
  });
  await log.json("track-0/result.json", {
    original,
    conclusion: execution.result.agentAttempt,
    applied: execution.result
  });
  const { storage, importer } = await createStudioRuntime(dataDir);
  t.after(() => storage.close());
  assert.equal(importer.report.imported, 1);
  assert.deepEqual(importer.report.skipped, []);
  const store = (await storage.getStore("observability"))!;
  const root = (await store.getRootSpan({ traceId: traceIdFor(runId, 0) }))!.span;
  assert.equal(root.metadata?.outcome, "no_match");
  assert.equal((root.output as any).appliedResult.selectedId, "old-selection");
  assert.equal(root.error, null);
  assert.equal(llmCalls, 1); // Only the explicit mocked run; indexing is data-only.
  assert.equal(
    JSON.stringify(await store.getTrace({ traceId: traceIdFor(runId, 0) })).includes("offline-secret"),
    false
  );
});
