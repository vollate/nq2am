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
 * Uses amp-api.music.apple.com with the media-user-token as Bearer token.
 */
async function appleApiRequest<T>(
  path: string,
  mediaUserToken: string,
  init?: { method?: string; body?: string }
): Promise<T> {
  const { context } = await createAppleContext();
  const page = await context.newPage();

  try {
    // Navigate to Apple Music to establish origin context
    await page.goto("https://music.apple.com/", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(
      async ({ path, token, init }) => {
        const res = await fetch(`https://amp-api.music.apple.com${path}`, {
          method: init?.method ?? "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Music-User-Token": token
          },
          body: init?.body
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Apple Music API ${res.status}: ${text.slice(0, 200)}`);
        }
        return res.json();
      },
      { path, token: mediaUserToken, init }
    );

    // Save cookies (they may have been refreshed)
    const updatedCookies = await context.cookies();
    await saveCookies("apple", updatedCookies);

    return result as T;
  } finally {
    await context.close();
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

  const params = new URLSearchParams({ types: "songs", term, limit: "5" });
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
