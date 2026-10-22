import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { allowedMethod, allowedRequest, localStudioGuard, studioPort } from "../src/security.js";

const exec = promisify(execFile);
test("rejects external Host/Origin and cross-site requests, even with forged forwarding headers", () => {
  const headers = new Headers({ host: "127.0.0.1:4111" });
  assert.equal(allowedRequest(headers, 4111), true);
  headers.set("origin", "https://untrusted.example");
  headers.set("x-forwarded-for", "127.0.0.1");
  assert.equal(allowedRequest(headers, 4111), false);
  headers.set("origin", "http://127.0.0.1:4111");
  assert.equal(allowedRequest(headers, 4111), true);
  headers.set("host", "untrusted.example:4111");
  assert.equal(allowedRequest(headers, 4111), false);
  headers.set("host", "localhost:4111");
  headers.delete("origin");
  headers.set("sec-fetch-site", "cross-site");
  assert.equal(allowedRequest(headers, 4111), false);
  assert.equal(studioPort("4211"), 4211);
  for (const port of ["0", "80", "65536", "abc", "4111junk"]) assert.throws(() => studioPort(port));
});

test("only the local cache-sync operation is writable; agent execution and deletion are blocked", () => {
  assert.equal(allowedMethod("GET", "/api/observability/traces"), true);
  assert.equal(allowedMethod("POST", "/nq2am/sync"), true);
  for (const path of [
    "/api/agents",
    "/api/agents/demo/generate",
    "/api/workflows/run",
    "/api/observability/traces/score",
    "/api/observability/traces"
  ]) {
    assert.equal(allowedMethod("POST", path), false);
    assert.equal(allowedMethod("DELETE", path), false);
    assert.equal(allowedMethod("PUT", path), false);
  }
});

test("automatic discovery runs before trace reads and only after socket/origin/method validation", async () => {
  const order: string[] = [];
  const guard = localStudioGuard(4111, async () => {
    await Promise.resolve();
    order.push("scan");
  });
  const call = async (path: string, method = "GET", origin = "http://127.0.0.1:4111", address = "127.0.0.1") => {
    const context = {
      env: { incoming: { socket: { remoteAddress: address } } },
      req: {
        raw: new Request(`http://127.0.0.1:4111${path}`, { headers: { host: "127.0.0.1:4111", origin } }),
        path,
        method
      },
      json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
      header: () => {}
    } as unknown as Parameters<typeof guard>[0];
    return guard(context, async () => {
      order.push("read");
    });
  };
  await call("/api/observability/traces/light");
  assert.deepEqual(order, ["scan", "read"]);
  order.length = 0;
  assert.equal((await call("/api/observability/traces", "GET", "https://evil.example"))?.status, 403);
  assert.equal((await call("/api/observability/traces", "GET", "http://127.0.0.1:4111", "203.0.113.1"))?.status, 403);
  assert.equal((await call("/api/observability/traces", "DELETE"))?.status, 405);
  assert.deepEqual(order, []);
  await call("/nq2am/import-status");
  assert.deepEqual(order, ["read"]);
});

test("preloaded guard blocks fetch and Node HTTP egress before any network request", async () => {
  const guard = fileURLToPath(new URL("../scripts/network-guard.mjs", import.meta.url));
  const code = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import https from 'node:https';
    await assert.rejects(fetch('https://example.com'), /blocks outbound/);
    assert.throws(() => https.get('https://example.com'), /blocks outbound/);
    assert.throws(() => http.request({hostname:'example.com'}), /blocks outbound/);
    assert.throws(() => http.request('http://127.0.0.1', {hostname:'example.com'}), /blocks outbound/);
    const server = http.createServer((req,res) => { res.writeHead(302,{Location:'https://example.com'}); res.end(); });
    server.listen(0,'127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    await assert.rejects(fetch('http://127.0.0.1:' + server.address().port));
    await new Promise(resolve => server.close(resolve));
    console.log('offline guard passed');
  `;
  const { stdout } = await exec(process.execPath, ["--import", guard, "--input-type=module", "-e", code]);
  assert.match(stdout, /offline guard passed/);
});
