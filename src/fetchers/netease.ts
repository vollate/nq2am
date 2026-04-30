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

  return fetchWithBrowser("https://music.163.com/", apiPath, {
    ...options,
    provider: "netease",
    domain: ".music.163.com"
  });
}
