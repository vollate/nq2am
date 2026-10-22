// Preloaded in the CLI and its server child, before Mastra or dotenv is imported.
// Defense in depth, not an OS sandbox: this viewer has no registered agents or runnable tools.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

function local(host) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}
function assertUrl(value) {
  const url = new URL(value);
  if (["data:", "blob:"].includes(url.protocol)) return;
  if (!["http:", "https:"].includes(url.protocol) || !local(url.hostname))
    throw new Error("nq2am Studio blocks outbound network requests");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  assertUrl(input instanceof Request ? input.url : String(input));
  return originalFetch(input, { ...init, redirect: "error" });
};
for (const transport of [http, https]) {
  for (const method of ["request", "get"]) {
    const original = transport[method];
    transport[method] = function (input, ...args) {
      if (typeof input === "string" || input instanceof URL) assertUrl(String(input));
      else {
        const host = input?.hostname ?? input?.host ?? "localhost";
        if (!local(host) || input?.socketPath) throw new Error("nq2am Studio blocks outbound network requests");
      }
      // URL overloads can override hostname through the second options argument.
      const options = args[0];
      if (options && typeof options === "object") {
        const host = options.hostname ?? options.host;
        if ((host && !local(host)) || options.socketPath)
          throw new Error("nq2am Studio blocks outbound network requests");
      }
      return original.call(this, input, ...args);
    };
  }
}
syncBuiltinESMExports();
