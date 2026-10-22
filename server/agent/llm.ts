import { setTimeout as delay } from "node:timers/promises";
import type { AgentConnectionTest, AgentSettings, AgentUsage } from "../../src/agent/types.js";
import { validateBaseUrl } from "./security.js";
import { type AgentTrace, redact } from "./storage.js";

export type Message = Record<string, unknown> & { role: string };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type Transport = typeof fetch;
export class AgentError extends Error {
  constructor(
    message: string,
    readonly fatal = false
  ) {
    super(message);
  }
}
export const emptyUsage = (): AgentUsage => ({
  inputTokens: null,
  outputTokens: null,
  cachedTokens: null,
  requests: 0
});
export function addUsage(total: AgentUsage, next: AgentUsage): void {
  if (next.requests === 0) return;
  for (const key of ["inputTokens", "outputTokens", "cachedTokens"] as const) {
    total[key] =
      total.requests === 0 ? next[key] : total[key] === null || next[key] === null ? null : total[key]! + next[key]!;
  }
  total.requests += next.requests;
}
function tokens(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
}
export function responseUsage(value: any): AgentUsage {
  return {
    inputTokens: tokens(value?.prompt_tokens),
    outputTokens: tokens(value?.completion_tokens),
    cachedTokens: tokens(value?.prompt_tokens_details?.cached_tokens),
    requests: 1
  };
}

export function validateAssistant(value: unknown): Message & { tool_calls: ToolCall[] } {
  const msg = value as any;
  if (!msg || msg.role !== "assistant" || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0)
    throw new AgentError("Model did not return tool calls", true);
  if (msg.tool_calls.length > 17) throw new AgentError("Too many tool calls");
  const ids = new Set<string>();
  for (const call of msg.tool_calls) {
    if (
      !call ||
      call.type !== "function" ||
      typeof call.id !== "string" ||
      !call.id ||
      call.id.length > 200 ||
      ids.has(call.id) ||
      typeof call.function?.name !== "string" ||
      typeof call.function?.arguments !== "string"
    )
      throw new AgentError("Invalid model tool response");
    ids.add(call.id);
  }
  // Preserve provider-returned fields (e.g. reasoning_content / signatures) for subsequent turns.
  return msg;
}

/** Only expose bounded, sanitized error fields, never a provider's request/header dump. */
function providerErrorDetail(payload: unknown, apiKey?: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const body = payload as Record<string, unknown>;
  const error = body.error;
  const fields =
    error && typeof error === "object" && !Array.isArray(error) ? (error as Record<string, unknown>) : body;
  const message = typeof error === "string" ? error : fields.message;
  const parts = typeof message === "string" ? [message] : [];
  for (const key of ["code", "type", "param"] as const) {
    if (typeof fields[key] === "string") parts.push(`${key}=${fields[key]}`);
  }
  const secrets = apiKey ? [apiKey, encodeURIComponent(apiKey), Buffer.from(apiKey).toString("base64")] : [];
  return (redact(parts.join("; "), secrets) as string)
    .replace(/((?:authorization|(?:set-)?cookie)\s*:)\s*[^\r\n]*/gi, "$1 [REDACTED]")
    .replace(/\p{Cc}/gu, " ")
    .slice(0, 800);
}

