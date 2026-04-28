# nq2am

Normalize playlists from QQ Music and NetEase Cloud Music into a shared metadata format for future Apple Music matching.

Apple Music matching is intentionally a typed stub in this version. The first step is preserving the original provider metadata well enough to make matching possible later, especially where Apple Music romanizes Japanese metadata outside Japan.

## Install

```bash
pnpm install
pnpm run build
```

## CLI

Normalize a local QQ Music API JSON response:

```bash
pnpm run cli -- normalize --provider qq --input qq-playlist.json --output normalized.json
```

Normalize a NetEase playlist URL using cookies from a file:

```bash
pnpm run cli -- normalize --provider netease --url "https://music.163.com/#/playlist?id=123" --cookie cookie.txt --output normalized.json
```

Write to stdout by omitting `--output`.

Run the Apple Music matcher stub:

```bash
pnpm run cli -- match-apple --input normalized.json --output apple-matches.json
```

## Normalized Track Shape

Each track stores:

- `originalName`
- `artists`
- `albumName`
- `albumArtist`
- `albumCoverUrl`
- `source.provider`
- `source.playlistId`
- `source.songId`
- `source.raw`

`source.raw` is kept deliberately. QQ and NetEase payloads change, and future Apple matching will probably need fields that are not part of the stable normalized core yet.
