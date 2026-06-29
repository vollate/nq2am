import { type Browser, type BrowserContext, chromium } from "playwright";
import { loadCookies, saveCookies } from "../fetchers/auth.js";

export type AppleSong = {
  id: string;
  type: "songs";
  attributes: {
    name: string;
    artistName: string;
    albumName: string;
    durationInMillis?: number;
    releaseDate?: string;
    isrc?: string;
    url?: string;
    contentRating?: "explicit" | "clean";
    artwork?: {
      url?: string;
      width?: number;
      height?: number;
    };
  };
};

type SearchResponse = {
  results?: {
    songs?: {
      data: AppleSong[];
    };
  };
};

type StorefrontResponse = {
  data: { id: string }[];
};

type PlaylistResponse = {
  data: { id: string }[];
};

let sharedBrowser: Browser | undefined;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) {
    return sharedBrowser;
  }
  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

/**
 * The developer token (a MusicKit JWT) that the Apple Music web player itself
 * uses to authorize its calls to amp-api. We don't own an Apple Developer
 * account, so instead of minting our own token we reuse the one the logged-in
 * web player already carries — captured by intercepting the player's own
 * requests. Cached module-wide; reset on a 401 so we re-capture a fresh one.
 */
let cachedDeveloperToken: string | undefined;

const TOKEN_CAPTURE_TIMEOUT_MS = 30_000;

/**
 * Open the Apple Music web player in the (logged-in) context and capture the
 * developer token it uses. Primary path: intercept the Authorization header on
 * the player's own amp-api requests. Fallbacks: read it from the live MusicKit
 * instance, or from the embedded web-app config meta tag.
 */
async function captureDeveloperToken(context: BrowserContext): Promise<string> {
  if (cachedDeveloperToken) {
    return cachedDeveloperToken;
  }

  const page = await context.newPage();
  try {
    let settled = false;
    let resolveToken!: (t: string) => void;
    let rejectToken!: (e: Error) => void;
    const tokenPromise = new Promise<string>((resolve, reject) => {
      resolveToken = (t) => {
        if (!settled) {
          settled = true;
          resolve(t);
        }
      };
      rejectToken = (e) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      };
    });

    const timer = setTimeout(
      () => rejectToken(new Error("Timed out obtaining Apple Music developer token from the web player")),
      TOKEN_CAPTURE_TIMEOUT_MS
    );

    // Primary: grab the Bearer token off the player's own API requests.
    page.on("request", (req) => {
      const auth = req.headers().authorization;
      if (req.url().includes("api.music.apple.com") && auth?.startsWith("Bearer ")) {
        resolveToken(auth.slice("Bearer ".length));
      }
    });

    await page.goto("https://music.apple.com/", { waitUntil: "domcontentloaded" });

    // Fallback poll: read the token straight out of MusicKit / embedded config.
    void (async () => {
      while (!settled) {
        const token = await page
          .evaluate(() => {
            const w = window as unknown as {
              MusicKit?: { getInstance?: () => { developerToken?: string } | undefined };
            };
            try {
              const inst = w.MusicKit?.getInstance?.();
              if (inst?.developerToken) {
                return inst.developerToken;
              }
            } catch {
              // MusicKit not ready yet
            }
            const meta = document.querySelector('meta[name="desktop-music-app/config/environment"]');
            const content = meta?.getAttribute("content");
            if (content) {
              try {
                const cfg = JSON.parse(decodeURIComponent(content)) as {
                  MEDIA_API?: { token?: string };
                };
                if (cfg.MEDIA_API?.token) {
                  return cfg.MEDIA_API.token;
                }
              } catch {
                // not the shape we expected
              }
            }
            return null;
          })
          .catch(() => null);
        if (token) {
          resolveToken(token);
          break;
        }
        await page.waitForTimeout(500).catch(() => {});
      }
    })();

    cachedDeveloperToken = await tokenPromise;
    clearTimeout(timer);
    return cachedDeveloperToken;
  } finally {
    await page.close();
  }
}

/**
 * Create a browser context with Apple Music cookies loaded,
 * navigate to music.apple.com to establish context.
 */
async function createAppleContext(): Promise<{ context: BrowserContext; mediaUserToken: string }> {
  const cookies = await loadCookies("apple");
  if (!cookies || cookies.length === 0) {
    throw new Error("Not logged in to Apple Music. Please log in from Settings.");
  }

  const mediaUserToken = cookies.find((c) => c.name === "media-user-token")?.value;
  if (!mediaUserToken) {
    throw new Error("Apple Music session expired. Please log in again.");
  }

  const browser = await getBrowser();
  const context = await browser.newContext();
  await context.addCookies(cookies);

  return { context, mediaUserToken };
}

