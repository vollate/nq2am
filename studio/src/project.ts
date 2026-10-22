import { createHash } from "node:crypto";
import { SpanType } from "@mastra/core/observability";
import type { CreateSpanRecord } from "@mastra/core/storage";
import { redact } from "../../server/agent/storage.js";

type ObjectValue = Record<string, any>;
export type SourceEvent = { line: number; data: ObjectValue };
export type TrackSource = {
  runId: string;
  index: number;
  manifest: ObjectValue;
  result: ObjectValue;
  events: SourceEvent[];
};
export type SkipReason = "missing_timestamps" | "incomplete" | "invalid_log" | "inconsistent_result";
export class SkipTrace extends Error {
  constructor(readonly reason: SkipReason) {
    super(reason);
  }
}
const terminalEvents = new Set(["track_complete", "run_stopped", "interrupted"]);
const terminalStatuses = new Set(["completed", "failed", "cancelled", "interrupted"]);
export const object = (v: unknown): ObjectValue =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as ObjectValue) : {};
/** Keep the manifest dependency explicit so batch progress updates do not re-index every finished track. */
export function projectedManifest(value: unknown) {
  const manifest = object(value);
  return {
    model: manifest.model ?? null,
    promptVersion: manifest.promptVersion ?? null,
    prefixHash: manifest.prefixHash ?? null
  };
}
const digest = (s: string, size: number) => createHash("sha256").update(s).digest("hex").slice(0, size);
export const traceIdFor = (runId: string, index: number) => digest(`nq2am-studio-v1:${runId}:${index}`, 32);
const count = (v: unknown): number | undefined =>
  Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : undefined;
const parseArguments = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { unparsedArguments: value };
  }
};

export function parseEvents(text: string): SourceEvent[] {
  const events: SourceEvent[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    let data: ObjectValue;
    try {
      data = object(JSON.parse(line));
    } catch {
      throw new SkipTrace("invalid_log");
    }
    if (typeof data.event !== "string") throw new SkipTrace("invalid_log");
    events.push({ line: i + 1, data });
  }
  return events;
}

