import assert from "node:assert/strict";
import test from "node:test";
import { SpanType } from "@mastra/core/observability";
import { sampleTrack } from "../scripts/demo.mjs";
import { parseEvents, projectTrack, SkipTrace, type TrackSource } from "../src/project.js";

function source(status = "completed"): TrackSource {
  const track = sampleTrack(status, 1700000000000);
  return {
    runId: "10000000-0000-4000-8000-000000000001",
    index: 0,
    manifest: { model: "offline-demo", promptVersion: "fixture-v1" },
    result: track.result,
    events: track.events.map((data, i) => ({ line: i + 1, data }))
  };
}
function restamp(input: TrackSource) {
  input.events.forEach((e, i) => {
    e.line = i + 1;
    e.data.recordedAt = new Date(1700000000000 + i * 100).toISOString();
  });
}

test("groups LLM rounds, pairs tools, retains exact context/provider fields and provenance without modifying source", () => {
  const input = source();
  const before = JSON.stringify(input);
  const { spans, traceId } = projectTrack(input);
  assert.equal(JSON.stringify(input), before);
  assert.match(traceId, /^[a-f0-9]{32}$/);
  assert.deepEqual(
    spans.filter((s) => /^Round /.test(s.name)).map((s) => s.name),
    ["Round 1", "Round 2"]
  );
  const calls = spans.filter((s) => s.spanType === SpanType.MODEL_GENERATION);
  assert.equal(calls.length, 2);
  assert.deepEqual((calls[1].input as any).messages, (calls[1].metadata!.requestBody as any).messages);
  assert.equal((calls[1].output as any).reasoningText, "Synthetic reasoning for the offline demo.");
  assert.equal(
    (calls[1].metadata!.responseBody as any).choices[0].message.reasoning_content,
    "Synthetic reasoning for the offline demo."
  );
  assert.equal((calls[1].output as any).toolCalls[0].toolName, "complete_match");
  assert.equal(calls[1].metadata?.sourceLine, 6);
  const lookup = spans.find((s) => s.name === "get_track_candidates")!;
  assert.deepEqual(lookup.input, {});
  assert.equal(lookup.metadata?.resultRecorded, true);
  assert.equal(lookup.parentSpanId, calls[0].parentSpanId);
  const root = spans[0];
  assert.equal(root.error, undefined);
  assert.equal(root.metadata?.outcome, "matched");
  assert.equal(root.metadata?.rounds, 2);
  assert.equal((root.output as any).appliedResult.selectedId, "demo-song");
  assert.ok((root.output as any).evidenceLinks.every((e: any) => e.resolved && e.spanId));
  assert.equal(JSON.stringify(spans).includes("demo-private-cookie"), false);
});

test("failed validation does not turn a model proposal into an accepted result or a permanently running tool", () => {
  const { spans } = projectTrack(source("failed"));
  const root = spans[0];
  const output = root.output as any;
  assert.equal(root.metadata?.executionStatus, "failed");
  assert.equal(root.metadata?.outcome, null);
  assert.equal(output.modelProposals[0].proposal.outcome, "matched");
  assert.equal(output.appliedResult.selectedId, "previous-selection");
  const completion = spans.find((s) => s.name === "complete_match")!;
  assert.ok(completion.error);
  assert.ok(completion.endedAt);
  assert.equal(completion.metadata?.missingResult, true);
});

test("completed no_match is successful execution even when the original ambiguous selection remains", () => {
  const input = source();
  input.result.conclusion = { status: "completed", outcome: "no_match", reason: "None verified", evidence: [] };
  input.result.applied = input.result.original;
  input.events.at(-1)!.data.attempt = input.result.conclusion;
  const { spans } = projectTrack(input);
  assert.equal(spans[0].error, undefined);
  assert.equal(spans[0].metadata?.outcome, "no_match");
  assert.equal((spans[0].output as any).appliedResult.status, "ambiguous");
});

