import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export class AgentIOError extends Error {
  constructor() {
    super("Agent log/result persistence failed; remaining work stopped.");
  }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(value, null, 2), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

/** Redact both structured credentials and credential-like text; never log HTTP headers. */
export function redact(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED]");
    return text
      .replace(/\b(Bearer|Basic)\s+[^\s"',;]+/gi, "$1 [REDACTED]")
      .replace(/\b(sk-[a-zA-Z0-9_-]+)\b/g, "[REDACTED]")
      .replace(
        /((?:api[_-]?key|authorization|cookie|password|access[_-]?token|refresh[_-]?token|client[_-]?secret|music-user-token)["']?\s*[=:]\s*["']?)[^\s,;"'}]+/gi,
        "$1[REDACTED]"
      )
      .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[REDACTED]@");
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(?:api[_-]?key|authorization|cookie|cookies|password|access[_-]?token|refresh[_-]?token|client[_-]?secret|music-user-token|raw)$/i.test(
          key
        )
          ? "[REDACTED]"
          : redact(item, secrets)
      ])
    );
  return value;
}

export type AgentTrace = (event: unknown) => Promise<void>;
export class AgentLog {
  private readonly traceChains = new Map<number, Promise<void>>();
  constructor(
    readonly dir: string,
    private readonly secrets: string[] = [],
    private readonly now: () => number = Date.now
  ) {}
  async init(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await chmod(dirname(this.dir), 0o700);
      await chmod(this.dir, 0o700);
    } catch {
      throw new AgentIOError();
    }
  }
  async json(name: string, value: unknown): Promise<void> {
    try {
      await atomicJson(join(this.dir, name), redact(value, this.secrets));
    } catch {
      throw new AgentIOError();
    }
  }
  trace(index: number): AgentTrace {
    return (event) => {
      // Additive metadata only: snapshot before yielding, so later message appends cannot change this record.
      // This is the logger's observation time, not an inferred provider/tool start time.
      const recorded =
        event && typeof event === "object" && !Array.isArray(event)
          ? { ...event, recordedAt: new Date(this.now()).toISOString() }
          : event;
      const line = `${JSON.stringify(redact(recorded, this.secrets))}\n`;
      const next = (this.traceChains.get(index) ?? Promise.resolve()).then(async () => {
        try {
          const dir = join(this.dir, `track-${index}`);
          await mkdir(dir, { recursive: true, mode: 0o700 });
          await appendFile(join(dir, "trace.jsonl"), line, { mode: 0o600 });
        } catch {
          throw new AgentIOError();
        }
      });
      this.traceChains.set(
        index,
        next.catch(() => {})
      );
      return next;
    };
  }
}
