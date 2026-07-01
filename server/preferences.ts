import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "../src/fetchers/auth.js";
import { DEFAULT_MATCH_PREFERENCES, type MatchPreferences } from "../src/types.js";

const STORE_PATH = join(getDataDir(), "preferences.json");

let cached: MatchPreferences | undefined;

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Coerce arbitrary input into a valid MatchPreferences (clamped + defaulted). */
function sanitize(input: unknown): MatchPreferences {
  const p = (input ?? {}) as Partial<MatchPreferences>;
  const d = DEFAULT_MATCH_PREFERENCES;
  const explicit =
    p.explicitPreference === "explicit" || p.explicitPreference === "clean" || p.explicitPreference === "none"
      ? p.explicitPreference
      : d.explicitPreference;
  const cjk = p.cjkDetection === "source" || p.cjkDetection === "text" ? p.cjkDetection : d.cjkDetection;
  return {
    threshold: clamp(Number(p.threshold), 0, 1, d.threshold),
    ambiguousGap: clamp(Number(p.ambiguousGap), 0, 1, d.ambiguousGap),
    preferDurationMatch: typeof p.preferDurationMatch === "boolean" ? p.preferDurationMatch : d.preferDurationMatch,
    explicitPreference: explicit,
    preferOriginalVersion:
      typeof p.preferOriginalVersion === "boolean" ? p.preferOriginalVersion : d.preferOriginalVersion,
    storefront: typeof p.storefront === "string" ? p.storefront.trim().toLowerCase() : d.storefront,
    nativeSearch: typeof p.nativeSearch === "boolean" ? p.nativeSearch : d.nativeSearch,
    cjkDetection: cjk
  };
}

export async function getPreferences(): Promise<MatchPreferences> {
  if (cached) return cached;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    cached = sanitize(JSON.parse(raw));
  } catch {
    cached = { ...DEFAULT_MATCH_PREFERENCES };
  }
  return cached;
}

export async function setPreferences(input: unknown): Promise<MatchPreferences> {
  const next = sanitize(input);
  cached = next;
  try {
    await mkdir(getDataDir(), { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(next, null, 2), "utf8");
  } catch {
    // Best-effort persistence; in-memory value remains authoritative.
  }
  return next;
}
