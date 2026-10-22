import assert from "node:assert/strict";
import test from "node:test";
import type { AppleApiSession, AppleSong } from "../src/apple/api.js";
import { runWithArtistAliasSnapshot, snapshotFromCatalogFile } from "../src/apple/artistAliasIndex.js";
import { matchAppleMusic, matchSingleTrack } from "../src/apple/matcher.js";
import { areApprovedArtistAliases, parseRecordingMetadata } from "../src/apple/recordingMetadata.js";
import { buildAppleQueryPlan } from "../src/apple/retrieval.js";
import { compareVersionRelation } from "../src/apple/versionSemantics.js";
import { DEFAULT_MATCH_PREFERENCES, type NormalizedPlaylist, type NormalizedTrack } from "../src/types.js";

function song(id: string, name: string, artistName = "Artist", durationInMillis = 180_000, isrc?: string): AppleSong {
  return {
    id,
    type: "songs",
    attributes: { name, artistName, albumName: "Album", durationInMillis, isrc }
  };
}

function track(name = "Song", artists = ["Artist"]): NormalizedTrack {
  return {
    originalName: name,
    artists,
    albumName: "Album",
    durationMs: 180_000,
    source: { provider: "qq", raw: {} }
  };
}

function session(search: AppleApiSession["search"]): AppleApiSession {
  return {
    search,
    songsByIsrc: async () => [],
    getStorefront: async () => "us",
    createPlaylist: async () => "playlist",
    getStats: () => ({ requestCount: 0, retryCount: 0 }),
    close: async () => {}
  };
}

async function runWithSearch(sourceTrack: NormalizedTrack, search: AppleApiSession["search"]) {
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: "recording-v2",
    tracks: [sourceTrack],
    raw: {}
  };
  return matchAppleMusic(
    playlist,
    { ...DEFAULT_MATCH_PREFERENCES, storefront: "us", nativeSearch: false, matchConcurrency: 1 },
    undefined,
    { logger: () => {}, sessionFactory: async () => session(search) }
  );
}

test("recording parser separates changing, structural, release, and featured metadata", () => {
  const parsed = parseRecordingMetadata("Song (feat. 初音ミク) [Extended Mix] (2024 Remaster)");
  assert.equal(parsed.baseTitle, "song");
  assert.deepEqual(parsed.featuredArtists, ["初音ミク"]);
  assert.deepEqual(parsed.recordingFacets, []);
  assert.deepEqual(parsed.structuralFacets, ["extended"]);
  assert.deepEqual(parsed.releaseFacets, ["remaster"]);

  assert.deepEqual(parseRecordingMetadata("Song (Live)").recordingFacets, ["live"]);
  assert.deepEqual(parseRecordingMetadata("Song - Off Vocal").recordingFacets, ["off_vocal"]);
  for (const [title, facet] of [
    ["Song (Remix)", "remix"],
    ["Song (Cover)", "cover"],
    ["Song (Instrumental)", "instrumental"],
    ["Song (Karaoke)", "karaoke"]
  ]) {
    assert.ok(parseRecordingMetadata(title).recordingFacets.includes(facet));
  }
  assert.ok(parseRecordingMetadata("Song (Long Version)").structuralFacets.includes("long"));
  assert.ok(parseRecordingMetadata("Song (Radio Edit)").structuralFacets.includes("radio_edit"));
  assert.ok(parseRecordingMetadata("Song (Game Ver.)").structuralFacets.includes("generic_version"));
  assert.equal(
    parseRecordingMetadata("Song (Game Ver.)").versionDescriptors.some((d) => d.kind === "game"),
    true
  );
  assert.equal(parseRecordingMetadata("Ｓｏｎｇ（Ｌｉｖｅ）").baseTitle, "song");
});

