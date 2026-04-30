export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = asString(value);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

export function readPath(value: unknown, path: string[]): unknown {
  let current = value;

  for (const key of path) {
    if (!isObject(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

export function namesFromArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: string[] = [];
  for (const item of value) {
    const name = isObject(item) ? firstString(item.name, item.title, item.singername, item.artistName) : asString(item);

    if (name) {
      names.push(name);
    }
  }

  return names;
}

export function firstObjectArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

export function joinNames(names: string[]): string | undefined {
  return names.length > 0 ? names.join(", ") : undefined;
}
