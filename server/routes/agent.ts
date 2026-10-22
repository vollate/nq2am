import { Router, type Router as RouterType } from "express";
import { type Transport, testConnection } from "../agent/llm.js";
import { localAgentOnly } from "../agent/security.js";
import { AgentRequestError, type AgentService, agentService } from "../agent/service.js";
import { type AgentSettingsStore, agentSettings, parseSettings, publicSettings } from "../agent/settings.js";
import { TaskBusyError } from "../taskLocks.js";

export function createAgentRouter(
  service: AgentService = agentService,
  settings: AgentSettingsStore = agentSettings,
  transport?: Transport
): RouterType {
  const router = Router();
  router.use(["/agent", "/match-apple/:playlistId/agent"], localAgentOnly);
  router.get("/agent/settings", async (_req, res) => {
    try {
      res.json(publicSettings(await settings.get()));
    } catch {
      res.status(500).json({ error: "Cannot read Agent settings" });
    }
  });
  router.put("/agent/settings", async (req, res) => {
    try {
      res.json(await settings.put(req.body));
    } catch {
      res.status(400).json({ error: "Invalid Agent settings or settings storage unavailable" });
    }
  });
  router.post("/agent/settings/test", async (req, res) => {
    try {
      res.json(await testConnection(parseSettings(req.body ?? {}, await settings.get()), transport));
    } catch {
      res.status(400).json({ error: "Invalid Agent test configuration" });
    }
  });
  router.post("/match-apple/:playlistId/agent", async (req, res) => {
    try {
      const run = await service.start(req.params.playlistId, req.body?.indices);
      res.status(202).json({ runId: run.runId, total: run.total });
    } catch (error) {
      const status = error instanceof AgentRequestError || error instanceof TaskBusyError ? error.status : 500;
      res.status(status).json({
        error:
          error instanceof AgentRequestError || error instanceof TaskBusyError
            ? error.message
            : "Cannot start Agent; check settings and writable data/log directory"
      });
    }
  });
  router.post("/match-apple/:playlistId/agent/cancel", (req, res) => {
    try {
      service.cancel(req.params.playlistId, req.body?.runId);
      res.json({ cancelled: true });
    } catch (error) {
      res
        .status(error instanceof AgentRequestError ? error.status : 500)
        .json({ error: error instanceof AgentRequestError ? error.message : "Cannot cancel Agent" });
    }
  });
  return router;
}
export default createAgentRouter();
