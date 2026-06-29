import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeNeteasePlaylist, normalizeQqPlaylist } from "../src/index.js";

test("normalizes QQ Music playlist fixture", async () => {
  const payload = JSON.parse(await readFile("tests/fixtures/qq-playlist.json", "utf8"));
  const playlist = normalizeQqPlaylist(payload);

  assert.equal(playlist.provider, "qq");
  assert.equal(playlist.id, "12345");
  assert.equal(playlist.name, "QQ Fixture Playlist");
  assert.equal(playlist.tracks.length, 2);
  assert.equal(playlist.tracks[0].originalName, "残酷な天使のテーゼ");
  assert.deepEqual(playlist.tracks[0].artists, ["高橋洋子"]);
  assert.equal(playlist.tracks[0].albumArtist, "EVANGELION");
  assert.equal(playlist.tracks[0].albumCoverUrl, "https://y.qq.com/music/photo_new/T002R300x300M000qq-album-1.jpg");
  assert.equal(playlist.tracks[1].source.songId, "67890");
});

test("normalizes NetEase Cloud Music playlist fixture", async () => {
  const payload = JSON.parse(await readFile("tests/fixtures/netease-playlist.json", "utf8"));
  const playlist = normalizeNeteasePlaylist(payload);

  assert.equal(playlist.provider, "netease");
  assert.equal(playlist.id, "54321");
  assert.equal(playlist.name, "NetEase Fixture Playlist");
  assert.equal(playlist.tracks.length, 2);
  assert.equal(playlist.tracks[0].originalName, "名前のない怪物");
  assert.deepEqual(playlist.tracks[0].artists, ["EGOIST"]);
  assert.equal(playlist.tracks[0].albumArtist, "EGOIST");
  assert.equal(playlist.tracks[1].albumArtist, "LiSA");
});

test("normalizes track duration to milliseconds (qq seconds, netease ms)", () => {
  const qq = normalizeQqPlaylist({
    cdlist: [
      {
        disstid: "1",
        dissname: "d",
        songList: [{ songmid: "m1", songname: "S", interval: 215, singer: [{ name: "A" }] }]
      }
    ]
  });
  // QQ `interval` is seconds → milliseconds.
  assert.equal(qq.tracks[0].durationMs, 215000);

  const netease = normalizeNeteasePlaylist({
    playlist: {
      id: "2",
      name: "n",
      tracks: [{ id: 9, name: "S", dt: 277000, ar: [{ name: "A" }] }]
    }
  });
  // NetEase `dt` is already milliseconds.
  assert.equal(netease.tracks[0].durationMs, 277000);
});