test("named version payloads stay distinct after stripping wrappers", () => {
  const anniversary = parseRecordingMetadata("弧ギツネの乱 (10th Anniversary ver.) [feat. 鏡音リン]");
  const memorial = parseRecordingMetadata("弧ギツネの乱 (10周年記念ver.)");
  const band = parseRecordingMetadata("弧ギツネの乱 (まらおバンド ver.)");
  const bandBan = parseRecordingMetadata("弧ギツネの乱 (まらおバンド版)");
  const arrange = parseRecordingMetadata("弧ギツネの乱 (バンドアレンジ)");
  const numbered = parseRecordingMetadata("Beautiful Birthday (3rd Season #11Ver.)");
  assert.equal(anniversary.baseTitle, "弧ギツネの乱");
  assert.deepEqual(anniversary.featuredArtists, ["鏡音リン"]);
  assert.ok(anniversary.versionDescriptors.some((d) => d.kind === "anniversary" && d.ordinal === "10"));
  assert.equal(compareVersionRelation(anniversary, memorial), "agree");
  assert.equal(compareVersionRelation(anniversary, band), "conflict");
  assert.equal(band.baseTitle, "弧ギツネの乱");
  assert.equal(bandBan.baseTitle, "弧ギツネの乱");
  assert.equal(arrange.baseTitle, "弧ギツネの乱");
  assert.equal(numbered.baseTitle, "beautiful birthday");
  assert.ok(numbered.versionDescriptors.some((d) => d.identityRelevant));
  assert.ok(parseRecordingMetadata("(Don't Fear) The Reaper").baseTitle.includes("dont fear"));
});

test("an anniversary source does not auto-match a band arrangement", async () => {
  // This version-conflict test must not depend on a downloaded user catalog.
  const aliases = snapshotFromCatalogFile({
    version: 1,
    refreshedAt: "fixture",
    sources: [],
    groups: [["まらしぃ", "marasy"]]
  });
  const result = await runWithArtistAliasSnapshot(aliases, () =>
    matchSingleTrack(
      {
        ...track("弧ギツネの乱 (10th Anniversary ver.) [feat. 鏡音リン]", ["まらしぃ"]),
        durationMs: 236_000
      },
      [
        song("anniversary", "弧ギツネの乱 (10th Anniversary ver.) [feat. 鏡音リン]", "marasy", 236_000, "ISRC-ANN"),
        song("band", "弧ギツネの乱 (まらおバンド ver.)", "marasy", 234_000, "ISRC-BAND")
      ],
      "us",
      DEFAULT_MATCH_PREFERENCES
    )
  );
  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "anniversary");
  assert.ok((result.recordingGroups?.length ?? 0) >= 2);
});

