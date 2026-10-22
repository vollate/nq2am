import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSettings, AgentSettingsView } from "../../src/agent/types.js";
import { getDataDir } from "../../src/fetchers/auth.js";
import { validateBaseUrl } from "./security.js";
import { atomicJson } from "./storage.js";

export function parseSettings(value: unknown, previous: AgentSettings): AgentSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid settings");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["baseUrl", "model", "apiKey"].includes(key)))
    throw new Error("Unknown setting");
  const baseUrl = validateBaseUrl(body.baseUrl === undefined ? previous.baseUrl : body.baseUrl);
  const model = body.model === undefined ? previous.model : body.model;
  if (typeof model !== "string" || model.length > 200 || /[\r\n]/.test(model)) throw new Error("Invalid model");
  const key = body.apiKey;
  if (key !== undefined && key !== null && (typeof key !== "string" || key.length > 8192 || /[\r\n]/.test(key)))
    throw new Error("Invalid API key");
  return {
    baseUrl,
    model: model.trim(),
    apiKey: key === undefined ? previous.apiKey : typeof key === "string" && key.trim() ? key.trim() : undefined
  };
}

export function publicSettings(settings: AgentSettings): AgentSettingsView {
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasApiKey: !!settings.apiKey,
    configured: !!settings.model
  };
}

export class AgentSettingsStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly path = join(getDataDir(), "agent-settings.json")) {}
  async get(): Promise<AgentSettings> {
    try {
      return parseSettings(JSON.parse(await readFile(this.path, "utf8")), {
        baseUrl: "https://api.openai.com/v1",
        model: ""
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { baseUrl: "https://api.openai.com/v1", model: "" };
      throw new Error("Cannot read Agent settings");
    }
  }
  put(value: unknown): Promise<AgentSettingsView> {
    const next = this.chain.then(async () => {
      const settings = parseSettings(value, await this.get());
      await atomicJson(this.path, settings);
      return publicSettings(settings);
    });
    this.chain = next.catch(() => {});
    return next;
  }
}
export const agentSettings = new AgentSettingsStore();
