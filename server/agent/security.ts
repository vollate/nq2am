import { isIP } from "node:net";
import type { RequestHandler } from "express";

export function isLoopback(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "::1" ||
    (isIP(h) === 4 && h.startsWith("127.")) ||
    (h.startsWith("::ffff:") && isLoopback(h.slice(7)))
  );
}

export function validateBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid Base URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Base URL");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.includes("?") ||
    value.includes("#") ||
    !(url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname)))
  ) {
    throw new Error("Base URL requires HTTPS (or loopback HTTP), without credentials, query or fragment");
  }
  return url.href.replace(/\/$/, "");
}

/** Check the actual socket, never X-Forwarded-For. Host checking also blocks DNS rebinding. */
export const localAgentOnly: RequestHandler = (req, res, next) => {
  try {
    if (!req.socket.remoteAddress || !isLoopback(req.socket.remoteAddress)) throw new Error();
    const host = new URL(`http://${req.headers.host}`);
    if (!isLoopback(host.hostname)) throw new Error();
    const origin = req.headers.origin;
    if (origin) {
      const url = new URL(origin);
      const sameOrigin = origin === `${req.protocol}://${req.headers.host}`;
      const localVite = url.protocol === "http:" && isLoopback(url.hostname) && url.port === "5173";
      if (url.origin !== origin || (!sameOrigin && !localVite)) throw new Error();
    } else if (
      req.headers["sec-fetch-site"] &&
      req.headers["sec-fetch-site"] !== "same-origin" &&
      req.headers["sec-fetch-site"] !== "none"
    ) {
      throw new Error();
    }
    next();
  } catch {
    res.status(403).json({ error: "Agent API is restricted to local, same-origin clients" });
  }
};
