import type { AgentAttempt, AgentSettings, AgentUsage } from "../../src/agent/types.js";
import type { AppleApiSession } from "../../src/apple/api.js";
import type { ArtistAliasSnapshot } from "../../src/apple/artistAliasIndex.js";
import type { AppleMatchResult, MatchPreferences } from "../../src/types.js";
import { AgentError, ChatClient, emptyUsage, type Message, type Transport } from "./llm.js";
import { AGENT_TOOLS, SYSTEM_PROMPT } from "./protocol.js";
import { AgentIOError, type AgentTrace, redact } from "./storage.js";
import { type QueryCache, TrackTools } from "./tools.js";

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export type TrackExecution = {
  runId: string;
  settings: AgentSettings;
  original: AppleMatchResult;
  prefs: MatchPreferences;
  session: AppleApiSession;
  aliases: ArtistAliasSnapshot;
  accountStore: string;
  cache: QueryCache;
  signal: AbortSignal;
  trace: AgentTrace;
  transport?: Transport;
  now?: () => number;
  timeoutMs?: number;
};
export type TrackExecutionResult = { result: AppleMatchResult; usage: AgentUsage; fatal: boolean };
export async function runAgentTrack(input: TrackExecution): Promise<TrackExecutionResult> {
  const now = input.now ?? Date.now;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs ?? 180000)]);
  const client = new ChatClient(input.settings, input.transport, now);
  const attempt: AgentAttempt = { runId: input.runId, model: input.settings.model, status: "running" };
  let result = input.original;
  let fatal = false;
  try {
    const tools = new TrackTools(
      input.original,
      input.session,
      input.aliases,
      input.prefs,
      input.accountStore,
      input.cache,
      signal,
      input.trace
    );
    const t = input.original.track;
    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          track: {
            name: t.originalName,
            artists: t.artists,
            album: t.albumName,
            albumArtist: t.albumArtist,
            durationMs: t.durationMs
          },
          preferences: input.prefs,
          accountStorefront: input.accountStore,
          candidates: tools.initialCandidates(),
          candidateCount: input.original.candidates?.length ?? 0,
          evidenceReferenceFormat: "candidateKey or successful query tool_call id"
        })
      }
    ];
    const callIds = new Set<string>();
    const execute = async () => {
      for (;;) {
        const assistant = await client.request(messages, AGENT_TOOLS, signal, input.trace);
        signal.throwIfAborted();
        messages.push(assistant);
        const calls = assistant.tool_calls;
        for (const call of calls) {
          if (callIds.has(call.id)) throw new AgentError("Duplicate tool call id");
          callIds.add(call.id);
        }
        if (calls.some((call) => call.function.name === "complete_match")) {
          if (calls.length !== 1) throw new AgentError("complete_match must be the only call");
          const call = calls[0];
          const started = now();
          await input.trace({ event: "tool_request", call });
          const completion = await tools.complete(call.function.arguments);
          await input.trace({
            event: "tool_result",
            tool_call_id: call.id,
            result: completion.conclusion,
            durationMs: now() - started
          });
          signal.throwIfAborted();
          return completion;
        }
        for (const call of calls) {
          signal.throwIfAborted();
          const started = now();
          await input.trace({ event: "tool_request", call });
          const output = await tools.execute(call.function.name, call.function.arguments, call.id);
          await input.trace({
            event: "tool_result",
            tool_call_id: call.id,
            result: output,
            durationMs: now() - started
          });
          signal.throwIfAborted();
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
        }
      }
    };
    const { conclusion, selected } = await abortable(execute(), signal);
    signal.throwIfAborted();
    attempt.status = "completed";
    attempt.outcome = conclusion.outcome;
    attempt.reason = redact(conclusion.reason, [input.settings.apiKey ?? ""]) as string;
    attempt.evidence = redact(conclusion.evidence, [input.settings.apiKey ?? ""]) as string[];
    if (selected && conclusion.outcome === "matched") result = tools.applied(selected);
  } catch (error) {
    if (error instanceof AgentIOError) throw error;
    attempt.status = input.signal.aborted ? "cancelled" : "failed";
    attempt.error = signal.aborted
      ? input.signal.aborted
        ? "Agent cancelled"
        : "Track time limit exceeded"
      : error instanceof AgentError
        ? error.message
        : "Invalid Agent response or tool arguments";
    fatal = error instanceof AgentError && error.fatal;
    await input.trace({ event: "validation_or_execution_error", error: attempt.error });
  }
  attempt.completedAt = new Date(now()).toISOString();
  const usage =
    client.usage.requests === client.requests ? { ...client.usage } : { ...emptyUsage(), requests: client.requests };
  await input.trace({ event: "track_complete", attempt, usage });
  return { result: { ...result, agentAttempt: attempt }, usage, fatal };
}
