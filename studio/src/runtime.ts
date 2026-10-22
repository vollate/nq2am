import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LibSQLStore } from "@mastra/libsql";
import { getDataDir } from "../../src/dataDir.js";
import { LogImporter } from "./importer.js";

/** Keep initialization inside the referenced factory: Mastra extracts server config and drops bare side effects. */
export async function createStudioRuntime(dataDir = resolve(getDataDir())) {
  process.umask(0o077);
  const cacheDir = join(dataDir, "mastra-studio");
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  if (!(await lstat(cacheDir)).isDirectory()) throw new Error("Studio cache must be a real directory");
  await chmod(cacheDir, 0o700);
  const database = join(cacheDir, "traces.db");
  const file = await open(database, constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  await file.close();
  await chmod(database, 0o600);
  const storage = new LibSQLStore({ id: "nq2am-studio", url: pathToFileURL(database).href });
  await storage.init();
  const store = await storage.getStore("observability");
  if (!store) throw new Error("Mastra observability storage unavailable");
  const importer = new LogImporter(dataDir, store);
  const initial = await importer.sync();
  console.log(
    `nq2am Studio: imported ${initial.imported}, unchanged ${initial.unchanged}, skipped ${initial.skipped.length}.`
  );
  if (initial.skipped.length)
    console.log("Import details: /nq2am/import-status (old logs without timestamps are not plotted).");
  return { storage, importer, sourceDirectory: join(dataDir, "agent-runs") };
}
