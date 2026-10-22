import type { MiddlewareHandler } from "@mastra/core/server";
import { isLoopback } from "../../server/agent/security.js";

export function studioPort(value = process.env.NQ2AM_STUDIO_PORT ?? "4111"): number {
  if (!/^\d+$/.test(value)) throw new Error("NQ2AM_STUDIO_PORT must be an integer from 1024 to 65535");
  const port = Number(value);
  if (port < 1024 || port > 65535) throw new Error("NQ2AM_STUDIO_PORT must be an integer from 1024 to 65535");
  return port;
}

/** Binding is loopback-only; validate Host/Origin independently to prevent browser/DNS-rebinding access. */
export function allowedRequest(headers: Headers, port: number): boolean {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!hosts.has(headers.get("host") ?? "")) return false;
  const origin = headers.get("origin");
  if (origin && ![...hosts].some((host) => origin === `http://${host}`)) return false;
  if (!origin && ![null, "same-origin", "none"].includes(headers.get("sec-fetch-site"))) return false;
  return true;
}

export function localStudioGuard(port: number, refresh?: () => Promise<unknown>): MiddlewareHandler {
  return async (c, next) => {
    // The Node adapter exposes the actual incoming socket; never trust forwarding headers.
    const address = c.env?.incoming?.socket?.remoteAddress;
    if (typeof address !== "string" || !isLoopback(address) || !allowedRequest(c.req.raw.headers, port))
      return c.json({ error: "Local same-origin clients only" }, 403);
    if (!allowedMethod(c.req.method, c.req.path))
      return c.json({ error: "Observation-only Studio; execution and mutations are disabled" }, 405);
    // Discover new runs before native Studio reads. Unauthorized requests never trigger filesystem/database work.
    if (refresh && c.req.method === "GET" && c.req.path.startsWith("/api/observability/")) await refresh();
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; frame-ancestors 'none'; object-src 'none'; form-action 'self'; base-uri 'self'"
    );
  };
}

export function allowedMethod(method: string, path: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  // No agent, workflow, scorer, dataset, or editor mutations/executions through this Studio.
  return method === "POST" && path === "/nq2am/sync";
}
