import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowGoTopButton } from "../src/scrollUi.js";

test("go-to-top button appears only after scrolling past the threshold", () => {
  assert.equal(shouldShowGoTopButton(0), false);
  assert.equal(shouldShowGoTopButton(359), false);
  assert.equal(shouldShowGoTopButton(360), true);
});
