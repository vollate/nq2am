import assert from "node:assert/strict";
import test from "node:test";
import { getAmbiguousIndices, getNotFoundIndices, getRetryIndices } from "../src/matchFilters.js";

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
    { status: "ambiguous" },
    { status: "not_found", candidates: [] }
  ]);

  assert.deepEqual(indices, [1, 3]);
});

test("retry scopes select the expected result indices", () => {
  const results = [
    { status: "matched" },
    { status: "ambiguous" },
    { status: "not_found", candidates },
    { status: "not_implemented" }
  ] as const;

  assert.deepEqual(getRetryIndices(results, "not_found"), [2]);
  assert.deepEqual(getRetryIndices(results, "ambiguous"), [1]);
  assert.deepEqual(getRetryIndices(results, "all"), [0, 1, 2, 3]);
  assert.deepEqual(getRetryIndices(results, "selected", [2, 1, 2, 99, -1]), [2, 1]);
});
