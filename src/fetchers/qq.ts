import type { FetchOptions } from "../types.js";
import { fetchJson } from "./http.js";

export function parseQqPlaylistId(url: string): string {
  const parsed = new URL(url);
  const id =
    parsed.searchParams.get("id") ??
    parsed.searchParams.get("disstid") ??
    parsed.searchParams.get("dissid") ??
    parsed.pathname.match(/(?:playlist|taoge|detail)\/(\d+)/)?.[1];

  if (!id) {
    throw new Error(`Unsupported QQ playlist URL: ${url}`);
  }

  return id;
}

export async function fetchQqPlaylist(url: string, options: FetchOptions = {}): Promise<unknown> {
  const id = parseQqPlaylistId(url);
  const apiUrl = new URL("https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg");
  apiUrl.search = new URLSearchParams({
    type: "1",
    json: "1",
    utf8: "1",
    onlysong: "0",
    disstid: id,
    format: "json",
    g_tk: "5381",
    loginUin: "0",
    hostUin: "0",
    inCharset: "utf8",
    outCharset: "utf-8",
    notice: "0",
    platform: "yqq.json",
    needNewCode: "0"
  }).toString();

  return fetchJson(apiUrl.toString(), {
    ...options,
    headers: {
      referer: "https://y.qq.com/",
      origin: "https://y.qq.com",
      ...options.headers
    }
  });
}
