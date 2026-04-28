import type { AppleMatchReport, NormalizedPlaylist } from "../types.js";

export async function matchAppleMusic(playlist: NormalizedPlaylist): Promise<AppleMatchReport> {
  return {
    provider: playlist.provider,
    playlistId: playlist.id,
    playlistName: playlist.name,
    results: playlist.tracks.map((track) => ({
      track,
      status: "not_implemented",
      reason: "Apple Music matching is intentionally left empty in v1."
    }))
  };
}
