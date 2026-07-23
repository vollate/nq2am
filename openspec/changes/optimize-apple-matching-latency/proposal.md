## Why

Apple Music matching is much slower than the catalog requests alone require. A
single playlist is processed track by track, each Apple API call creates a new
browser context and navigates to `music.apple.com`, native-store results can
trigger a serial ISRC lookup for every candidate, and cover comparison launches
another browser. This makes network and browser startup latency dominate the
matching score calculation, especially on remote servers.

## What Changes

- Record per-stage latency and request counts for storefront detection, catalog
  search, ISRC bridging, artwork download, and artwork comparison in server
  logs.
- Reuse an authenticated Apple Music request session for the lifetime of a
  matching job instead of opening the Apple Music web page for every request.
- Resolve account-store IDs only for candidates that are selected
  automatically or manually, rather than eagerly resolving every search
  candidate.
- Process independent tracks with conservative bounded concurrency and a
  centralized rate limiter, including retry/backoff behavior for transient
  Apple API failures and rate-limit responses.
- Reuse artwork-processing resources and cache downloaded or computed artwork
  features within a job.
- Apply explicit timeouts to catalog requests and artwork processing so one
  stalled request cannot indefinitely block the playlist.
- Preserve the existing scoring, ambiguity, retry, progress, and playlist
  creation behavior while reducing total matching time.
- Remove the obsolete completed Superpowers design and plan documents from
  `docs/`.

## Capabilities

### New Capabilities

- `apple-matching-performance`: Defines reusable Apple sessions, bounded and
  rate-aware matching concurrency, lazy ISRC bridging, stage-level latency
  reporting, and resource reuse for artwork comparison.

### Modified Capabilities

None.

## Impact

The primary implementation areas are `src/apple/api.ts`,
`src/apple/matcher.ts`, `src/apple/artwork.ts`, and the server-side match task
runner. Internal Apple request lifecycle and scheduling will change, but the
HTTP API and saved match-report format should remain backward compatible.
Tests will need deterministic coverage for concurrency limits, lazy ISRC
resolution, timeout handling, and unchanged match decisions. No new runtime
dependency is expected.
