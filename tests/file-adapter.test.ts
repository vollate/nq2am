import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizePlaylistFile, toPortablePlaylist } from "../src/index.js";
import type { NormalizedPlaylist } from "../src/types.js";

process.env.NQ2AM_DATA_DIR = mkdtempSync(join(tmpdir(), "nq2am-file-adapter-test-"));

test("normalizePlaylistFile reads the portable envelope", () => {
  const playlist = normalizePlaylistFile({
    format: "nq2am-playlist",
    version: 1,
    name: "Leftovers",
    description: "retry these",
    provider: "qq",
    tracks: [
      { name: "Song", artists: ["Artist"], album: "Album", durationMs: 180_000 },
      { name: "名前のない怪物", artists: ["EGOIST"], album: "Album", durationMs: 200_000 }
    ]
  });

  assert.equal(playlist.provider, "qq");
  assert.equal(playlist.name, "Leftovers");
  assert.equal(playlist.description, "retry these");
  assert.equal(playlist.tracks.length, 2);
  assert.equal(playlist.tracks[0].originalName, "Song");
  assert.deepEqual(playlist.tracks[0].artists, ["Artist"]);
  assert.equal(playlist.tracks[0].albumName, "Album");
  assert.equal(playlist.tracks[0].durationMs, 180_000);
  assert.equal(playlist.tracks[1].source.provider, "qq");
});

test("normalizePlaylistFile accepts a bare { tracks } object and tolerates alternate keys", () => {
  const playlist = normalizePlaylistFile({
    tracks: [{ title: "Untitled", artists: ["Someone"], albumName: "X", duration: 120 }]
  });

  assert.equal(playlist.provider, "netease");
  assert.equal(playlist.tracks.length, 1);
  assert.equal(playlist.tracks[0].originalName, "Untitled");
  assert.deepEqual(playlist.tracks[0].artists, ["Someone"]);
  assert.equal(playlist.tracks[0].durationMs, 120);
});

test("normalizePlaylistFile defaults an unknown provider and drops nameless tracks", () => {
  const playlist = normalizePlaylistFile({ provider: "spotify", tracks: [{ artists: ["A"] }, { name: "OK" }] });

  assert.equal(playlist.provider, "netease");
  assert.equal(playlist.tracks.length, 1);
  assert.equal(playlist.tracks[0].originalName, "OK");
});

test("toPortablePlaylist round-trips through normalizePlaylistFile", () => {
  const original: NormalizedPlaylist = {
    provider: "netease",
    id: "p1",
    name: "Round trip",
    description: "desc",
    tracks: [
      {
        originalName: "曲",
        artists: ["歌手"],
        albumName: "辑",
        durationMs: 90_000,
        source: { provider: "netease", raw: { keep: "ignored on export" } }
      }
    ],
    raw: {}
  };

  const restored = normalizePlaylistFile(toPortablePlaylist(original));
  assert.equal(restored.name, "Round trip");
  assert.equal(restored.tracks.length, 1);
  assert.equal(restored.tracks[0].originalName, "曲");
  assert.deepEqual(restored.tracks[0].artists, ["歌手"]);
  assert.equal(restored.tracks[0].albumName, "辑");
  assert.equal(restored.tracks[0].durationMs, 90_000);
});

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: (req: unknown, res: unknown) => unknown }[];
  };
};

async function invokeImportRoute(body: unknown) {
  const router = (await import("../server/routes/playlists.js")).default as unknown as { stack: RouteLayer[] };
  const layer = router.stack.find((item) => item.route?.path === "/playlists/import" && item.route.methods.post);
  assert.ok(layer?.route, "import route should exist");

  let statusCode = 200;
  let jsonBody: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      jsonBody = data;
      return res;
    }
  };

  await layer.route.stack[0].handle({ body }, res);
  return { statusCode, jsonBody };
}

test("POST /playlists/import adds the playlist and returns a key", async () => {
  const { statusCode, jsonBody } = await invokeImportRoute({
    format: "nq2am-playlist",
    version: 1,
    name: "From file",
    provider: "netease",
    tracks: [{ name: "Imported", artists: ["A"] }]
  });

  assert.equal(statusCode, 200);
  const body = jsonBody as { key: string; playlist: { tracks: { originalName: string }[] } };
  assert.ok(body.key.startsWith("netease-"));
  assert.equal(body.playlist.tracks[0].originalName, "Imported");
});

test("POST /playlists/import rejects a file with no usable tracks", async () => {
  const { statusCode, jsonBody } = await invokeImportRoute({ tracks: [{ artists: ["A"] }] });
  assert.equal(statusCode, 400);
  assert.match((jsonBody as { error: string }).error, /no tracks/i);
});