test("HTTP retries stay within the same round and retain failed attempts", () => {
  const input = source();
  const retryRequest = structuredClone(input.events[1]);
  input.events.splice(
    2,
    0,
    {
      line: 0,
      data: {
        event: "response",
        status: 429,
        body: { error: "Rate limit" },
        usage: { inputTokens: null, outputTokens: null, cachedTokens: null }
      }
    },
    { line: 0, data: { event: "retry", reason: "HTTP 429", delayMs: 500 } },
    retryRequest
  );
  restamp(input);
  const { spans } = projectTrack(input);
  const calls = spans.filter((s) => s.spanType === SpanType.MODEL_GENERATION);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].parentSpanId, calls[1].parentSpanId);
  assert.notEqual(calls[1].parentSpanId, calls[2].parentSpanId);
  assert.ok(calls[0].error);
  assert.equal(spans[0].metadata?.rounds, 2);
});

test("unknown token statistics stay absent, cached/reasoning details are not added to totals", () => {
  const input = source();
  const firstResponse = input.events.find((e) => e.data.event === "response")!;
  firstResponse.data.usage = { inputTokens: null, outputTokens: null, cachedTokens: null };
  delete firstResponse.data.body.usage;
  const calls = projectTrack(input).spans.filter((s) => s.spanType === SpanType.MODEL_GENERATION);
  assert.equal(calls[0].attributes?.usage, undefined);
  assert.match(calls[0].name, /usage unknown/);
  assert.equal(calls[0].attributes?.usageIncomplete, true);
  const unknownUsage = calls[0].metadata?.normalizedUsage as any;
  assert.equal(unknownUsage.inputTokens, null);
  const known = calls[1].attributes?.usage as any;
  assert.equal(known.outputTokens, 20);
  assert.equal(known.outputDetails.reasoning, 12);
  assert.equal(known.inputDetails.cacheRead, 40);
});

test("old, partial and malformed logs are reported instead of inventing timestamps or showing false running state", () => {
  const old = source();
  for (const e of old.events) delete e.data.recordedAt;
  assert.throws(
    () => projectTrack(old),
    (e) => e instanceof SkipTrace && e.reason === "missing_timestamps"
  );
  const partial = source();
  partial.events.pop();
  assert.throws(
    () => projectTrack(partial),
    (e) => e instanceof SkipTrace && e.reason === "incomplete"
  );
  assert.throws(() => parseEvents('{"event":"request"}\n{"event":'), SkipTrace);
  const backwards = source();
  backwards.events[2].data.recordedAt = "1970-01-01T00:00:00.000Z";
  assert.throws(() => projectTrack(backwards), SkipTrace);
});

test("a cancelled terminal event cannot present a stale matched result snapshot as accepted", () => {
  const input = source();
  input.events.push({ line: 11, data: { event: "run_stopped", attempt: { status: "cancelled" } } });
  restamp(input);
  assert.throws(
    () => projectTrack(input),
    (e) => e instanceof SkipTrace && e.reason === "inconsistent_result"
  );
});

test("late provider responses remain evidence without reopening a cancelled track", () => {
  const input = source("cancelled");
  input.events.push({ line: 11, data: { event: "response", status: 200, body: { choices: [] } } });
  restamp(input);
  const { spans } = projectTrack(input);
  assert.equal(spans[0].metadata?.executionStatus, "cancelled");
  assert.equal(spans[0].metadata?.lateEvents, 1);
  assert.ok(spans[0].error);
  assert.equal(spans.at(-1)?.name, "Late event after cancelled: response");
  assert.equal(spans.at(-1)?.parentSpanId, spans[0].spanId);
});

test("invalid arguments are inspectable without being executed; credentials are redacted again", () => {
  const input = source();
  const call = input.events.find((e) => e.data.event === "tool_request")!;
  call.data.call.function.arguments = '{"apiKey":"not-for-studio","unfinished":';
  const spans = projectTrack(input).spans;
  const tool = spans.find((s) => s.name === "get_track_candidates")!;
  assert.ok((tool.input as any).unparsedArguments);
  assert.equal(JSON.stringify(spans).includes("not-for-studio"), false);
});
