import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { sampleTrack } from "./demo.mjs";

// Runs the real Mastra CLI and UI, backed only by private, synthetic fixtures.
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
let output = "";
const child = spawn(process.execPath, [fileURLToPath(new URL("./start.mjs", import.meta.url)), "--demo"], {
  env: { ...process.env, NQ2AM_STUDIO_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32"
});
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (data) => {
    output = (output + data.toString()).slice(-20000);
  });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`Studio exited early: ${output}`);
    try {
      if ((await fetch(`${base}/nq2am/import-status`, { signal: AbortSignal.timeout(500) })).ok) {
        ready = true;
        break;
      }
    } catch {
      /* The server is still compiling. */
    }
    await delay(200);
  }
  assert.ok(ready, `Studio did not start: ${output}`);
  const request = (path, method = "GET", headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(`${base}${path}`, { method, headers }, (res) => {
        res.resume();
        res.once("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
  for (const path of ["/api/observability/traces", "/nq2am/import-status", "/nq2am/sync"]) {
    const method = path.endsWith("sync") ? "POST" : "GET";
    assert.equal(await request(path, method, { Host: "evil.example" }), 403);
    assert.equal(await request(path, method, { Origin: "https://evil.example" }), 403);
  }
  assert.equal(await request("/api/agents/offline/generate", "POST"), 405);
  assert.equal(await request("/api/observability/traces", "DELETE"), 405);
  const sync = await fetch(`${base}/nq2am/sync`, { method: "POST" });
  assert.equal(sync.status, 200);
  assert.equal((await sync.json()).unchanged, 2);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const external = [];
  const pageErrors = [];
  const badResponses = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith("data:")) external.push(r.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${base}/observability`);
  await page.getByText("[Demo] Studio integration · matched", { exact: true }).waitFor();
  // Create an entirely new batch while Studio is open. Opening/reloading the native list must discover it without sync POST/CLI.
  const dataDir = /Data: ([^\r\n]+)/.exec(output)?.[1];
  assert.ok(dataDir);
  const previousRun = (await readdir(join(dataDir, "agent-runs")))[0];
  const runId = "30000000-0000-4000-8000-000000000002";
  const runDir = join(dataDir, "agent-runs", runId);
  const dir = join(runDir, "track-0");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(
    join(runDir, "manifest.json"),
    await readFile(join(dataDir, "agent-runs", previousRun, "manifest.json")),
    { mode: 0o600 }
  );
  const unknown = sampleTrack();
  unknown.result.original.track.originalName = "[Demo] Unknown usage";
  for (const event of unknown.events)
    if (event.event === "response") {
      delete event.usage;
      delete event.body.usage;
    }
  await writeFile(join(dir, "trace.jsonl"), unknown.events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
    mode: 0o600
  });
  await writeFile(join(dir, "result.json"), JSON.stringify({ status: "pending" }), { mode: 0o600 });
  await delay(1100);
  assert.equal((await (await fetch(`${base}/api/observability/traces`)).json()).pagination.total, 2);
  const pending = await (await fetch(`${base}/nq2am/import-status`)).json();
  assert.ok(pending.skipped.some((item) => item.path === `${runId}/track-0` && item.reason === "incomplete"));
  assert.equal(pending.autoDiscovery.trigger, "trace-read");
  await writeFile(join(dir, "result.json"), JSON.stringify(unknown.result), { mode: 0o600 });
  // This pinned Studio's rolling Auto refresh does not refetch its legacy LibSQL query key.
  // Reload is the supported native-UI path; do not patch the upstream bundle or claim live following.
  await delay(1100);
  await page.reload();
  await page.getByText("[Demo] Unknown usage · matched", { exact: true }).waitFor({ timeout: 15000 });
  assert.equal((await (await fetch(`${base}/api/observability/traces`)).json()).pagination.total, 3);

  await page.getByText("[Demo] Studio integration · matched", { exact: true }).click();
  await page.getByRole("button", { name: /^HTTP 2 · offline-demo/ }).click();
  await page.getByText("Tokens Used", { exact: true }).waitFor();
  const text = await page.locator("body").innerText();
  assert.match(text, /Cache read/);
  assert.match(text, /Reasoning/);
  assert.match(text, /Round 1/);
  assert.match(text, /Round 2/);
  assert.equal(text.includes("demo-private-cookie"), false);
  await page.screenshot({ path: join(tmpdir(), "nq2am-studio-model.png"), fullPage: true });
  await page.getByRole("button", { name: /^get_track_candidates/ }).click();
  await page
    .getByText(/^output$/i)
    .first()
    .waitFor();
  assert.match(await page.locator("body").innerText(), /candidate-1/);

  await page.goto(`${base}/traces`);
  await page.getByText("[Demo] Studio integration · failed", { exact: true }).click();
  await page.getByRole("button", { name: /^complete_match/ }).click();
  await page
    .getByText(/^error$/i)
    .first()
    .waitFor();
  assert.match(await page.locator("body").innerText(), /Invalid Agent response or tool arguments/);
  await page.screenshot({ path: join(tmpdir(), "nq2am-studio-failure.png"), fullPage: true });

  await page.goto(`${base}/traces`);
  await page.getByText("[Demo] Unknown usage · matched", { exact: true }).click();
  await page.getByRole("button", { name: /^HTTP 1 · offline-demo · usage unknown/ }).click();
  await page
    .getByText(/^input$/i)
    .first()
    .waitFor();
  assert.equal(await page.getByText("Tokens Used", { exact: true }).count(), 0);
  assert.deepEqual(external, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(badResponses, []);
  console.log(
    "Studio smoke passed: real CLI/UI, rounds, tool details, failures, usage, local-only/read-only guards, automatic discovery of a newly completed batch on page reload without a sync command, zero external browser requests."
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  if (process.platform === "win32") child.kill("SIGTERM");
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5000)]);
}
