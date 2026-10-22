import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Cookie, chromium } from "playwright";
import { getDataDir } from "../dataDir.js";
import type { MusicProvider } from "../types.js";

export { getDataDir } from "../dataDir.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 1_000;

const DATA_DIR = getDataDir();

function cookiePath(provider: MusicProvider): string {
  return join(DATA_DIR, `cookies-${provider}.json`);
}

/**
 * Load persisted cookies for a provider. Returns undefined if no cookie file exists.
 */
export async function loadCookies(provider: MusicProvider): Promise<Cookie[] | undefined> {
  try {
    const raw = await readFile(cookiePath(provider), "utf8");
    return JSON.parse(raw) as Cookie[];
  } catch {
    return undefined;
  }
}

/**
 * Persist cookies to disk for a provider.
 */
export async function saveCookies(provider: MusicProvider, cookies: Cookie[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(cookiePath(provider), JSON.stringify(cookies, null, 2), "utf8");
}

/** Provider-specific login URLs */
const LOGIN_URLS: Record<MusicProvider, string> = {
  qq: "https://y.qq.com/",
  netease: "https://music.163.com/",
  apple: "https://music.apple.com/"
};

/** Cookie names that indicate a successful login */
const LOGIN_COOKIES: Record<MusicProvider, string[]> = {
  qq: ["uin", "skey"],
  netease: ["MUSIC_U"],
  apple: ["media-user-token"]
};

/**
 * Open a visible browser window for the user to log in interactively.
 * Polls for login-indicating cookies, saves them, and returns them.
 */
export async function interactiveLogin(provider: MusicProvider): Promise<Cookie[]> {
  process.stderr.write(`\nOpening browser for ${provider} login...\n`);
  process.stderr.write("Please log in within 5 minutes. The browser will close automatically after login.\n\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URLS[provider], { waitUntil: "domcontentloaded" });

    const targetCookieNames = LOGIN_COOKIES[provider];
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const cookies = await context.cookies();
      const hasLoginCookie = targetCookieNames.some((name) =>
        cookies.some((c) => c.name === name && c.value.length > 0 && c.value !== "0")
      );

      if (hasLoginCookie) {
        process.stderr.write(`Login successful for ${provider}! Saving cookies...\n`);
        await saveCookies(provider, cookies);
        return cookies;
      }

      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    throw new Error(`Login timed out after 5 minutes for ${provider}. Please try again.`);
  } finally {
    await browser.close();
  }
}
