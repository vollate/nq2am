import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (!(major > 24 || (major === 24 && minor >= 11) || (major === 22 && minor >= 18)))
  throw new Error("Mastra Studio requires Node.js 22.18+ (22.x) or 24.11+");
process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--demo")) throw new Error("Usage: pnpm studio [--demo]");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|COOKIE/i.test(key))
);
if (args.includes("--demo")) {
  const { writeDemo } = await import("./demo.mjs");
  env.NQ2AM_DATA_DIR = await writeDemo();
  console.log(`Offline demo only; real Agent data is not opened. Data: ${env.NQ2AM_DATA_DIR}`);
}
const port = env.NQ2AM_STUDIO_PORT ?? "4111";
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Invalid NQ2AM_STUDIO_PORT");
const guard = pathToFileURL(resolve(root, "scripts/network-guard.mjs")).href;
env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import=${guard}`.trim();
env.MASTRA_TELEMETRY_DISABLED = "1";
env.MASTRA_HIDE_CLOUD_CTA = "true";
console.log(`Observation only: http://127.0.0.1:${port}/observability — no agent execution or paid calls.`);
console.log(
  "New runs are discovered automatically when Studio reads traces. Open/reload Traces; no sync command needed."
);
const child = spawn(process.execPath, [require.resolve("mastra"), "dev"], { cwd: root, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => {
  console.error("Could not start Mastra Studio.");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
