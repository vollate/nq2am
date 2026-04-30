import { type Browser, type BrowserContext, type Cookie, chromium } from "playwright";
import type { FetchOptions, MusicProvider } from "../types.js";
import { interactiveLogin, loadCookies, saveCookies } from "./auth.js";

let sharedBrowser: Browser | undefined;

/**
 * Launch (or reuse) a headless Chromium instance.
 */
async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) {
    return sharedBrowser;
  }

  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

export type BrowserFetchOptions = FetchOptions & {
  provider: MusicProvider;
  domain?: string;
  timeoutMs?: number;
  skipCookieCache?: boolean;
};

/**
 * Check if an API response indicates the user is not logged in.
 */
function isNotLoggedIn(json: unknown): boolean {
  if (typeof json !== "object" || json === null) {
    return false;
  }

  const obj = json as Record<string, unknown>;

  // NetEase: code 301 means "need login"
  if (obj.code === 301 || obj.code === -1 || obj.code === 302 || obj.code === 401) {
    return true;
  }

  // QQ Music: subcode -101
  if (obj.subcode === -101) {
    return true;
  }

  return false;
}

/**
 * Fetch playlist data by navigating to the provider's origin (to establish cookies),
 * then calling the API from within the page context via fetch().
 * Handles login automatically if the response indicates auth is required.
 */
export async function fetchWithBrowser(
  originUrl: string,
  apiPath: string,
  options: BrowserFetchOptions
): Promise<unknown> {
  const { provider } = options;

  // Load persisted cookies
  const storedCookies = options.skipCookieCache ? undefined : await loadCookies(provider);

  const result = await doFetch(originUrl, apiPath, options, storedCookies);

  if (isNotLoggedIn(result)) {
    // Login required — open interactive browser
    const freshCookies = await interactiveLogin(provider);
    // Retry with new cookies
    return doFetch(originUrl, apiPath, options, freshCookies);
  }

  return result;
}

async function doFetch(
  originUrl: string,
  apiPath: string,
  options: BrowserFetchOptions,
  cookies?: Cookie[]
): Promise<unknown> {
  const browser = await getBrowser();
  const context: BrowserContext = await browser.newContext();

  // Inject persisted cookies
  if (cookies && cookies.length > 0) {
    await context.addCookies(cookies);
  }

  // Inject manually-provided cookie string (from --cookie flag)
  if (options.cookie && options.domain) {
    const parsed = parseCookieString(options.cookie, options.domain);
    await context.addCookies(parsed);
  }

  const page = await context.newPage();

  try {
    // Navigate to origin to establish cookie context
    await page.goto(originUrl, { waitUntil: "domcontentloaded" });

    // Call the API from within the page (cookies are sent automatically)
    const result = await page.evaluate(async (path: string) => {
      const res = await fetch(path, { credentials: "include" });
      return res.json();
    }, apiPath);

    // Persist cookies after successful fetch
    const allCookies = await context.cookies();
    if (allCookies.length > 0) {
      await saveCookies(options.provider, allCookies);
    }

    return result;
  } finally {
    await context.close();
  }
}

/**
 * Parse a raw cookie string ("k1=v1; k2=v2") into Playwright Cookie objects.
 */
function parseCookieString(raw: string, domain: string): Cookie[] {
  return raw
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const name = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? "" : pair.slice(eq + 1);
      return {
        name: name.trim(),
        value: value.trim(),
        domain,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "None" as const
      };
    });
}

/**
 * Gracefully close the shared browser.
 */
export async function closeBrowser(): Promise<void> {
  if (sharedBrowser?.isConnected()) {
    await sharedBrowser.close();
    sharedBrowser = undefined;
  }
}
