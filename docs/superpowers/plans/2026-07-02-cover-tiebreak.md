# Cover Tie-Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a best-effort album-cover tie-breaker for near-tied Apple Music candidates.

**Architecture:** Keep existing matcher scoring authoritative. Add a focused artwork helper that returns the best near-tied candidate only when cover similarity has a clear margin, and call it from the existing ambiguous branch.

**Tech Stack:** TypeScript, Node 20 `fetch`, Playwright canvas decoding, `node:test`.

---

### Task 1: Artwork Similarity Helper

**Files:**
- Create: `src/apple/artwork.ts`
- Test: `tests/apple.test.ts`

- [ ] Add `src/apple/artwork.ts` with `chooseByCoverSimilarity(track, candidates)`.
- [ ] Fetch source/candidate images, decode them in Playwright canvas, and compare compact features.
- [ ] Return `undefined` when art is missing, image work fails, best similarity is too weak, or the best margin is too small.

### Task 2: Matcher Integration

**Files:**
- Modify: `src/apple/matcher.ts`
- Test: `tests/apple.test.ts`

- [ ] Make the single-track matching path asynchronous so it can await cover comparison only in the near-tie branch.
- [ ] In the near-tie branch, compare only candidates within `ambiguousGap` of the best score.
- [ ] If cover similarity chooses a candidate, return a normal auto `matched` result for that candidate.
- [ ] If cover comparison cannot choose, preserve the existing `ambiguous` result.

### Task 3: Verification

**Files:**
- Test: `tests/apple.test.ts`

- [ ] Add deterministic data-URL image tests for cover tie-breaking and missing-cover fallback.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm run build:web`.
