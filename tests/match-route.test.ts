import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppleMatchReport, NormalizedPlaylist } from "../src/types.js";

process.env.NQ2AM_DATA_DIR = mkdtempSync(join(tmpdir(), "nq2am-match-route-test-"));

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: (req: unknown, res: unknown) => unknown }[];
  };
};

async function invokeSelectTrackRoute(playlistId: string, idx: string, body: unknown) {
  const matchRouter = (await import("../server/routes/match.js")).default as unknown as { stack: RouteLayer[] };
  const layer = matchRouter.stack.find(
    (item) => item.route?.path === "/match-apple/:playlistId/tracks/:idx" && item.route.methods.put
  );
  assert.ok(layer?.route, "select-track route should exist");

  let statusCode = 200;
  let jsonBody: unknown;
  const req = { params: { playlistId, idx }, body };
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

  await layer.route.stack[0].handle(req, res);
  return { statusCode, jsonBody };
}

test("match route accepts null appleMusicId to mark a track as no match", async () => {
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: "route-no-match",
    name: "Route no match",
    tracks: [
      {
        originalName: "Song",
        artists: ["Artist"],
        source: { provider: "qq", raw: {} }
      }
    ],
    raw: {}
  };
  const { addPlaylist, setMatchReport } = await import("../server/state.js");
  const key = await addPlaylist(playlist);
  const report: AppleMatchReport = {
    provider: "qq",
    playlistId: playlist.id,
    playlistName: playlist.name,
    results: [
      {
        track: playlist.tracks[0],
        status: "ambiguous",
        selectedId: "candidate-1",
        selectionSource: "auto",
        appleMusicId: "candidate-1",
        candidates: [
          {
            id: "candidate-1",
            name: "Song",
            artistName: "Artist",
            score: 0.99
          }
        ]
      }
    ]
  };
  setMatchReport(key, report);

  const res = await invokeSelectTrackRoute(key, "0", { appleMusicId: null });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, {
    track: playlist.tracks[0],
    status: "not_found",
    selectedId: undefined,
    selectionSource: "manual",
    appleMusicId: undefined,
    appleMusicUrl: undefined,
    candidates: report.results[0].candidates,
    reason: "Marked as no match"
  });
});
