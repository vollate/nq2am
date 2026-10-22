import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { MastraStorageExporter, Observability } from "@mastra/observability";
import { AUTO_REFRESH_MIN_INTERVAL_MS } from "../importer.js";
import { createStudioRuntime } from "../runtime.js";
import { localStudioGuard, studioPort } from "../security.js";

// Never loads Agent settings, browser cookies, or executable tools.
const runtime = await createStudioRuntime();
const port = studioPort();
const guard = localStudioGuard(port, () => runtime.importer.refresh());

export const mastra = new Mastra({
  // Intentionally no Agent / tool / workflow registration: this is observation only.
  storage: runtime.storage,
  loggerOptions: { export: false },
  observability: new Observability({
    configs: { local: { serviceName: "nq2am-studio", exporters: [new MastraStorageExporter()] } }
  }),
  server: {
    host: "127.0.0.1",
    port,
    cors: false,
    middleware: [{ path: "/*", handler: guard }],
    apiRoutes: [
      // Mastra reserves /api for built-ins. The outer server guard validates the real socket before dispatch.
      registerApiRoute("/nq2am/import-status", {
        method: "GET",
        handler: async (c) =>
          c.json({
            ...runtime.importer.report,
            sourceDirectory: runtime.sourceDirectory,
            autoDiscovery: { trigger: "trace-read", minimumIntervalMs: AUTO_REFRESH_MIN_INTERVAL_MS }
          })
      }),
      registerApiRoute("/nq2am/sync", { method: "POST", handler: async (c) => c.json(await runtime.importer.sync()) })
    ]
  }
});
