#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fetchNeteasePlaylist, fetchQqPlaylist, matchAppleMusic, normalizeNeteasePlaylist, normalizeQqPlaylist } from "./index.js";
import type { MusicProvider, NormalizedPlaylist } from "./types.js";

type CliOptions = Record<string, string | boolean>;

async function main(argv: string[]): Promise<void> {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...rest] = normalizedArgv;
  const options = parseOptions(rest);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "normalize") {
    await normalizeCommand(options);
    return;
  }

  if (command === "match-apple") {
    await matchAppleCommand(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function normalizeCommand(options: CliOptions): Promise<void> {
  const provider = readProvider(options.provider);
  const sourceUrl = readOptionalString(options.url);
  const inputPath = readOptionalString(options.input);

  if (!sourceUrl && !inputPath) {
    throw new Error("normalize requires either --input <file> or --url <playlist-url>");
  }

  if (sourceUrl && inputPath) {
    throw new Error("normalize accepts only one of --input or --url");
  }

  const payload = inputPath
    ? await readJson(inputPath)
    : await fetchProviderPlaylist(provider, sourceUrl!, await readCookie(options));
  const playlist = provider === "qq"
    ? normalizeQqPlaylist(payload, sourceUrl)
    : normalizeNeteasePlaylist(payload, sourceUrl);

  await writeJson(readOptionalString(options.output), playlist);
}

async function matchAppleCommand(options: CliOptions): Promise<void> {
  const inputPath = readRequiredString(options.input, "match-apple requires --input <normalized-json>");
  const playlist = assertNormalizedPlaylist(await readJson(inputPath));
  const report = await matchAppleMusic(playlist);
  await writeJson(readOptionalString(options.output), report);
}

async function fetchProviderPlaylist(provider: MusicProvider, url: string, cookie?: string): Promise<unknown> {
  if (provider === "qq") {
    return fetchQqPlaylist(url, { cookie });
  }

  return fetchNeteasePlaylist(url, { cookie });
}

async function readCookie(options: CliOptions): Promise<string | undefined> {
  const cookie = readOptionalString(options.cookie);
  if (!cookie) {
    return undefined;
  }

  return readFile(cookie, "utf8");
}

function readProvider(value: unknown): MusicProvider {
  if (value === "qq" || value === "netease") {
    return value;
  }

  throw new Error("Expected --provider qq or --provider netease");
}

function assertNormalizedPlaylist(value: unknown): NormalizedPlaylist {
  if (
    typeof value !== "object" ||
    value === null ||
    !("provider" in value) ||
    !("tracks" in value) ||
    !Array.isArray((value as { tracks?: unknown }).tracks)
  ) {
    throw new Error("match-apple expects normalized playlist JSON produced by the normalize command");
  }

  const provider = (value as { provider?: unknown }).provider;
  if (provider !== "qq" && provider !== "netease") {
    throw new Error("match-apple input has an unsupported provider");
  }

  return value as NormalizedPlaylist;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path: string | undefined, data: unknown): Promise<void> {
  const output = `${JSON.stringify(data, null, 2)}\n`;
  if (path) {
    await writeFile(path, output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

function readRequiredString(value: unknown, message: string): string {
  const result = readOptionalString(value);
  if (!result) {
    throw new Error(message);
  }

  return result;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    i += 1;
  }

  return options;
}

function printHelp(): void {
  process.stdout.write(`nq2am

Commands:
  normalize --provider <qq|netease> (--input <file> | --url <playlist-url>) [--cookie <file>] [--output <file>]
  match-apple --input <normalized-json> [--output <file>]
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