/**
 * Call the Apple Music API from within a browser page context.
 *
 * Uses amp-api.music.apple.com authorized exactly like the web player itself:
 * `Authorization: Bearer <developer token>` (the MusicKit JWT we capture from
 * the player) plus `Music-User-Token: <media-user-token>` (the logged-in user).
 * Sending the user token as the Bearer — as this code previously did — yields a
 * 401 on every call.
 */
async function appleApiRequest<T>(
  path: string,
  mediaUserToken: string,
  init?: { method?: string; body?: string }
): Promise<T> {
  const { context } = await createAppleContext();

  try {
    return await doAppleApiRequest<T>(context, path, mediaUserToken, init);
  } catch (err) {
    // A 401 most likely means a stale developer token — drop it and retry once
    // with a freshly captured one before giving up.
    if (err instanceof Error && err.message.includes("401") && cachedDeveloperToken) {
      cachedDeveloperToken = undefined;
      return await doAppleApiRequest<T>(context, path, mediaUserToken, init);
    }
    throw err;
  } finally {
    await context.close();
  }
}

async function doAppleApiRequest<T>(
  context: BrowserContext,
  path: string,
  mediaUserToken: string,
  init?: { method?: string; body?: string }
): Promise<T> {
  const developerToken = await captureDeveloperToken(context);
  const page = await context.newPage();

  try {
    // Navigate to Apple Music to establish origin context
    await page.goto("https://music.apple.com/", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(
      async ({ path, developerToken, userToken, init }) => {
        const res = await fetch(`https://amp-api.music.apple.com${path}`, {
          method: init?.method ?? "GET",
          headers: {
            Authorization: `Bearer ${developerToken}`,
            "Content-Type": "application/json",
            "Music-User-Token": userToken
          },
          body: init?.body
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Apple Music API ${res.status}: ${text.slice(0, 200)}`);
        }
        return res.json();
      },
      { path, developerToken, userToken: mediaUserToken, init }
    );

    // Save cookies (they may have been refreshed)
    const updatedCookies = await context.cookies();
    await saveCookies("apple", updatedCookies);

    return result as T;
  } finally {
    await page.close();
  }
}

/**
 * Search Apple Music catalog for songs.
 */
export async function appleSearch(term: string, storefront: string): Promise<AppleSong[]> {
  const cookies = await loadCookies("apple");
  const mediaUserToken = cookies?.find((c) => c.name === "media-user-token")?.value;
  if (!mediaUserToken) {
    throw new Error("Not logged in to Apple Music");
  }

  const params = new URLSearchParams({ types: "songs", term, limit: "15" });
  const result = await appleApiRequest<SearchResponse>(`/v1/catalog/${storefront}/search?${params}`, mediaUserToken);

  return result.results?.songs?.data ?? [];
}

/**
 * Get the user's Apple Music storefront (e.g., "us", "jp", "cn").
 */
export async function appleGetStorefront(): Promise<string> {
  const cookies = await loadCookies("apple");
  const mediaUserToken = cookies?.find((c) => c.name === "media-user-token")?.value;
  if (!mediaUserToken) {
    throw new Error("Not logged in to Apple Music");
  }

  const result = await appleApiRequest<StorefrontResponse>("/v1/me/storefront", mediaUserToken);

  if (!result.data || result.data.length === 0) {
    return "us"; // Fallback
  }
  return result.data[0].id;
}

/**
 * Create a playlist in the user's Apple Music library.
 */
export async function appleCreatePlaylist(name: string, description: string, trackIds: string[]): Promise<string> {
  const cookies = await loadCookies("apple");
  const mediaUserToken = cookies?.find((c) => c.name === "media-user-token")?.value;
  if (!mediaUserToken) {
    throw new Error("Not logged in to Apple Music");
  }

  const body = JSON.stringify({
    attributes: { name, description },
    relationships: {
      tracks: {
        data: trackIds.map((id) => ({ id, type: "songs" }))
      }
    }
  });

  const result = await appleApiRequest<PlaylistResponse>("/v1/me/library/playlists", mediaUserToken, {
    method: "POST",
    body
  });

  if (!result.data || result.data.length === 0) {
    throw new Error("Playlist creation returned no data");
  }
  return result.data[0].id;
}
