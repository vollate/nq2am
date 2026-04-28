import type { NormalizedPlaylist, NormalizedTrack } from "../types.js";
import {
  firstObjectArray,
  firstString,
  isObject,
  joinNames,
  namesFromArray,
  readPath
} from "./common.js";

export function normalizeQqPlaylist(input: unknown, sourceUrl?: string): NormalizedPlaylist {
  const playlist = pickQqPlaylist(input);
  const tracks = firstObjectArray(
    readPath(playlist, ["songlist"]),
    readPath(playlist, ["songList"]),
    readPath(playlist, ["tracks"]),
    readPath(input, ["songlist"]),
    readPath(input, ["tracks"])
  );
  const playlistId = firstString(
    isObject(playlist) ? playlist.disstid : undefined,
    isObject(playlist) ? playlist.dissid : undefined,
    isObject(playlist) ? playlist.id : undefined,
    readPath(input, ["id"])
  );

  return {
    provider: "qq",
    id: playlistId,
    name: firstString(
      isObject(playlist) ? playlist.dissname : undefined,
      isObject(playlist) ? playlist.name : undefined,
      isObject(playlist) ? playlist.title : undefined
    ),
    description: firstString(
      isObject(playlist) ? playlist.desc : undefined,
      isObject(playlist) ? playlist.description : undefined
    ),
    coverUrl: firstString(
      isObject(playlist) ? playlist.logo : undefined,
      isObject(playlist) ? playlist.picurl : undefined,
      isObject(playlist) ? playlist.cover : undefined
    ),
    sourceUrl,
    tracks: tracks.map((track) => normalizeQqTrack(track, playlistId)),
    raw: input
  };
}

function pickQqPlaylist(input: unknown): unknown {
  const cdlist = readPath(input, ["cdlist"]);
  if (Array.isArray(cdlist) && cdlist.length > 0) {
    return cdlist[0];
  }

  const nested = readPath(input, ["data", "cdlist"]);
  if (Array.isArray(nested) && nested.length > 0) {
    return nested[0];
  }

  const playlist = readPath(input, ["playlist"]);
  if (playlist) {
    return playlist;
  }

  const data = readPath(input, ["data"]);
  if (data && hasQqTrackList(data)) {
    return data;
  }

  return input;
}

function hasQqTrackList(value: unknown): boolean {
  return Array.isArray(readPath(value, ["songlist"])) || Array.isArray(readPath(value, ["tracks"]));
}

function normalizeQqTrack(input: unknown, playlistId?: string): NormalizedTrack {
  const album = readPath(input, ["album"]);
  const artists = namesFromArray(readPath(input, ["singer"]));
  const fallbackArtists = namesFromArray(readPath(input, ["artists"]));
  const allArtists = artists.length > 0 ? artists : fallbackArtists;
  const albumMid = firstString(
    readPath(input, ["albummid"]),
    readPath(album, ["mid"]),
    readPath(album, ["pmid"])
  );
  const albumArtists = [
    ...namesFromArray(readPath(album, ["singers"])),
    ...namesFromArray(readPath(album, ["artists"]))
  ];

  return {
    originalName: firstString(
      readPath(input, ["songname"]),
      readPath(input, ["name"]),
      readPath(input, ["title"])
    ) ?? "",
    artists: allArtists,
    albumName: firstString(
      readPath(input, ["albumname"]),
      readPath(album, ["name"]),
      readPath(album, ["title"])
    ),
    albumArtist: firstString(
      readPath(input, ["albumSinger"]),
      readPath(input, ["album_singer"]),
      readPath(album, ["singername"]),
      readPath(album, ["artist", "name"]),
      joinNames(albumArtists)
    ),
    albumCoverUrl: firstString(
      readPath(input, ["albumcover"]),
      readPath(input, ["picurl"]),
      readPath(album, ["picurl"]),
      albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : undefined
    ),
    source: {
      provider: "qq",
      playlistId,
      songId: firstString(
        readPath(input, ["songmid"]),
        readPath(input, ["mid"]),
        readPath(input, ["songid"]),
        readPath(input, ["id"])
      ),
      raw: input
    }
  };
}
