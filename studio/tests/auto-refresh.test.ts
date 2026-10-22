import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { sampleTrack, writeDemo } from "../scripts/demo.mjs";
import { AUTO_REFRESH_MIN_INTERVAL_MS, LogImporter } from "../src/importer.js";
import { traceIdFor } from "../src/project.js";
import { createStudioRuntime } from "../src/runtime.js";

const newRunId = "30000000-0000-4000-8000-000000000001";

test("automatic reads discover a new batch, coalesce concurrent scans, and retry pending files after completion", async (t) => {
  const dataDir = await writeDemo();
  const { storage } = await createStudioRuntime(dataDir);
  t.after(() => storage.close());
  const store = await storage.getStore("observability");
  assert.ok(store);
  let now = 0;
  const reader = new LogImporter(dataDir, store, () => now);
  const first = reader.refresh();
  assert.equal(reader.refresh(), first);
  assert.equal(reader.sync(), first);
  const initial = await first;
  assert.equal(initial.unchanged, 2);

  const runDir = join(dataDir, "agent-runs", newRunId);
  const dir = join(runDir, "track-0");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(runDir, "manifest.json"), JSON.stringify({ model: "offline", status: "running" }));
  const track = sampleTrack();
  await writeFile(join(dir, "trace.jsonl"), JSON.stringify(track.events[0]));
  await writeFile(join(dir, "result.json"), JSON.stringify({ original: track.result.original, status: "pending" }));
  assert.equal(await reader.refresh(), initial); // The same UI request burst uses the cached report.
  now += AUTO_REFRESH_MIN_INTERVAL_MS;
  assert.equal((await reader.refresh()).skipped[0].reason, "incomplete");
  assert.equal(await store.getRootSpan({ traceId: traceIdFor(newRunId, 0) }), null);

  // A completed JSONL can precede result.json's atomic write. Do not publish an inconsistent snapshot.
  await writeFile(join(dir, "trace.jsonl"), track.events.map((event) => JSON.stringify(event)).join("\n"));
  now += AUTO_REFRESH_MIN_INTERVAL_MS;
  assert.equal((await reader.refresh()).skipped[0].reason, "incomplete");
  await writeFile(join(dir, "result.json"), JSON.stringify(track.result));
  const original = await readFile(join(dir, "trace.jsonl"));
  now += AUTO_REFRESH_MIN_INTERVAL_MS;
  const finished = await reader.refresh();
  assert.equal(finished.imported, 1);
  assert.deepEqual(finished.skipped, []);
  assert.equal((await store.getRootSpan({ traceId: traceIdFor(newRunId, 0) }))?.span.metadata?.outcome, "matched");
  assert.deepEqual(await readFile(join(dir, "trace.jsonl")), original);

  // Later completed files remain discoverable even inside an existing batch directory.
  const next = join(runDir, "track-1");
  await mkdir(next, { mode: 0o700 });
  await writeFile(join(next, "trace.jsonl"), original);
  await writeFile(join(next, "result.json"), JSON.stringify(track.result));
  now += AUTO_REFRESH_MIN_INTERVAL_MS;
  assert.equal((await reader.refresh()).imported, 1);
  assert.equal((await store.listTraces({ pagination: { page: 0, perPage: 100 } })).pagination?.total, 4);
});

test("unchanged skipped logs are not parsed/deleted repeatedly, and repaired files are discovered automatically", async (t) => {
  const dataDir = await writeDemo();
  const runId = (await readdir(join(dataDir, "agent-runs")))[0];
  const file = join(dataDir, "agent-runs", runId, "track-0/trace.jsonl");
  const original = await readFile(file, "utf8");
  const old = original
    .trim()
    .split("\n")
    .map((line) => {
      const event = JSON.parse(line);
      delete event.recordedAt;
      return JSON.stringify(event);
    })
    .join("\n");
  await writeFile(file, old);
  const { storage } = await createStudioRuntime(dataDir);
  t.after(() => storage.close());
  const store = await storage.getStore("observability");
  assert.ok(store);
  let now = 0;
  let deletes = 0;
  const remove = store.batchDeleteTraces.bind(store);
  store.batchDeleteTraces = async (args) => {
    deletes++;
    await remove(args);
  };
  const reader = new LogImporter(dataDir, store, () => now);
  assert.equal((await reader.refresh()).skipped[0].reason, "missing_timestamps");
  assert.equal(deletes, 1);
  now += AUTO_REFRESH_MIN_INTERVAL_MS;
  assert.equal((await reader.refresh()).skipped[0].reason, "missing_timestamps");
  assert.equal(deletes, 1);
  await writeFile(file, original);
  now += AUTO_REFRESH_MIN_INTERVAL_MS;
  assert.equal((await reader.refresh()).imported, 1);
  assert.equal(reader.report.skipped.length, 0);
});

test("manifest progress changes do not rewrite completed tracks; relevant metadata and same-size edits do", async (t) => {
  const dataDir = await writeDemo();
  const { storage } = await createStudioRuntime(dataDir);
  t.after(() => storage.close());
  const store = await storage.getStore("observability");
  assert.ok(store);
  let now = 0;
  const reader = new LogImporter(dataDir, store, () => now);
  await reader.refresh();
  let writes = 0;
  const create = store.batchCreateSpans.bind(store);
  store.batchCreateSpans = async (args) => {
    writes++;
    await create(args);
  };
  const runId = (await readdir(join(dataDir, "agent-runs")))[0];
  const manifestFile = join(dataDir, "agent-runs", runId, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.processed = 42;
  await writeFile(manifestFile, JSON.stringify(manifest));
  now += AUTO_REFRESH_MIN_INTERVAL_MS;
  assert.equal((await reader.refresh()).unchanged, 2);
  assert.equal(writes, 0);

  manifest.prefixHash = "updated-prefix";
  await writeFile(manifestFile, JSON.stringify(manifest));
  now += AUTO_REFRESH_MIN_INTERVAL_MS;
  assert.equal((await reader.refresh()).imported, 2);
  assert.equal(writes, 2);
  const resultFile = join(dataDir, "agent-runs", runId, "track-0/result.json");
  const before = await readFile(resultFile, "utf8");
  const after = before.replace("Offline fixture", "Revised fixture");
  assert.equal(after.length, before.length);
  assert.notEqual(after, before);
  await writeFile(resultFile, after);
  now += AUTO_REFRESH_MIN_INTERVAL_MS;
  assert.equal((await reader.refresh()).imported, 1);
  assert.equal(writes, 3);
});
