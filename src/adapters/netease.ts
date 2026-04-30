import type { NormalizedPlaylist, NormalizedTrack } from "../types.js";
import { firstObjectArray, firstString, joinNames, namesFromArray, readPath } from "./common.js";

export function normalizeNeteasePlaylist(input: unknown, sourceUrl?: string): NormalizedPlaylist {
  const playlist = readPath(input, ["playlist"]) ?? readPath(input, ["result"]) ?? input;
  const tracks = firstObjectArray(
    readPath(playlist, ["tracks"]),
    readPath(playlist, ["songs"]),
    readPath(input, ["songs"]),
    readPath(input, ["tracks"])
  );
  const playlistId = firstString(readPath(playlist, ["id"]), readPath(input, ["id"]));

  return {
    provider: "netease",
    id: playlistId,
    name: firstString(readPath(playlist, ["name"]), readPath(playlist, ["title"])),
    description: firstString(readPath(playlist, ["description"]), readPath(playlist, ["desc"])),
    coverUrl: firstString(readPath(playlist, ["coverImgUrl"]), readPath(playlist, ["picUrl"])),
    sourceUrl,
    tracks: tracks.map((track) => normalizeNeteaseTrack(track, playlistId)),
    raw: input
  };
}

function normalizeNeteaseTrack(input: unknown, playlistId?: string): NormalizedTrack {
  const album = readPath(input, ["al"]) ?? readPath(input, ["album"]);
  const artists = namesFromArray(readPath(input, ["ar"]));
  const fallbackArtists = namesFromArray(readPath(input, ["artists"]));
  const allArtists = artists.length > 0 ? artists : fallbackArtists;
  const albumArtists = [
    ...namesFromArray(readPath(album, ["artists"])),
    ...namesFromArray(readPath(album, ["artist"]))
  ];

  return {
    originalName: firstString(readPath(input, ["name"]), readPath(input, ["title"])) ?? "",
    artists: allArtists,
    albumName: firstString(readPath(album, ["name"]), readPath(input, ["albumName"])),
    albumArtist: firstString(
      readPath(album, ["artist", "name"]),
      readPath(album, ["artistName"]),
      joinNames(albumArtists)
    ),
    albumCoverUrl: firstString(
      readPath(album, ["picUrl"]),
      readPath(album, ["coverImgUrl"]),
      readPath(input, ["albumCoverUrl"])
    ),
    source: {
      provider: "netease",
      playlistId,
      songId: firstString(readPath(input, ["id"]), readPath(input, ["songId"])),
      raw: input
    }
  };
}
