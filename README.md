# nq2am

Normalize playlists from QQ Music and NetEase Cloud Music into a shared metadata format for future Apple Music matching.

Apple Music matching is intentionally a typed stub in this version. The first step is preserving the original provider metadata well enough to make matching possible later, especially where Apple Music romanizes Japanese metadata outside Japan.

## Optional Agent matching

The web UI supports manually triggered, OpenAI-compatible Agent matching with local debug logs. Ordinary matching never calls the LLM. See [setup, security, limits and verification](docs/agent-matching.md).

## Local Agent observability

Run `pnpm studio` to inspect new Agent logs in the native Mastra Studio UI, without migrating or rerunning the Agent. Opening/reloading Traces discovers new batches automatically, without a sync command. The pinned native Studio's Auto refresh does not refetch the rolling LibSQL list; reload the page to view newly completed logs. `pnpm studio:demo` opens an offline demo; `pnpm studio:sync` is an optional immediate scan/diagnostic command. Studio requires Node.js 22.18+ (22.x) or 24.11+. Existing logs without event timestamps are reported and skipped, not plotted with invented times. See [usage, limitations, privacy and tests](docs/mastra-studio.md).

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
