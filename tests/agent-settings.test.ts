import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import type { Transport } from "../server/agent/llm.js";
import { isLoopback, localAgentOnly, validateBaseUrl } from "../server/agent/security.js";
import { AgentService } from "../server/agent/service.js";
import { AgentSettingsStore, parseSettings } from "../server/agent/settings.js";
import { AgentLog, redact } from "../server/agent/storage.js";
import { createAgentRouter } from "../server/routes/agent.js";

test("settings round trip, keep/clear secrets, atomic secure modes; API never returns keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-settings-"));
  const path = join(dir, "agent-settings.json");
  const store = new AgentSettingsStore(path);
  assert.equal((await store.get()).model, "");
  const view = await store.put({ baseUrl: "http://127.0.0.1:8080/v1/", model: "test", apiKey: "private-secret" });
  assert.equal(view.hasApiKey, true);
  assert.equal(view.baseUrl, "http://127.0.0.1:8080/v1");
  assert.ok(!("apiKey" in view));
  await Promise.all([store.put({ model: "next" }), store.put({ baseUrl: "https://example.com/v1" })]);
  assert.equal((await store.get()).apiKey, "private-secret");
  assert.equal((await store.get()).model, "next");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await store.put({ apiKey: null });
  assert.equal((await store.get()).apiKey, undefined);
  assert.ok(!(await readFile(path, "utf8")).includes("private-secret"));
  assert.equal(parseSettings({}, await store.get()).apiKey, undefined);
});

test("Base URL only permits HTTPS or loopback HTTP without credentials/query/fragment", () => {
  for (const url of [
    "http://evil.test",
    "https://user:pass@example.com",
    "https://example.com/?key=123",
    "https://example.com/#fragment",
    "https://example.com/?",
    "file:///tmp/config",
    "http://localhost.evil/"
  ])
    assert.throws(() => validateBaseUrl(url), url);
  for (const url of [
    "http://localhost:9000/v1",
    "http://127.0.0.2:9000",
    "http://[::1]:9000/v1",
    "https://example.com/v1"
  ])
    assert.ok(validateBaseUrl(url));
  assert.equal(isLoopback("::ffff:127.0.0.1"), true);
  assert.equal(isLoopback("192.168.0.1"), false);
});

test("local guard rejects remote sockets, rebound Host, foreign Origin even with forwarding headers", () => {
  function invoke(address: string, host: string, origin?: string, extra: Record<string, string> = {}) {
    let passed = false;
    let status = 0;
    const res: any = {
      status(code: number) {
        status = code;
        return res;
      },
      json() {}
    };
    localAgentOnly(
      { socket: { remoteAddress: address }, protocol: "http", headers: { host, origin, ...extra } } as any,
      res,
      () => {
        passed = true;
      }
    );
    return { passed, status };
  }
  assert.equal(invoke("127.0.0.1", "localhost:3001", "http://localhost:3001").passed, true);
  assert.equal(invoke("::1", "localhost:3001", "http://localhost:5173").passed, true);
  assert.equal(invoke("192.168.1.2", "localhost:3001", undefined, { "x-forwarded-for": "127.0.0.1" }).status, 403);
  assert.equal(invoke("127.0.0.1", "evil.test", "http://evil.test").status, 403);
  assert.equal(invoke("127.0.0.1", "localhost:3001", "https://evil.test").status, 403);
  assert.equal(invoke("127.0.0.1", "localhost:3001", "null").status, 403);
});

test("real settings/test HTTP routes accept unsaved form, verify tools, do not persist or echo credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-api-"));
  const store = new AgentSettingsStore(join(dir, "settings.json"));
  await store.put({ model: "saved", apiKey: "secret-test" });
  let calls = 0;
  const transport = (async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "unsaved");
    assert.equal(body.tools[0].function.name, "connection_test");
    assert.equal((init!.headers as any).Authorization, "Bearer secret-test");
    assert.equal(init!.redirect, "error");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                { id: "a", type: "function", function: { name: "connection_test", arguments: '{"ok":true}' } }
              ]
            }
          }
        ]
      })
    );
  }) as Transport;
  const app = express();
  app.use(express.json());
  app.use("/api", createAgentRouter(new AgentService(), store, transport));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/agent/settings`;
  try {
    const view = await (await fetch(url)).json();
    assert.equal(view.hasApiKey, true);
    assert.equal(view.apiKey, undefined);
    const testResult = await (
      await fetch(`${url}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "unsaved" })
      })
    ).json();
    assert.equal(testResult.supported, true);
    assert.equal(calls, 1);
    assert.equal((await store.get()).model, "saved");
    assert.equal((await fetch(url, { headers: { Origin: "https://evil.test" } })).status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("trace/result logs are private and consistently redact credentials and raw payloads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-log-"));
  const log = new AgentLog(join(dir, "run"), ["private-secret"]);
  await log.init();
  await log.json("manifest.json", { apiKey: "private-secret", model: "fake" });
  await log.trace(0)({
    Authorization: "Bearer abc",
    cookie: "session=123",
    raw: { secret: "raw-private" },
    content: "private-secret Bearer abc"
  });
  const trace = await readFile(join(log.dir, "track-0/trace.jsonl"), "utf8");
  for (const value of ["private-secret", "raw-private", "session=123", "Bearer abc"]) assert.ok(!trace.includes(value));
  assert.equal((await stat(log.dir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(log.dir, "track-0"))).mode & 0o777, 0o700);
  assert.equal((await stat(join(log.dir, "track-0/trace.jsonl"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(log.dir, "manifest.json"))).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(redact({ error: "Authorization: Bearer password" })).includes("password"));
});
