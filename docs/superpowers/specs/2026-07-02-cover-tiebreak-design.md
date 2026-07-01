# Cover Tie-Break Design

## Goal

When Apple Music candidates are already tied or near-tied by the existing score, use album cover similarity to pick the candidate whose artwork is closest to the source track cover.

## Scope

Cover similarity is only a tie-breaker. It must not boost unrelated candidates or change the main text, artist, duration, explicit, and version scoring rules. If source art, candidate art, network fetch, or image decoding fails, matching keeps the current ambiguous result.

## Design

The matcher builds candidates as it does today. When the best and second-best candidates fall within `ambiguousGap`, it gathers every candidate inside that near-tie score window and compares each candidate `artworkUrl` against `track.albumCoverUrl`.

The image comparison is best-effort and local to the tie branch. It fetches the images, decodes them in Playwright canvas, downsamples them, and compares compact brightness/color features. A candidate is auto-selected only when it has a clear cover-similarity margin over the next candidate; otherwise the match remains `ambiguous`.

## Testing

Unit tests cover:

- near-tied candidates auto-select the candidate with the more similar cover;
- missing source/candidate cover art leaves the result ambiguous;
- existing logged-out matcher behavior remains isolated from local user cookies.
