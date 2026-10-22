import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentLog } from "../server/agent/storage.js";

test("Agent logs add real observation timestamps while preserving snapshotting, privacy and standalone operation", async () => {
  const dir = join(await mkdtemp(join(tmpdir(), "agent-observation-")), "run");
  let now = 1700000000000;
  const log = new AgentLog(dir, ["configured-secret"], () => now);
  await log.init();
  const messages = [{ role: "user", content: "configured-secret" }];
  const write = log.trace(0)({ event: "request", recordedAt: "untrusted", body: { messages } });
  messages.push({ role: "assistant", content: "later" });
  now += 100;
  await write;
  await log.trace(0)({ event: "response", body: { source: { raw: "private" } } });
  const file = join(dir, "track-0/trace.jsonl");
  const rows = (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(rows[0].recordedAt, "2023-11-14T22:13:20.000Z");
  assert.equal(rows[1].recordedAt, "2023-11-14T22:13:20.100Z");
  assert.equal(rows[0].body.messages.length, 1);
  assert.equal(rows[0].body.messages[0].content, "[REDACTED]");
  assert.equal(rows[1].body.source.raw, "[REDACTED]");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, "track-0"))).mode & 0o777, 0o700);
});