const tokenParameters = new Map<string, "max_tokens" | "max_completion_tokens">();
export class ChatClient {
  requests = 0;
  usage = emptyUsage();
  constructor(
    private readonly settings: AgentSettings,
    private readonly transport: Transport = fetch,
    private readonly now = Date.now
  ) {}
  async request(
    messages: Message[],
    tools: unknown[],
    signal: AbortSignal,
    trace: AgentTrace,
    maxRequests = 8,
    maxOutputTokens = 2048
  ): Promise<Message & { tool_calls: ToolCall[] }> {
    const endpoint = `${validateBaseUrl(this.settings.baseUrl)}/chat/completions`;
    const capabilityKey = `${endpoint}\0${this.settings.model}`;
    let parameter = tokenParameters.get(capabilityKey) ?? "max_tokens";
    let parameterRetried = false;
    let transientRetried = false;
    for (;;) {
      signal.throwIfAborted();
      if (this.requests >= maxRequests) throw new AgentError("LLM request limit exceeded");
      const body = {
        model: this.settings.model,
        messages,
        tools,
        // Some compatible providers (e.g. DeepSeek thinking mode) reject "required".
        // The response validator still requires actual tool calls; prose never counts as success.
        tool_choice: "auto",
        [parameter]: maxOutputTokens
      };
      if (Buffer.byteLength(JSON.stringify(body)) > 128 * 1024) throw new AgentError("Model context exceeds 128 KiB");
      await trace({ event: "request", request: this.requests + 1, body });
      signal.throwIfAborted();
      this.requests++;
      const started = this.now();
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
      let response: Response;
      let text: string;
      try {
        response = await this.transport(endpoint, {
          method: "POST",
          redirect: "error",
          signal: requestSignal,
          headers: {
            "Content-Type": "application/json",
            ...(this.settings.apiKey ? { Authorization: `Bearer ${this.settings.apiKey}` } : {})
          },
          body: JSON.stringify(body)
        });
        // Bound malicious/misconfigured compatible-server responses before parsing/logging.
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader)
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.length;
              if (size > 1024 * 1024) {
                await reader.cancel();
                throw new AgentError("LLM response too large");
              }
              chunks.push(chunk.value);
            }
          } finally {
            reader.releaseLock();
          }
        text = Buffer.concat(chunks).toString("utf8");
      } catch (error) {
        await trace({
          event: "transport_error",
          durationMs: this.now() - started,
          error: "LLM network/timeout/redirect error"
        });
        addUsage(this.usage, emptyRequestUsage());
        signal.throwIfAborted();
        if (error instanceof AgentError) throw error;
        if (transientRetried) throw new AgentError("LLM network/timeout/redirect error");
        transientRetried = true;
        await trace({ event: "retry", reason: "network", delayMs: 500 });
        await delay(500, undefined, { signal });
        continue;
      }
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      const detailMessage = response.ok ? "" : providerErrorDetail(json, this.settings.apiKey);
      const rejection = `LLM request rejected (HTTP ${response.status})${detailMessage ? `: ${detailMessage}` : ""}`;
      // Keep useful diagnostics, but never expose arbitrary error objects or echoed request headers.
      await trace({
        event: "response",
        status: response.status,
        durationMs: this.now() - started,
        body: response.ok
          ? (json ?? { error: "Invalid JSON response" })
          : { error: rejection, status: response.status },
        usage: responseUsage(json?.usage)
      });
      addUsage(this.usage, responseUsage(json?.usage));
      signal.throwIfAborted();
      if (!response.ok) {
        const detail = JSON.stringify(json?.error ?? "");
        if (
          parameter === "max_tokens" &&
          !parameterRetried &&
          response.status === 400 &&
          /max_tokens/i.test(detail) &&
          /unsupported|not supported|not compatible|unrecognized|unknown parameter|use.*max_completion_tokens/i.test(
            detail
          )
        ) {
          parameter = "max_completion_tokens";
          parameterRetried = true;
          tokenParameters.set(capabilityKey, parameter);
          await trace({ event: "retry", reason: "max_tokens unsupported" });
          continue;
        }
        const fatal =
          [401, 403, 404].includes(response.status) ||
          /model.*(not.found|does.not.exist|invalid)|invalid.api.key|(?:tools?|function.call|tool_choice).*(?:not supported|unsupported)|(?:does not support|unsupported).*(?:tools?|function.call|tool_choice)/i.test(
            detail
          );
        if (fatal) throw new AgentError(rejection, true);
        if (!transientRetried && (response.status === 429 || response.status >= 500)) {
          transientRetried = true;
          const header = response.headers.get("retry-after");
          const seconds = header === null ? NaN : Number(header);
          const retryMs = Math.min(
            10000,
            Math.max(
              0,
              Number.isFinite(seconds)
                ? seconds * 1000
                : header && Number.isFinite(Date.parse(header))
                  ? Date.parse(header) - this.now()
                  : 500
            )
          );
          await trace({ event: "retry", reason: `HTTP ${response.status}`, delayMs: retryMs });
          await delay(retryMs, undefined, { signal });
          continue;
        }
        throw new AgentError(rejection);
      }
      if (!json) throw new AgentError("Invalid LLM JSON response");
      if (json.choices?.[0]?.finish_reason === "length") throw new AgentError("LLM output limit exceeded");
      return validateAssistant(json.choices?.[0]?.message);
    }
  }
}
function emptyRequestUsage(): AgentUsage {
  return { ...emptyUsage(), requests: 1 };
}

export async function testConnection(
  settings: AgentSettings,
  transport: Transport = fetch,
  now = Date.now
): Promise<AgentConnectionTest> {
  const started = now();
  try {
    if (!settings.model) throw new AgentError("Model is required");
    const tools = [
      {
        type: "function",
        function: {
          name: "connection_test",
          description: "Confirm tool support",
          parameters: {
            type: "object",
            properties: { ok: { type: "boolean", enum: [true] } },
            required: ["ok"],
            additionalProperties: false
          }
        }
      }
    ];
    const message = await new ChatClient(settings, transport, now).request(
      [{ role: "user", content: 'Call connection_test with {"ok":true}.' }],
      tools,
      AbortSignal.timeout(60000),
      async () => {},
      3
    );
    const call = message.tool_calls[0];
    const args = JSON.parse(call.function.arguments);
    if (
      message.tool_calls.length !== 1 ||
      call.function.name !== "connection_test" ||
      args?.ok !== true ||
      Object.keys(args).length !== 1
    )
      throw new AgentError("Invalid connection test tool call", true);
    return { supported: true, durationMs: now() - started };
  } catch (error) {
    return {
      supported: false,
      durationMs: now() - started,
      error: error instanceof AgentError ? error.message : "Connection/tool validation failed"
    };
  }
}
