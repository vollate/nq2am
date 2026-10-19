import type { MusicProvider, NormalizedPlaylist, NormalizedTrack } from "../types.js";
import { firstNumber, firstObjectArray, firstString, namesFromArray, readPath } from "./common.js";

/**
 * A provider-agnostic, human-editable playlist file format. Exported by the
 * "export unmatched" action and consumed by the "import from file" action, so
 * failed tracks can be saved off, edited, and re-imported as a fresh playlist.
 */
export const PORTABLE_PLAYLIST_FORMAT = "nq2am-playlist";
export const PORTABLE_PLAYLIST_VERSION = 1;

export type PortableTrack = {
  name?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
};

export type PortablePlaylistFile = {
  format: typeof PORTABLE_PLAYLIST_FORMAT;
  version: typeof PORTABLE_PLAYLIST_VERSION;
  name?: string;
  description?: string;
  provider?: MusicProvider;
  tracks: PortableTrack[];
};

function normalizeProvider(value: unknown): MusicProvider {
  return value === "qq" || value === "netease" || value === "apple" ? value : "netease";
}

function normalizePortableTrack(input: unknown, provider: MusicProvider): NormalizedTrack {
  return {
    originalName:
      firstString(readPath(input, ["name"]), readPath(input, ["title"]), readPath(input, ["songName"])) ?? "",
    artists: namesFromArray(readPath(input, ["artists"])),
    albumName: firstString(readPath(input, ["album"]), readPath(input, ["albumName"])),
    durationMs: firstNumber(readPath(input, ["durationMs"]), readPath(input, ["duration"])),
    source: { provider, raw: {} }
  };
}

/**
 * Parse a portable playlist file (the `nq2am-playlist` envelope, or a bare
 * `{ tracks }` object) into a NormalizedPlaylist ready for `addPlaylist`.
 *
 * The `format`/`version` fields are accepted but not enforced, so hand-written
 * files and older exports still import. Tracks with no usable name are dropped.
 */
export function normalizePlaylistFile(input: unknown): NormalizedPlaylist {
  const provider = normalizeProvider(readPath(input, ["provider"]));
  const rawTracks = firstObjectArray(readPath(input, ["tracks"]));
  const tracks = rawTracks
    .map((track) => normalizePortableTrack(track, provider))
    .filter((track) => track.originalName.length > 0);

  return {
    provider,
    name: firstString(readPath(input, ["name"]), readPath(input, ["title"])),
    description: firstString(readPath(input, ["description"]), readPath(input, ["desc"])),
    tracks,
    raw: {}
  };
}

export function toPortableTrack(track: NormalizedTrack): PortableTrack {
  return {
    name: track.originalName,
    artists: track.artists,
    album: track.albumName,
    durationMs: track.durationMs
  };
}

export function toPortablePlaylist(playlist: NormalizedPlaylist): PortablePlaylistFile {
  return {
    format: PORTABLE_PLAYLIST_FORMAT,
    version: PORTABLE_PLAYLIST_VERSION,
    name: playlist.name,
    description: playlist.description,
    provider: playlist.provider,
    tracks: playlist.tracks.map(toPortableTrack)
  };
}
