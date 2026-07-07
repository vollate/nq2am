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

function splitCover(left: string, right: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="32" height="64" fill="${left}"/><rect x="32" width="32" height="64" fill="${right}"/></svg>`;
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

function appleSongWith(
  id: string,
  attrs: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationMs?: number;
    artworkUrl?: string;
    contentRating?: AppleContentRating;
  } = {}
): AppleSong {
  return {
    id,
    type: "songs",
    attributes: {
      name: attrs.name ?? "Song",
      artistName: attrs.artistName ?? "Artist",
      albumName: attrs.albumName ?? "Album",
      durationInMillis: attrs.durationMs ?? 180_000,
      artwork: attrs.artworkUrl ? { url: attrs.artworkUrl } : undefined,
      contentRating: attrs.contentRating
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

test("Apple Music matcher normalizes exact metadata score and records breakdown", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [appleSong("exact")],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  const best = result.candidates?.[0];
  assert.ok(best);
  assert.ok(best.score >= 0.99);
  assert.ok(best.score <= 1);
  const breakdown = best.scoreBreakdown;
  assert.ok(breakdown);
  assert.equal(breakdown.total, best.score);
  assert.equal(breakdown.fields.title, 1);
  assert.equal(breakdown.fields.artist, 1);
  assert.equal(breakdown.fields.album, 1);
  assert.equal(breakdown.fields.duration, 1);
});

test("Apple Music matcher scores source-album candidates above same-title wrong albums", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Source Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [
      appleSongWith("wrong-album", { albumName: "Other Album" }),
      appleSongWith("source-album", { albumName: "Source Album" })
    ],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "source-album");
  const sourceAlbum = result.candidates?.find((c) => c.id === "source-album");
  const wrongAlbum = result.candidates?.find((c) => c.id === "wrong-album");
  assert.ok(sourceAlbum && wrongAlbum);
  assert.ok(sourceAlbum.score > wrongAlbum.score);
});

test("Apple Music matcher keeps text identity stronger than duration", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [
      appleSongWith("right-text-wrong-duration", { durationMs: 260_000 }),
      appleSongWith("wrong-text-right-duration", {
        name: "Different Song",
        artistName: "Other Artist",
        durationMs: 180_000
      })
    ],
    "us",
    { ...DEFAULT_MATCH_PREFERENCES, ambiguousGap: 0.01 }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "right-text-wrong-duration");
  const winner = result.candidates?.[0];
  assert.ok(winner);
  assert.ok(winner.score <= 1);
  const breakdown = winner.scoreBreakdown;
  assert.ok(breakdown);
  assert.equal(breakdown.fields.duration, 0);
});

test("Apple Music matcher rejects unwanted off-vocal versions below threshold", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [appleSongWith("off-vocal", { name: "Song (Off Vocal)" })],
    "us",
    { ...DEFAULT_MATCH_PREFERENCES, threshold: 0.8 }
  );

  assert.equal(result.status, "not_found");
  assert.match(result.reason ?? "", /below threshold/);
});

test("Apple Music matcher allows requested off-vocal versions", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song (Off Vocal)",
      artists: ["Artist"],
      albumName: "Album",
      durationMs: 180_000,
      source: { provider: "qq", raw: {} }
    },
    [appleSongWith("plain", { name: "Song" }), appleSongWith("off-vocal", { name: "Song (Off Vocal)" })],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "off-vocal");
});

test("Apple Music matcher treats feat annotations as credits, not title or album mismatches", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "初音ミクの消失",
      artists: ["cosMo@暴走P", "初音ミク"],
      albumName: "初音ミクの消失",
      durationMs: 292_000,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("download", {
        name: "初音ミクの消失",
        artistName: "cosMo@暴走P feat.石川綾子",
        albumName: "Download (feat.初音ミク)",
        durationMs: 289_000
      }),
      appleSongWith("single", {
        name: "初音ミクの消失 (feat. 初音ミク)",
        artistName: "cosMo@暴走P",
        albumName: "初音ミクの消失 (feat. 初音ミク)",
        durationMs: 292_000
      })
    ],
    "jp",
    { ...DEFAULT_MATCH_PREFERENCES, threshold: 0.8 }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "single");
  assert.ok((result.candidates?.find((c) => c.id === "single")?.score ?? 0) >= 0.9);
});

test("Apple Music matcher treats remaster annotations as version metadata", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "fragments (2015 rework)",
      artists: ["kamome sano"],
      albumName: "archive001:reworks+",
      durationMs: 290_000,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("remaster", {
        name: "Fragments (2015 Rework) [2022 Remaster]",
        artistName: "Kamome Sano",
        albumName: "Archive001:Reworks+ (2022 Remaster)",
        durationMs: 290_000
      })
    ],
    "tr",
    { ...DEFAULT_MATCH_PREFERENCES, threshold: 0.8 }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "remaster");
  assert.ok((result.candidates?.[0]?.score ?? 0) >= 0.9);
});

test("Apple Music matcher treats missing extended-version suffixes as compatible when duration agrees", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "World Vanquisher",
      artists: ["void"],
      albumName: "Perfect Solitude",
      durationMs: 355_000,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("short-single", {
        name: "World Vanquisher",
        artistName: "void(Mournfinale)",
        albumName: "Liberate the Metaverse",
        durationMs: 164_000
      }),
      appleSongWith("short-compilation", {
        name: "World Vanquisher",
        artistName: "void(Mournfinale)",
        albumName: "Chunithm All Justice Collection Episode II 1",
        durationMs: 164_000
      }),
      appleSongWith("album-extended", {
        name: "World Vanquisher (Album Extended)",
        artistName: "void(Mournfinale)",
        albumName: "Chunithm All Justice Collection Episode II 2",
        durationMs: 357_000
      })
    ],
    "tr",
    { ...DEFAULT_MATCH_PREFERENCES, threshold: 0.85 }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "album-extended");
  assert.ok((result.candidates?.[0]?.scoreBreakdown?.fields.title ?? 0) >= 0.95);
});

test("Apple Music matcher treats Apple single album suffixes as the source album", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "最強STRONGER",
      artists: ["REDALiCE", "USAO"],
      albumName: "最強STRONGER",
      durationMs: 142_000,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("single", {
        name: "最強STRONGER",
        artistName: "REDALiCE & USAO",
        albumName: "最強STRONGER - Single",
        durationMs: 142_000
      }),
      appleSongWith("compilation", {
        name: "最強STRONGER",
        artistName: "REDALiCE & USAO",
        albumName: "Arcaea Sound Collection: Memories of Wrath",
        durationMs: 143_000
      })
    ],
    "cn",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "single");
  const winner = result.candidates?.find((candidate) => candidate.id === "single");
  assert.ok(winner);
  assert.equal(winner.scoreBreakdown?.fields.album, 1);
});

test("Apple Music matcher auto-selects indistinguishable duplicate candidates", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "PUPA",
      artists: ["モリモリあつし"],
      albumName: "タイムカプセル",
      durationMs: 128_000,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("old-catalog", {
        name: "PUPA",
        artistName: "モリモリあつし",
        albumName: "タイムカプセル",
        durationMs: 128_000
      }),
      appleSongWith("new-catalog", {
        name: "PUPA",
        artistName: "モリモリあつし",
        albumName: "タイムカプセル",
        durationMs: 128_000
      })
    ],
    "jp",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "old-catalog");
  assert.match(result.reason ?? "", /duplicate/i);
});

test("Apple Music matcher auto-selects source-album duplicates with refreshed artwork URLs", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "PUPA",
      artists: ["モリモリあつし"],
      albumName: "タイムカプセル",
      durationMs: 128_000,
      source: { provider: "netease", raw: {} }
    },
    [
      appleSongWith("old-catalog", {
        name: "PUPA",
        artistName: "モリモリあつし",
        albumName: "タイムカプセル",
        durationMs: 128_000,
        artworkUrl: cover("red")
      }),
      appleSongWith("new-catalog", {
        name: "PUPA",
        artistName: "モリモリあつし",
        albumName: "タイムカプセル",
        durationMs: 128_000,
        artworkUrl: cover("blue")
      })
    ],
    "jp",
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "old-catalog");
  assert.match(result.reason ?? "", /duplicate/i);
});

test("Apple Music matcher uses album similarity for near-tied candidates", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumName: "Source Album Original Soundtrack",
      source: { provider: "qq", raw: {} }
    },
    [
      appleSongWith("wrong-album", { albumName: "Different Compilation" }),
      appleSongWith("album-similar", { albumName: "Source Album OST" })
    ],
    "us",
    { ...tiePrefs(), ambiguousGap: 0.5 }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "album-similar");
  assert.match(result.reason ?? "", /album/i);
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

test("Apple Music matcher uses cover structure when average colors are misleading", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumCoverUrl: splitCover("black", "white"),
      source: { provider: "qq", raw: {} }
    },
    [
      appleSong("same-first-color", splitCover("black", "black")),
      appleSong("same-structure", splitCover("black", "white"))
    ],
    "us",
    tiePrefs()
  );

  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "same-structure");
  assert.match(result.reason ?? "", /album cover similarity/);
});

test("Apple Music matcher keeps ambiguity when cover similarity margin is weak", async () => {
  const { matchSingleTrack } = await loadMatcherModule();
  const result = await matchSingleTrack(
    {
      originalName: "Song",
      artists: ["Artist"],
      albumCoverUrl: cover("red"),
      source: { provider: "qq", raw: {} }
    },
    [appleSong("red", cover("red")), appleSong("almost-red", cover("#f00000"))],
    "us",
    tiePrefs()
  );

  assert.equal(result.status, "ambiguous");
  assert.match(result.reason ?? "", /cover/i);
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

test("Apple Music report refresh upgrades stale ambiguous candidates", async () => {
  const { refreshAppleMatchReportCandidates } = await loadMatcherModule();
  const report = await refreshAppleMatchReportCandidates(
    {
      provider: "netease",
      playlistId: "stale-report",
      playlistName: "Stale report",
      results: [
        {
          track: {
            originalName: "最強STRONGER",
            artists: ["REDALiCE", "USAO"],
            albumName: "最強STRONGER",
            durationMs: 142_000,
            source: { provider: "netease", raw: {} }
          },
          status: "ambiguous",
          candidates: [
            {
              id: "single",
              name: "最強STRONGER",
              artistName: "REDALiCE & USAO",
              albumName: "最強STRONGER - Single",
              durationMs: 142_000,
              score: 0.95,
              storefront: "cn"
            },
            {
              id: "compilation",
              name: "最強STRONGER",
              artistName: "REDALiCE & USAO",
              albumName: "Arcaea Sound Collection: Memories of Wrath",
              durationMs: 143_000,
              score: 0.88,
              storefront: "cn"
            }
          ],
          reason: "stale ambiguous"
        },
        {
          track: {
            originalName: "PUPA",
            artists: ["モリモリあつし"],
            albumName: "タイムカプセル",
            durationMs: 128_000,
            source: { provider: "netease", raw: {} }
          },
          status: "ambiguous",
          candidates: [
            {
              id: "old-catalog",
              name: "PUPA",
              artistName: "モリモリあつし",
              albumName: "タイムカプセル",
              artworkUrl: cover("red"),
              durationMs: 128_000,
              score: 1,
              storefront: "jp"
            },
            {
              id: "new-catalog",
              name: "PUPA",
              artistName: "モリモリあつし",
              albumName: "タイムカプセル",
              artworkUrl: cover("blue"),
              durationMs: 128_000,
              score: 1,
              storefront: "jp"
            }
          ],
          reason: "stale ambiguous"
        }
      ]
    },
    DEFAULT_MATCH_PREFERENCES
  );

  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].selectedId, "single");
  assert.equal(report.results[0].candidates?.[0]?.scoreBreakdown?.fields.album, 1);
  assert.equal(report.results[1].status, "matched");
  assert.equal(report.results[1].selectedId, "old-catalog");
  assert.match(report.results[1].reason ?? "", /duplicate/i);
});
