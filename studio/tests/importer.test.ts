import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { writeDemo } from "../scripts/demo.mjs";
import { LogImporter } from "../src/importer.js";
import { traceIdFor } from "../src/project.js";
import { createStudioRuntime } from "../src/runtime.js";

async function hashes(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(file));
    else if (entry.isFile())
      result[file] = createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
  }
  return result;
}

test("imports into real local Mastra storage, survives restart, refreshes idempotently, never changes originals or uses network", async (t) => {
  const dataDir = await writeDemo();
  const before = await hashes(join(dataDir, "agent-runs"));
  const savedFetch = globalThis.fetch;
  let network = 0;
  globalThis.fetch = async () => {
    network++;
    throw new Error("No network permitted in import test");
  };
  t.after(() => {
    globalThis.fetch = savedFetch;
  });
  const { storage, importer } = await createStudioRuntime(dataDir);
  t.after(() => storage.close());
  assert.equal(importer.report.imported, 2);
  assert.deepEqual(importer.report.skipped, []);
  assert.equal((await importer.sync()).unchanged, 2);
  const store = (await storage.getStore("observability"))!;
  const runId = (await readdir(join(dataDir, "agent-runs")))[0];
  const traceId = traceIdFor(runId, 0);
  const trace = await store.getTrace({ traceId });
  assert.ok(trace && trace.spans.length > 5);
  assert.equal((await store.getRootSpan({ traceId }))?.span.metadata?.executionStatus, "completed");
  assert.deepEqual(await hashes(join(dataDir, "agent-runs")), before);
  assert.equal((await stat(join(dataDir, "mastra-studio"))).mode & 0o777, 0o700);
  assert.equal((await stat(join(dataDir, "mastra-studio/traces.db"))).mode & 0o777, 0o600);
  const restarted = new LogImporter(dataDir, store);
  assert.equal((await restarted.sync()).unchanged, 2);

  const resultFile = join(dataDir, "agent-runs", runId, "track-0/result.json");
  const result = JSON.parse(await readFile(resultFile, "utf8"));
  result.conclusion.reason = "Updated fixture conclusion";
  await writeFile(resultFile, JSON.stringify(result));
  assert.equal((await restarted.sync()).imported, 1);
  assert.equal((await store.getTrace({ traceId }))?.spans.length, trace.spans.length);
  const refreshed = await store.getRootSpan({ traceId });
  assert.ok(refreshed);
  assert.equal((refreshed.span.output as any).validatedConclusion.reason, "Updated fixture conclusion");
  assert.equal(network, 0);

  // A later cancellation with a stale result snapshot must remove the cached success, not keep it green.
  const traceFile = join(dataDir, "agent-runs", runId, "track-0/trace.jsonl");
  await writeFile(
    traceFile,
    (await readFile(traceFile, "utf8")) +
      JSON.stringify({
        event: "run_stopped",
        attempt: { status: "cancelled" },
        recordedAt: new Date().toISOString()
      }) +
      "\n"
  );
  assert.equal((await restarted.sync()).skipped[0].reason, "inconsistent_result");
  assert.equal(await store.getRootSpan({ traceId }), null);
});

test("missing timestamps, corrupt logs and symlinks are skipped safely and surfaced in the report", async (t) => {
  const dataDir = await writeDemo();
  const runId = (await readdir(join(dataDir, "agent-runs")))[0];
  const file = join(dataDir, "agent-runs", runId, "track-0/trace.jsonl");
  const old = (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const event = JSON.parse(line);
      delete event.recordedAt;
      return JSON.stringify(event);
    })
    .join("\n");
  await writeFile(file, old);
  const second = join(dataDir, "agent-runs", runId, "track-1/trace.jsonl");
  await writeFile(second, '{"event":');
  await symlink(
    join(dataDir, "agent-runs", runId),
    join(dataDir, "agent-runs", "20000000-0000-4000-8000-000000000001")
  );
  const before = await hashes(join(dataDir, "agent-runs"));
  const { storage, importer } = await createStudioRuntime(dataDir);
  t.after(() => storage.close());
  assert.equal(importer.report.imported, 0);
  assert.deepEqual(
    importer.report.skipped.map((x) => x.reason),
    ["missing_timestamps", "invalid_log"]
  );
  assert.deepEqual(await hashes(join(dataDir, "agent-runs")), before);
});