test("a labelled source does not treat a close unlabelled title as deterministic", async () => {
  const result = await matchSingleTrack(
    {
      ...track("弧ギツネの乱 (10th Anniversary ver.)", ["まらしぃ"]),
      durationMs: 236_000
    },
    [song("plain", "弧ギツネの乱", "まらしぃ", 236_000, "ISRC-PLAIN")],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.notEqual(result.status, "matched");
});

test("recording parser handles Chinese suffixes and does not treat mix as remix", () => {
  assert.deepEqual(parseRecordingMetadata("起风了 (伴奏)").recordingFacets, ["instrumental"]);
  assert.equal(parseRecordingMetadata("起风了 (伴奏)").baseTitle, "起风了");
  assert.deepEqual(parseRecordingMetadata("前前前世 (翻唱)").recordingFacets, ["cover"]);
  assert.ok(parseRecordingMetadata("Lemon (现场版)").recordingFacets.includes("live"));
  assert.ok(parseRecordingMetadata("起风了 (DJ版)").recordingFacets.includes("remix"));
  assert.ok(parseRecordingMetadata("光るなら (完整版)").structuralFacets.includes("full"));
  assert.equal(parseRecordingMetadata("光るなら (完整版)").baseTitle, "光るなら");

  const soundtrack = parseRecordingMetadata("起风了 (电影《乘风破浪》主题曲)");
  assert.equal(soundtrack.baseTitle, "起风了");
  assert.ok(soundtrack.releaseFacets.includes("theme"));
  assert.ok(soundtrack.releaseFacets.includes("media_tie"));

  const extendedMix = parseRecordingMetadata("Song (Extended Mix)");
  assert.deepEqual(extendedMix.recordingFacets, []);
  assert.ok(extendedMix.structuralFacets.includes("extended"));
  assert.ok(parseRecordingMetadata("Song (Remix)").recordingFacets.includes("remix"));
});

test("query planner is bounded, normalized, and includes native account fallback", () => {
  const plan = buildAppleQueryPlan(
    {
      ...track("Song (Extended)", ["Primary", "Featured"]),
      albumName: "Source Album"
    },
    { primaryStorefront: "jp", accountStorefront: "us", maxPasses: 8 }
  );
  assert.ok(plan.length <= 8);
  assert.equal(plan[0].variant, "original_primary_artist");
  assert.equal(plan[0].term.toLowerCase(), "song primary");
  assert.ok(plan.some((query) => query.variant === "base_primary_artist" && /extended/i.test(query.term)));
  assert.ok(plan.some((query) => query.variant === "base_additional_artist"));
  assert.ok(plan.some((query) => query.variant === "base_album"));
  assert.ok(plan.some((query) => query.fallback && query.storefront === "us"));
  assert.equal(new Set(plan.map((query) => `${query.storefront}:${query.term.toLowerCase()}`)).size, plan.length);
});

test("required first query uses cleaned base title without soundtrack suffixes", () => {
  const plan = buildAppleQueryPlan(
    {
      ...track("起风了 (电影《乘风破浪》主题曲)", ["买辣椒也用券"]),
      albumName: "起风了"
    },
    { primaryStorefront: "cn", accountStorefront: "us", maxPasses: 8 }
  );
  assert.equal(plan[0].variant, "original_primary_artist");
  assert.equal(plan[0].term, "起风了 买辣椒也用券");
  assert.ok(!plan[0].term.includes("主题曲"));
  assert.ok(plan.some((query) => query.term.includes("主题曲")));
});

test("required first query uses cleaned base title and can match without the dirty original", async () => {
  const calls: string[] = [];
  const report = await runWithSearch(track("Song (Extended)"), async (term) => {
    calls.push(term);
    return term.toLowerCase().startsWith("song artist") ? [song("extended", "Song", "Artist", 180_000)] : [];
  });
  assert.equal(report.results[0].status, "matched");
  assert.equal(calls[0].toLowerCase(), "song artist");
  assert.equal(report.results[0].retrieval?.earlyStopped, true);
  assert.equal(report.results[0].candidates?.[0].provenance?.[0].variant, "original_primary_artist");
});

test("native retrieval falls back to the account storefront only after native misses", async () => {
  const storefronts: string[] = [];
  const playlist: NormalizedPlaylist = {
    provider: "netease",
    id: "storefront-fallback",
    tracks: [{ ...track("ゆめ"), source: { provider: "netease", raw: {} } }],
    raw: {}
  };
  const report = await matchAppleMusic(
    playlist,
    { ...DEFAULT_MATCH_PREFERENCES, storefront: "us", nativeSearch: true, matchConcurrency: 1 },
    undefined,
    {
      logger: () => {},
      sessionFactory: async () =>
        session(async (_term, storefront) => {
          storefronts.push(storefront);
          return storefront === "us" ? [song("account", "ゆめ")] : [];
        })
    }
  );

  assert.equal(report.results[0].status, "matched");
  assert.ok(storefronts.includes("jp"));
  assert.ok(storefronts.includes("us"));
});

test("plausible native hit still searches the account storefront", async () => {
  const storefronts: string[] = [];
  const playlist: NormalizedPlaylist = {
    provider: "qq",
    id: "plausible-fallback",
    tracks: [{ ...track("炎", ["LiSA"]), source: { provider: "qq", raw: {} } }],
    raw: {}
  };
  const report = await matchAppleMusic(
    playlist,
    { ...DEFAULT_MATCH_PREFERENCES, storefront: "us", nativeSearch: true, matchConcurrency: 1 },
    undefined,
    {
      logger: () => {},
      sessionFactory: async () =>
        session(async (_term, storefront) => {
          storefronts.push(storefront);
          if (storefront === "cn") return [song("cn-near", "炎", "LiSA", 220_000)];
          if (storefront === "us") return [song("account", "炎", "LiSA", 180_000)];
          return [];
        })
    }
  );

  assert.ok(storefronts.includes("cn"));
  assert.ok(storefronts.includes("jp"));
  assert.ok(storefronts.includes("us"));
  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].selectedId, "account");
});

test("extended mix is compatible with the original when duration agrees", async () => {
  const result = await matchSingleTrack(
    track(),
    [song("xm", "Song (Extended Mix)", "Artist", 180_000)],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "xm");
});

