import assert from "node:assert/strict";
import test from "node:test";
import { getNotFoundIndices, getReviewIndices } from "../src/matchFilters.js";

const candidates = [{ id: "apple-1" }];

test("review list contains ambiguous tracks and not-found tracks with candidates", () => {
  const indices = getReviewIndices([
    { status: "matched" },
    { status: "ambiguous" },
    { status: "not_found", candidates },
    { status: "not_found", candidates: [] }
  ]);

  assert.deepEqual(indices, [1, 2]);
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
