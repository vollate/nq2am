import type { FetchOptions } from "../types.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) nq2am/0.1";

export async function fetchJson(url: string, options: FetchOptions = {}): Promise<unknown> {
  const headers: Record<string, string> = {
    "accept": "application/json,text/plain,*/*",
    "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
    ...options.headers
  };

  if (options.cookie) {
    headers.cookie = options.cookie;
  }

  const response = await fetch(url, { headers });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}: ${body.slice(0, 200)}`);
  }

  try {
    return JSON.parse(stripJsonp(body));
  } catch (error) {
    throw new Error(`Provider response was not JSON for ${url}: ${(error as Error).message}`);
  }
}

function stripJsonp(body: string): string {
  const trimmed = body.trim();
  const match = /^[\w$]+\(([\s\S]*)\);?$/.exec(trimmed);
  return match ? match[1] : trimmed;
}
