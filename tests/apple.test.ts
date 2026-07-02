import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppleSong } from "../src/apple/api.js";
import type { AppleContentRating, MatchPreferences, NormalizedPlaylist, NormalizedTrack } from "../src/types.js";
import { DEFAULT_MATCH_PREFERENCES } from "../src/types.js";

process.env.NQ2AM_DATA_DIR = mkdtempSync(join(tmpdir(), "nq2am-test-"));

let appModule: Promise<typeof import("../src/index.js")> | undefined;
function loadAppModule(): Promise<typeof import("../src/index.js")> {
  appModule ??= import("../src/index.js");
  return appModule;
}

function track(originalName: string, provider: NormalizedTrack["source"]["provider"] = "netease"): NormalizedTrack {
  return { originalName, artists: [], source: { provider, raw: {} } };
}

let matcherModule: Promise<typeof import("../src/apple/matcher.js")> | undefined;
function loadMatcherModule(): Promise<typeof import("../src/apple/matcher.js")> {
  matcherModule ??= import("../src/apple/matcher.js");
  return matcherModule;
}

function cover(fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function appleSong(
  id: string,
  artworkUrl?: string,
  contentRating?: AppleContentRating,
  albumName = "Album"
): AppleSong {
  return {
    id,
    type: "songs",
    attributes: {
      name: "Song",
      artistName: "Artist",
      albumName,
      durationInMillis: 180_000,
      artwork: artworkUrl ? { url: artworkUrl } : undefined,
      contentRating
    }
  };
}

function tiePrefs(): MatchPreferences {
  return {
    ...DEFAULT_MATCH_PREFERENCES,
    threshold: 0.7,
    ambiguousGap: 0.1,
    preferDurationMatch: false,
    explicitPreference: "none"
  };
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

test("Apple Music matcher uses album cover similarity for near-tied candidates", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumCoverUrl: cover("red"),
      source: { provider: "qq", raw: {} }
    },
    [appleSong("blue", cover("blue")), appleSong("red", cover("red"))],
    "us",
    tiePrefs()
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "red");
  assert.match(result.reason ?? "", /album cover similarity/);
});

test("Apple Music matcher uses exact album match for near-tied candidates", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Source Album",
      source: { provider: "qq", raw: {} }
    },
    [
      appleSong("wrong-album", undefined, undefined, "Other Album"),
      appleSong("source-album", undefined, undefined, "Source Album")
    ],
    "us",
    tiePrefs()
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "source-album");
  assert.match(result.reason ?? "", /album match/);
});

test("Apple Music matcher keeps ambiguity when cover art is missing", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      source: { provider: "qq", raw: {} }
    },
    [appleSong("a", cover("blue")), appleSong("b", cover("red"))],
    "us",
    tiePrefs()
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.selectedId, undefined);
});

test("Apple Music retry only replaces not-found results", async () => {
  const { retryNotFoundAppleMusic } = await loadMatcherModule();
  const matchedTrack: NormalizedTrack = {
    originalName: "Matched",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };
  const missingTrack: NormalizedTrack = {
    originalName: "Missing",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };
  const manualNoMatchTrack: NormalizedTrack = {
    originalName: "Manual no match",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };

  const report = await retryNotFoundAppleMusic({
    provider: "qq",
    playlistId: "retry-only-not-found",
    playlistName: "Retry only not found",
    results: [
      {
        track: matchedTrack,
        status: "matched",
        selectedId: "apple-ok",
        appleMusicId: "apple-ok",
        candidates: [{ id: "apple-ok", name: "Matched", artistName: "Artist", score: 1 }]
      },
      {
        track: missingTrack,
        status: "not_found",
        candidates: [],
        reason: "No results from Apple Music search"
      },
      {
        track: manualNoMatchTrack,
        status: "not_found",
        selectionSource: "manual",
        candidates: [{ id: "apple-no", name: "Manual no match", artistName: "Artist", score: 0.9 }],
        reason: "Marked as no match"
      }
    ]
  });

  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].appleMusicId, "apple-ok");
  assert.equal(report.results[1].status, "not_implemented");
  assert.equal(report.results[2].status, "not_implemented");
});

test("Apple Music retry can refresh selected result indices once", async () => {
  const { retryAppleMusicResults } = await loadMatcherModule();
  const keepTrack: NormalizedTrack = {
    originalName: "Keep",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };
  const selectedTrack: NormalizedTrack = {
    originalName: "Selected",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };
  const duplicateTrack: NormalizedTrack = {
    originalName: "Duplicate selected",
    artists: ["Artist"],
    source: { provider: "qq", raw: {} }
  };

  const report = await retryAppleMusicResults(
    {
      provider: "qq",
      playlistId: "retry-selected",
      playlistName: "Retry selected",
      results: [
        {
          track: keepTrack,
          status: "matched",
          selectedId: "keep",
          appleMusicId: "keep",
          candidates: [{ id: "keep", name: "Keep", artistName: "Artist", score: 1 }]
        },
        {
          track: selectedTrack,
          status: "ambiguous",
          candidates: [{ id: "selected", name: "Selected", artistName: "Artist", score: 0.9 }]
        },
        {
          track: duplicateTrack,
          status: "not_found",
          candidates: [],
          reason: "No results from Apple Music search"
        }
      ]
    },
    [2, 1, 2]
  );

  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].appleMusicId, "keep");
  assert.equal(report.results[1].status, "not_implemented");
  assert.equal(report.results[2].status, "not_implemented");
});
