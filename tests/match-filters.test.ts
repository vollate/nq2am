import assert from "node:assert/strict";
import test from "node:test";
import {
  getAmbiguousIndices,
  getNotFoundIndices,
  getRequestFailedIndices,
  getRetryIndices,
  getScoreRejectedIndices,
  MATCH_SCOPES,
  retryScopeForTab
} from "../src/matchFilters.js";

const candidates = [{ id: "apple-1" }];

test("ambiguous list contains only ambiguous tracks", () => {
  const indices = getAmbiguousIndices([
    { status: "matched" },
    { status: "ambiguous" },
    { status: "not_found", candidates },
    { status: "not_found", candidates: [] }
  ]);

  assert.deepEqual(indices, [1]);
});

test("not-found list contains every not-found track", () => {
  const indices = getNotFoundIndices([
    { status: "matched" },
    { status: "not_found", candidates },
    { status: "request_failed" },
    { status: "ambiguous" },
    { status: "not_found", candidates: [] }
  ]);

  assert.deepEqual(indices, [1, 4]);
});

test("score-rejected list contains only classifier rejections", () => {
  assert.deepEqual(
    getScoreRejectedIndices([
      { status: "not_found", candidates: [] },
      { status: "score_rejected", candidates },
      { status: "request_failed" }
    ]),
    [1]
  );
});

test("request-failed list excludes semantic not-found tracks", () => {
  const indices = getRequestFailedIndices([
    { status: "request_failed" },
    { status: "not_found", candidates: [] },
    { status: "request_failed" },
    { status: "ambiguous" }
  ]);

  assert.deepEqual(indices, [0, 2]);
});

test("retry scopes select the expected result indices", () => {
  const results = [
    { status: "matched" },
    { status: "ambiguous" },
    { status: "not_found", candidates },
    { status: "score_rejected", candidates },
    { status: "request_failed" },
    { status: "not_implemented" }
  ] as const;

  assert.deepEqual(getRetryIndices(results, "not_found"), [2]);
  assert.deepEqual(getRetryIndices(results, "ambiguous"), [1]);
  assert.deepEqual(getRetryIndices(results, "score_rejected"), [3]);
  assert.deepEqual(getRetryIndices(results, "request_failed"), [4]);
  assert.deepEqual(getRetryIndices(results, "all"), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(getRetryIndices(results, "selected", [4, 2, 4, 99, -1]), [4, 2]);
});

test("Agent and Retry quick scopes include the same groups without falling back from an empty scope", () => {
  assert.deepEqual(MATCH_SCOPES, ["request_failed", "not_found", "score_rejected", "ambiguous", "selected", "all"]);
  const results = [{ status: "matched" }, { status: "not_found" }] as const;
  assert.deepEqual(getRetryIndices(results, "ambiguous", [0]), []);
  assert.deepEqual(getRetryIndices(results, "not_found", [0]), [1]);
  assert.deepEqual(getRetryIndices(results, "selected", []), []);
  assert.deepEqual(getRetryIndices(results, "selected", [1, 1, -1, 2]), [1]);
  for (const scope of MATCH_SCOPES) assert.deepEqual(getRetryIndices([], scope, [0]), []);
});

test("retry scope follows retryable review tabs", () => {
  assert.equal(retryScopeForTab("ambiguous", "not_found"), "ambiguous");
  assert.equal(retryScopeForTab("not_found", "ambiguous"), "not_found");
  assert.equal(retryScopeForTab("score_rejected", "not_found"), "score_rejected");
  assert.equal(retryScopeForTab("request_failed", "not_found"), "request_failed");
  assert.equal(retryScopeForTab("all", "ambiguous"), "ambiguous");
  assert.equal(retryScopeForTab("matched", "selected"), "selected");
});
