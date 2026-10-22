import { homedir, platform } from "node:os";
import { join } from "node:path";

/** Shared by the app and the read-only Studio process; never opens browser/auth state. */
export function getDataDir(): string {
  if (process.env.NQ2AM_DATA_DIR) return process.env.NQ2AM_DATA_DIR;
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "nq2am");
  if (platform() === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "nq2am");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "nq2am");
}
