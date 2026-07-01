import type { FetchOptions } from "../types.js";
import { fetchWithBrowser } from "./browser.js";

export function parseNeteasePlaylistId(url: string): string {
  const parsed = new URL(url);
  const hashPath = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "";
  const hashUrl = hashPath ? new URL(hashPath, parsed.origin) : undefined;
  const isPlaylistPath = parsed.pathname.includes("playlist") || Boolean(hashUrl?.pathname.includes("playlist"));
  const id =
    (isPlaylistPath ? parsed.searchParams.get("id") : undefined) ??
    (hashUrl?.pathname.includes("playlist") ? hashUrl.searchParams.get("id") : undefined) ??
    parsed.pathname.match(/(?:playlist|discover\/playlist)\/(\d+)/)?.[1] ??
    hashUrl?.pathname.match(/(?:playlist|discover\/playlist)\/(\d+)/)?.[1];

  if (!id) {
    throw new Error(`Unsupported NetEase playlist URL: ${url}`);
  }

  return id;
}

export async function fetchNeteasePlaylist(url: string, options: FetchOptions = {}): Promise<unknown> {
  const id = parseNeteasePlaylistId(url);
  const apiPath = `/api/v6/playlist/detail?id=${id}&n=100000&s=8`;

  const detail = (await fetchWithBrowser("https://music.163.com/", apiPath, {
    ...options,
    provider: "netease",
    domain: ".music.163.com"
  })) as NeteaseDetailResponse;

  // NetEase's playlist/detail only returns full track objects for the first ~10
  // songs; the rest come back only as IDs in `trackIds`. Backfill the complete
  // track list via song/detail so large playlists aren't truncated.
  const playlist = detail?.playlist;
  const trackIds = playlist?.trackIds ?? [];
  const tracks = playlist?.tracks ?? [];

  if (playlist && trackIds.length > tracks.length) {
    const fullTracks = await fetchNeteaseSongs(
      trackIds.map((t) => t.id),
      options
    );
    if (fullTracks.length > 0) {
      playlist.tracks = fullTracks;
    }
  }

  return detail;
}

type NeteaseDetailResponse = {
  playlist?: {
    trackIds?: { id: number }[];
    tracks?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/** Batch-fetch full song objects by id via song/detail (chunked). */
async function fetchNeteaseSongs(ids: number[], options: FetchOptions): Promise<unknown[]> {
  const CHUNK = 500;
  const all: unknown[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const c = JSON.stringify(chunk.map((id) => ({ id })));
    const body = new URLSearchParams({ c }).toString();

    const resp = (await fetchWithBrowser("https://music.163.com/", "/api/v3/song/detail", {
      ...options,
      provider: "netease",
      domain: ".music.163.com",
      method: "POST",
      body
    })) as { songs?: unknown[] };

    if (Array.isArray(resp?.songs)) {
      all.push(...resp.songs);
    }
  }

  return all;
}
