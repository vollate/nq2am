import type { AppleMatchReport, NormalizedPlaylist, NormalizedTrack } from "../src/types.js";

const playlists = new Map<string, NormalizedPlaylist>();
const matchReports = new Map<string, AppleMatchReport>();

function makeKey(playlist: NormalizedPlaylist): string {
  return `${playlist.provider}-${playlist.id ?? Date.now()}`;
}

export function addPlaylist(playlist: NormalizedPlaylist): string {
  const key = makeKey(playlist);
  playlists.set(key, playlist);
  return key;
}

export function getPlaylist(key: string): NormalizedPlaylist | undefined {
  return playlists.get(key);
}

export function getAllPlaylists(): { key: string; playlist: NormalizedPlaylist }[] {
  return [...playlists.entries()].map(([key, playlist]) => ({ key, playlist }));
}

export function updateTrack(key: string, idx: number, data: Partial<NormalizedTrack>): NormalizedTrack | undefined {
  const playlist = playlists.get(key);
  if (!playlist || idx < 0 || idx >= playlist.tracks.length) {
    return undefined;
  }

  playlist.tracks[idx] = { ...playlist.tracks[idx], ...data };
  return playlist.tracks[idx];
}

export function deleteTracks(key: string, indices: number[]): boolean {
  const playlist = playlists.get(key);
  if (!playlist) {
    return false;
  }

  const sorted = [...indices].sort((a, b) => b - a);
  for (const idx of sorted) {
    if (idx >= 0 && idx < playlist.tracks.length) {
      playlist.tracks.splice(idx, 1);
    }
  }
  return true;
}

export function addMatchReport(playlistKey: string, report: AppleMatchReport): void {
  matchReports.set(playlistKey, report);
}

export function getMatchReport(playlistKey: string): AppleMatchReport | undefined {
  return matchReports.get(playlistKey);
}
