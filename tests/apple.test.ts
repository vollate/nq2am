import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { NormalizedPlaylist, NormalizedTrack } from "../src/index.js";

process.env.NQ2AM_DATA_DIR = mkdtempSync(join(tmpdir(), "nq2am-test-"));

let appModule: Promise<typeof import("../src/index.js")> | undefined;
function loadAppModule(): Promise<typeof import("../src/index.js")> {
  appModule ??= import("../src/index.js");
  return appModule;
}

function track(originalName: string, provider: NormalizedTrack["source"]["provider"] = "netease"): NormalizedTrack {
  return { originalName, artists: [], source: { provider, raw: {} } };
}

test("detectStorefrontForTrack picks native region by script", async () => {
  const { detectStorefrontForTrack } = await loadAppModule();
  // Kana → jp
  assert.equal(detectStorefrontForTrack(track("名前のない怪物 EGOIST"), "source"), "jp");
  assert.equal(detectStorefrontForTrack(track("ゆめ"), "source"), "jp");
  // Hangul → kr
  assert.equal(detectStorefrontForTrack(track("봄날"), "source"), "kr");
  // Han-only, Chinese provider, source mode → cn
  assert.equal(detectStorefrontForTrack(track("七里香", "qq"), "source"), "cn");
  // Han-only, text mode → jp (kanji titles assumed Japanese)
  assert.equal(detectStorefrontForTrack(track("時計", "qq"), "text"), "jp");
  // Latin → undefined (use account store)
  assert.equal(detectStorefrontForTrack(track("Bohemian Rhapsody"), "source"), undefined);
});

test("Apple Music matcher returns explicit not implemented results", async () => {
  const { matchAppleMusic } = await loadAppModule();
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: "p1",
    name: "Fixture",
    tracks: [
      {
        originalName: "Song",
        artists: ["Artist"],
        source: {
          provider: "qq",
          playlistId: "p1",
          songId: "s1",
          raw: {}
        }
      }
    ],
    raw: {}
  };

  const report = await matchAppleMusic(playlist);

  assert.equal(report.provider, "qq");
  assert.equal(report.playlistId, "p1");
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].status, "not_implemented");
});
