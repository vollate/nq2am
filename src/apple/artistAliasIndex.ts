import { AsyncLocalStorage } from "node:async_hooks";

export type ArtistAliasCatalogSource = {
  id: "musicbrainz" | "vocadb" | "utaitedb" | "touhoudb";
  license: string;
  attribution: string;
  url: string;
};

export type ArtistAliasCatalogFile = {
  version: 1;
  refreshedAt: string;
  /** MusicBrainz dump snapshot date (`YYYY-MM-DD`), when known. */
  dumpDate?: string;
  sources: ArtistAliasCatalogSource[];
  groups: string[][];
  sourceCounts?: Partial<Record<ArtistAliasCatalogSource["id"], number>>;
};

export type ArtistAliasSnapshot = {
  refreshedAt?: string;
  sources: readonly ArtistAliasCatalogSource[];
  /** Compact identity key → group id. Ambiguous keys are omitted. */
  groupByKey: ReadonlyMap<string, number>;
  /** Reverse lookup retains homonyms without treating them as identity evidence. */
  groupsByKey?: ReadonlyMap<string, readonly number[]>;
  namesByGroup?: ReadonlyMap<number, readonly string[]>;
};

const emptySnapshot: ArtistAliasSnapshot = { sources: [], groupByKey: new Map() };

const aliasStore = new AsyncLocalStorage<ArtistAliasSnapshot>();
let loadedSnapshot: ArtistAliasSnapshot = emptySnapshot;

export function emptyArtistAliasSnapshot(): ArtistAliasSnapshot {
  return emptySnapshot;
}

export function currentArtistAliasSnapshot(): ArtistAliasSnapshot {
  return aliasStore.getStore() ?? loadedSnapshot;
}

export function artistAliasSnapshotFromContext(): ArtistAliasSnapshot | undefined {
  return aliasStore.getStore();
}

export function setLoadedArtistAliasSnapshot(snapshot: ArtistAliasSnapshot): void {
  loadedSnapshot = snapshot;
}

export function runWithArtistAliasSnapshot<T>(snapshot: ArtistAliasSnapshot, fn: () => T): T {
  return aliasStore.run(snapshot, fn);
}

export function snapshotFromCatalogFile(file: ArtistAliasCatalogFile, includeReverse = false): ArtistAliasSnapshot {
  const groups: string[][] = [];
  for (const names of file.groups) {
    const keys = uniqueKeys(names);
    if (keys.length >= 2) groups.push(keys);
  }

  const groupsByKey = new Map<string, number[]>();
  for (const [index, keys] of groups.entries()) {
    for (const key of keys) {
      const bucket = groupsByKey.get(key);
      if (bucket) bucket.push(index);
      else groupsByKey.set(key, [index]);
    }
  }

  // Each source contributes its own group for the same artist, so one artist arrives as several
  // identical or overlapping groups. Those have to be merged: otherwise a name carried by two
  // sources looks contested and is dropped, which silently removes precisely the artists the
  // extra sources were added to cover. Sharing a single name is still treated as a homonym.
  const entities = new UnionFind(groups.length);
  const sharedNames = new Map<string, number>();
  for (const indices of groupsByKey.values()) {
    if (indices.length < 2 || indices.length > MAX_GROUPS_PER_NAME_FOR_MERGING) continue;
    for (let left = 0; left < indices.length; left += 1) {
      for (let right = left + 1; right < indices.length; right += 1) {
        const pair = `${indices[left]}:${indices[right]}`;
        const count = (sharedNames.get(pair) ?? 0) + 1;
        sharedNames.set(pair, count);
        if (count >= SAME_ENTITY_SHARED_NAMES) entities.union(indices[left], indices[right]);
      }
    }
  }

  const groupByKey = new Map<string, number>();
  for (const [key, indices] of groupsByKey) {
    const entity = entities.find(indices[0]);
    if (indices.every((index) => entities.find(index) === entity)) groupByKey.set(key, entity);
  }

  // Ordinary matching only needs identity lookups; build the larger reverse index for Agent batches.
  if (!includeReverse) return { refreshedAt: file.refreshedAt, sources: file.sources, groupByKey };

  const namesByGroup = new Map<number, string[]>();
  const reverse = new Map<string, number[]>();
  for (const [key, indices] of groupsByKey) {
    const ids = [...new Set(indices.map((index) => entities.find(index)))].sort((a, b) => a - b);
    reverse.set(key, ids);
    for (const id of ids) {
      const names = namesByGroup.get(id) ?? [];
      names.push(key);
      namesByGroup.set(id, names);
    }
  }
  for (const names of namesByGroup.values()) names.sort();
  return {
    refreshedAt: file.refreshedAt,
    sources: file.sources,
    groupByKey,
    groupsByKey: reverse,
    namesByGroup
  };
}

export function catalogNamesAreAliases(leftKey: string, rightKey: string, snapshot: ArtistAliasSnapshot): boolean {
  if (!leftKey || !rightKey || leftKey === rightKey) return false;
  const leftGroup = snapshot.groupByKey.get(leftKey);
  return leftGroup !== undefined && leftGroup === snapshot.groupByKey.get(rightKey);
}

/** Groups sharing at least this many names describe one entity rather than a homonym. */
const SAME_ENTITY_SHARED_NAMES = 2;
/** A name spread over more groups than this is too common to be evidence of a shared entity. */
const MAX_GROUPS_PER_NAME_FOR_MERGING = 12;

class UnionFind {
  private readonly parent: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let index = 0; index < size; index += 1) this.parent[index] = index;
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];
    let walk = index;
    while (this.parent[walk] !== root) {
      const next = this.parent[walk];
      this.parent[walk] = root;
      walk = next;
    }
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    this.parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  }
}

function uniqueKeys(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const name of names) {
    const key = name.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}
