import assert from "node:assert/strict";
import test from "node:test";
import { parseNeteasePlaylistId, parseQqPlaylistId } from "../src/index.js";

test("parses QQ playlist ids from common URL forms", () => {
  assert.equal(parseQqPlaylistId("https://y.qq.com/n/ryqq/playlist/123456"), "123456");
  assert.equal(parseQqPlaylistId("https://y.qq.com/n/yqq/playlist/123456.html"), "123456");
  assert.equal(parseQqPlaylistId("https://i.y.qq.com/n2/m/share/details/taoge.html?id=123456"), "123456");
  assert.equal(parseQqPlaylistId("https://example.com/?disstid=123456"), "123456");
});

test("parses NetEase playlist ids from common URL forms", () => {
  assert.equal(parseNeteasePlaylistId("https://music.163.com/#/playlist?id=123456"), "123456");
  assert.equal(parseNeteasePlaylistId("https://music.163.com/playlist?id=123456"), "123456");
  assert.equal(parseNeteasePlaylistId("https://music.163.com/discover/playlist/123456"), "123456");
});

test("rejects unsupported playlist URLs", () => {
  assert.throws(() => parseQqPlaylistId("https://y.qq.com/n/ryqq/songDetail/abc"));
  assert.throws(() => parseNeteasePlaylistId("https://music.163.com/song?id=123"));
});