/** No time reconstruction: old logs remain untouched and are reported instead of plotted with fake dates. */
export function projectTrack(source: TrackSource): { traceId: string; spans: CreateSpanRecord[] } {
  const { runId, index } = source;
  const events = redact(source.events) as SourceEvent[];
  const result = object(redact(source.result));
  const manifest = object(redact(projectedManifest(source.manifest)));
  const terminal = events.findLast((e) => terminalEvents.has(e.data.event));
  const conclusion = object(result.conclusion);
  if (!terminal || !terminalStatuses.has(conclusion.status)) throw new SkipTrace("incomplete");
  const terminalAttempt = object(terminal.data.attempt);
  if (terminalAttempt.status !== conclusion.status || terminalAttempt.outcome !== conclusion.outcome)
    throw new SkipTrace("inconsistent_result");
  // A source may still receive a late response after cancellation. Keep it visible, never re-open the run.
  let lastTime = -Infinity;
  for (const { data } of events) {
    if (typeof data.recordedAt !== "string") throw new SkipTrace("missing_timestamps");
    const time = Date.parse(data.recordedAt);
    if (!Number.isFinite(time) || time < lastTime) throw new SkipTrace("invalid_log");
    lastTime = time;
  }
  const traceId = traceIdFor(runId, index);
  const spans: CreateSpanRecord[] = [];
  const date = (e: SourceEvent) => new Date(e.data.recordedAt);
  const rootStart = events.find((e) => e.data.event === "request") ?? events[0];
  const rootEnd = date(terminal);
  const song = object(result.original?.track);
  const status = String(conclusion.status);
  const outcome = typeof conclusion.outcome === "string" ? conclusion.outcome : null;
  const statusLabel = status === "completed" ? (outcome ?? status) : status;
  const file = `agent-runs/${runId}/track-${index}/trace.jsonl`;
  const create = (key: string, name: string, type: SpanType, e: SourceEvent, parent?: CreateSpanRecord) => {
    const span: CreateSpanRecord = {
      traceId,
      spanId: digest(`${traceId}:${key}`, 16),
      parentSpanId: parent?.spanId ?? null,
      name,
      spanType: type,
      startedAt: date(e),
      endedAt: date(e),
      isEvent: false,
      serviceName: "nq2am",
      environment: "local",
      sessionId: runId,
      metadata: {
        sourceFile: file,
        sourceLine: e.line,
        runId,
        trackIndex: index,
        timingBasis: "logger_recordedAt; durations may include logging overhead"
      }
    };
    spans.push(span);
    return span;
  };
  const root = create("root", `${song.originalName ?? `Track ${index}`} · ${statusLabel}`, SpanType.GENERIC, rootStart);
  root.endedAt = rootEnd;
  root.input = result.original;
  root.output = { validatedConclusion: conclusion, appliedResult: result.applied ?? null };
  root.metadata = {
    ...root.metadata,
    executionStatus: status,
    outcome,
    model: manifest.model ?? null,
    promptVersion: manifest.promptVersion ?? null,
    prefixHash: manifest.prefixHash ?? null,
    normalizedUsage: terminal.data.usage ?? null,
    applicationNote: "Model proposals are not accepted outcomes. Applied result is the persisted result.json snapshot.",
    lateEvents: events.filter((e) => e.line > terminal.line).length
  };
  if (status !== "completed") root.error = { message: conclusion.error ?? status, category: status };

  let round: CreateSpanRecord | undefined;
  let request: CreateSpanRecord | undefined;
  let roundNumber = 0;
  let retryNext = false;
  let activeTool: CreateSpanRecord | undefined;
  const tools = new Map<string, CreateSpanRecord>();
  const proposals: unknown[] = [];
  const evidence: Record<string, { spanId: string; candidate?: unknown }> = {};
  const recordCandidates = (v: unknown, span: CreateSpanRecord, depth = 0): void => {
    if (depth > 16 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const entry of v) recordCandidates(entry, span, depth + 1);
      return;
    }
    const value = object(v);
    if (typeof value.candidateKey === "string")
      evidence[value.candidateKey] = { spanId: span.spanId, candidate: value };
    for (const child of Object.values(value)) recordCandidates(child, span, depth + 1);
  };
  const close = (span: CreateSpanRecord, e: SourceEvent) => {
    span.endedAt = date(e);
    span.metadata = { ...span.metadata, endSourceLine: e.line };
  };
  const point = (e: SourceEvent, name: string, parent: CreateSpanRecord) => {
    const span = create(`event-${e.line}`, name, SpanType.GENERIC, e, parent);
    span.isEvent = true;
    span.output = e.data;
    return span;
  };
  for (const e of events) {
    const data = e.data;
    if (e.line > terminal.line) {
      point(e, `Late event after ${status}: ${data.event}`, root);
      continue;
    }
    switch (data.event) {
      case "queued":
        break;
      case "request": {
        if (!round || !retryNext) {
          round = create(`round-${++roundNumber}`, `Round ${roundNumber}`, SpanType.GENERIC, e, root);
        }
        retryNext = false;
        const body = object(data.body);
        request = create(
          `http-${e.line}`,
          `HTTP ${data.request ?? "?"} · ${body.model ?? "LLM"}`,
          SpanType.MODEL_GENERATION,
          e,
          round
        );
        request.input = { messages: body.messages ?? [] };
        request.attributes = {
          model: body.model,
          streaming: false,
          tools: Array.isArray(body.tools) ? body.tools.map((t: any) => ({ type: t.type, ...object(t.function) })) : []
        };
        request.metadata = { ...request.metadata, requestNumber: data.request, requestBody: body };
        for (const message of Array.isArray(body.messages) ? body.messages : []) {
          if (message.role === "user") recordCandidates(parseArguments(message.content), request);
        }
        break;
      }
      case "response":
      case "transport_error": {
        if (!request || request.metadata?.responseRecorded) throw new SkipTrace("invalid_log");
        close(request, e);
        const body = object(data.body);
        const choice = object(body.choices?.[0]);
        const usage = object(data.usage);
        const providerUsage = object(body.usage);
        const cached = count(usage.cachedTokens) ?? count(providerUsage.prompt_cache_hit_tokens);
        const reasoning = count(providerUsage.completion_tokens_details?.reasoning_tokens);
        const inputTokens = count(usage.inputTokens);
        const outputTokens = count(usage.outputTokens);
        const message = object(choice.message);
        // Match Studio's presentation contract, without changing the wire request/response in metadata.
        request.output = choice.message
          ? {
              ...(typeof message.content === "string" ? { text: message.content } : {}),
              ...(typeof message.reasoning_content === "string" ? { reasoningText: message.reasoning_content } : {}),
              ...(Array.isArray(message.tool_calls)
                ? {
                    toolCalls: message.tool_calls.map((call: any) => ({
                      toolCallId: call.id,
                      toolName: call.function?.name,
                      input: parseArguments(call.function?.arguments)
                    }))
                  }
                : {})
            }
          : { object: body };
        const usageComplete = inputTokens !== undefined && outputTokens !== undefined;
        if (!usageComplete) request.name += " · usage unknown";
        request.attributes = {
          ...request.attributes,
          finishReason: choice.finish_reason,
          // Studio defaults missing primary counters to zero. Hide its aggregate widget unless both are known.
          ...(usageComplete
            ? {
                usage: {
                  inputTokens,
                  outputTokens,
                  ...(cached !== undefined ? { inputDetails: { cacheRead: cached } } : {}),
                  ...(reasoning !== undefined ? { outputDetails: { reasoning } } : {})
                }
              }
            : {}),
          usageIncomplete: !usageComplete
        };
        request.metadata = {
          ...request.metadata,
          responseRecorded: true,
          httpStatus: data.status ?? null,
          recordedDurationMs: count(data.durationMs) ?? null,
          normalizedUsage: data.usage ?? null,
          providerUsage: body.usage ?? null,
          responseBody: data.body ?? null,
          usageNote: "Missing usage is unknown; reasoning is included in output tokens, not added again."
        };
        if (
          data.event === "transport_error" ||
          (typeof data.status === "number" && data.status >= 400) ||
          choice.finish_reason === "length"
        )
          request.error = { message: data.error ?? body.error ?? "LLM output limit exceeded" };
        for (const call of Array.isArray(choice.message?.tool_calls) ? choice.message.tool_calls : []) {
          if (call.function?.name === "complete_match")
            proposals.push({
              toolCallId: call.id,
              proposal: parseArguments(call.function.arguments),
              sourceLine: e.line
            });
        }
        break;
      }
      case "retry":
        retryNext = true;
        point(e, `Retry · ${data.reason ?? "unknown"}`, round ?? root);
        break;
      case "tool_request": {
        const call = object(data.call);
        if (typeof call.id !== "string" || tools.has(call.id)) throw new SkipTrace("invalid_log");
        activeTool = create(
          `tool-${e.line}`,
          String(call.function?.name ?? "Tool"),
          SpanType.TOOL_CALL,
          e,
          round ?? root
        );
        activeTool.input = parseArguments(call.function?.arguments);
        activeTool.attributes = { toolId: call.function?.name, toolType: "function" };
        activeTool.metadata = { ...activeTool.metadata, toolCallId: call.id, requestRecord: data };
        tools.set(call.id, activeTool);
        break;
      }
      case "tool_result": {
        const tool = tools.get(data.tool_call_id);
        if (!tool || tool.metadata?.resultRecorded) throw new SkipTrace("invalid_log");
        close(tool, e);
        tool.output = data.result;
        tool.metadata = { ...tool.metadata, resultRecorded: true, recordedDurationMs: count(data.durationMs) ?? null };
        evidence[data.tool_call_id] = { spanId: tool.spanId };
        recordCandidates(data.result, tool);
        activeTool = undefined;
        break;
      }
      case "validation_or_execution_error": {
        const failed = point(e, "Validation / execution error", activeTool ?? round ?? root);
        failed.error = { message: data.error ?? "Unknown error" };
        if (activeTool) {
          close(activeTool, e);
          activeTool.error = failed.error;
        }
        break;
      }
      default:
        point(e, data.event, activeTool ?? round ?? root);
    }
    if (round) close(round, e);
  }
  for (const tool of tools.values()) {
    if (!tool.metadata?.resultRecorded) {
      if (!tool.error) tool.error = { message: `No result recorded; execution ${status}. Tool outcome unknown.` };
      close(tool, terminal);
      tool.metadata = { ...tool.metadata, missingResult: true };
    }
  }
  if (request && !request.metadata?.responseRecorded) {
    close(request, terminal);
    request.error = { message: `No response recorded; execution ${status}.` };
  }
  root.output = {
    ...object(root.output),
    modelProposals: proposals,
    evidenceLinks: (Array.isArray(conclusion.evidence) ? conclusion.evidence : []).map((reference: string) => ({
      reference,
      ...evidence[reference],
      resolved: Boolean(evidence[reference])
    }))
  };
  root.metadata = { ...root.metadata, rounds: roundNumber, eventCount: events.length };
  return { traceId, spans };
}