test("Chinese accompaniment and DJ versions do not auto-match the studio vocal", async () => {
  const vocal = song("vocal", "起风了", "买辣椒也用券", 180_000);
  const accompaniment = await matchSingleTrack(
    track("起风了 (伴奏)", ["买辣椒也用券"]),
    [vocal],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  const dj = await matchSingleTrack(track("起风了 (DJ版)", ["买辣椒也用券"]), [vocal], "us", DEFAULT_MATCH_PREFERENCES);
  const cover = await matchSingleTrack(
    track("起风了 (翻唱)", ["买辣椒也用券"]),
    [vocal],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  const live = await matchSingleTrack(
    track("起风了 (现场版)", ["买辣椒也用券"]),
    [vocal],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.notEqual(accompaniment.status, "matched");
  assert.notEqual(dj.status, "matched");
  assert.notEqual(cover.status, "matched");
  assert.notEqual(live.status, "matched");
});

test("candidate union deduplicates repeated responses and retains query provenance", async () => {
  const source = { ...track(), albumName: undefined, durationMs: undefined };
  const report = await runWithSearch(source, async () => [song("repeated", "Song")]);
  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].retrieval?.uniqueCandidateCount, 1);
  assert.equal(report.results[0].candidates?.[0].provenance?.length, 2);
});

test("optional retrieval failure preserves candidates from an earlier successful pass", async () => {
  let call = 0;
  const source = { ...track(), durationMs: undefined };
  const report = await runWithSearch(source, async () => {
    call += 1;
    if (call === 1) return [song("candidate", "Song")];
    if (call === 2) throw new Error("optional query failed");
    return [];
  });
  assert.equal(report.results[0].status, "matched");
  assert.ok(report.results[0].retrieval?.queries.some((query) => query.status === "failed"));
  assert.equal(report.results[0].requestFailure, undefined);
});

test("required retrieval failure remains request_failed", async () => {
  const report = await runWithSearch(track(), async () => {
    throw new Error("catalog transport failed");
  });
  assert.equal(report.results[0].status, "request_failed");
  assert.equal(report.results[0].retrieval?.outcome, "failed");
});

test("zero candidates and rejected candidates have distinct semantic outcomes", async () => {
  const noCandidates = await matchSingleTrack(track(), [], "us", DEFAULT_MATCH_PREFERENCES);
  const rejected = await matchSingleTrack(track(), [song("live", "Song (Live)")], "us", DEFAULT_MATCH_PREFERENCES);
  assert.equal(noCandidates.status, "not_found");
  assert.equal(rejected.status, "score_rejected");
});

test("same-recording releases are grouped before the ambiguity margin", async () => {
  const result = await matchSingleTrack(
    track(),
    [song("single", "Song", "Artist", 180_000, "ISRC-ONE"), song("album", "Song", "Artist", 181_000, "ISRC-ONE")],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(result.status, "matched");
  assert.equal(result.recordingGroups?.length, 1);
  assert.equal(result.recordingGroups?.[0].candidateIds.length, 2);
});

test("a performer named inside a character credit counts as a credit", async () => {
  const result = await matchSingleTrack(
    track("hectopascal", ["寿美菜子", "高田憂希"]),
    [song("cv", "hectopascal", "小糸 侑(CV:高田憂希)、七海燈子(CV:寿 美菜子)", 180_000, "ISRC-CV")],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "cv");
});

test("a character name does not become an alias of its performer", () => {
  assert.equal(areApprovedArtistAliases("小糸侑", "高田憂希"), false);
});

test("duplicate releases are grouped even though each carries its own ISRC", async () => {
  const result = await matchSingleTrack(
    track(),
    [song("single", "Song", "Artist", 180_000, "ISRC-SINGLE"), song("ep", "Song", "Artist", 180_100, "ISRC-EP")],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(result.status, "matched");
  assert.equal(result.recordingGroups?.length, 1);
  assert.equal(result.recordingGroups?.[0].candidateIds.length, 2);
});

test("separate ISRCs stay separate when the performers disagree", async () => {
  const result = await matchSingleTrack(
    track(),
    [
      song("with-one", "Song (feat. のぶなが)", "Artist", 180_000, "ISRC-ONE"),
      song("with-other", "Song (feat. 初音ミク)", "Artist", 180_050, "ISRC-TWO")
    ],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(result.recordingGroups?.length, 2);
});

test("a variant label the source did not ask for does not make the plain recording ambiguous", async () => {
  const result = await matchSingleTrack(
    track(),
    [
      song("plain", "Song", "Artist", 180_000, "ISRC-PLAIN"),
      song("variant", "Song -北京語ver.-", "Artist", 181_500, "ISRC-VARIANT")
    ],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(result.status, "matched");
  assert.equal(result.selectedId, "plain");
});

test("conflicting reused ISRC versions are not merged", async () => {
  const result = await matchSingleTrack(
    track(),
    [song("original", "Song", "Artist", 180_000, "REUSED"), song("live", "Song (Live)", "Artist", 240_000, "REUSED")],
    "us",
    DEFAULT_MATCH_PREFERENCES
  );
  assert.equal(result.recordingGroups?.length, 2);
  assert.ok(result.recordingGroups?.some((group) => group.conflicts.length > 0));
});
