import assert from "node:assert/strict";
import test from "node:test";
import {
  areReviewOptionsCollapsed,
  collapseReviewOptionsAfterChoice,
  toggleReviewOptions
} from "../src/reviewCollapse.js";

test("review choices fold only the chosen original track", () => {
  const collapsed = collapseReviewOptionsAfterChoice(new Set([1]), 3);

  assert.deepEqual([...collapsed].sort(), [1, 3]);
});

test("review option toggle reopens and refolds a single original track", () => {
  const reopened = toggleReviewOptions(new Set([2, 5]), 2);
  assert.deepEqual([...reopened].sort(), [5]);

  const refolded = toggleReviewOptions(reopened, 2);
  assert.deepEqual([...refolded].sort(), [2, 5]);
});

test("manual no-match options stay folded after transient UI state resets", () => {
  assert.equal(
    areReviewOptionsCollapsed(
      {
        status: "not_found",
        selectionSource: "manual",
        candidates: [{ id: "apple-1" }]
      },
      4,
      new Set(),
      new Set()
    ),
    true
  );
});

test("manual no-match options can still be reopened explicitly", () => {
  assert.equal(
    areReviewOptionsCollapsed(
      {
        status: "not_found",
        selectionSource: "manual",
        candidates: [{ id: "apple-1" }]
      },
      4,
      new Set(),
      new Set([4])
    ),
    false
  );
});
