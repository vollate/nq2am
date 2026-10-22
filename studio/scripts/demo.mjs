import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Synthetic fixture only. Does not import any Agent, provider, or browser module. */
export function sampleTrack(status = "completed", base = Date.now() - 30000) {
  const candidate = {
    candidateKey: "candidate-1",
    id: "demo-song",
    name: "[Demo] Studio integration",
    artistName: "Offline artist",
    storefront: "us",
    durationMs: 180000
  };
  const original = {
    track: {
      originalName: "[Demo] Studio integration",
      artists: ["Offline artist"],
      durationMs: 180000,
      source: { provider: "demo", raw: { Cookie: "demo-private-cookie" } }
    },
    status: "ambiguous",
    selectedId: "previous-selection",
    candidates: [candidate]
  };
  const complete = {
    outcome: "matched",
    candidateKey: "candidate-1",
    evidence: ["candidate-1", "lookup-1"],
    reason: "Offline fixture; no paid model was called."
  };
  const toolCall = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const lookup = toolCall("lookup-1", "get_track_candidates", {});
  const finish = toolCall("finish-1", "complete_match", complete);
  const messages = [
    { role: "system", content: "Offline fixture for validating Studio. No live agent execution." },
    { role: "user", content: JSON.stringify({ track: original.track, candidates: [candidate] }) }
  ];
  const body = (history) => ({
    model: "offline-demo",
    messages: history,
    tools: [{ type: "function", function: { name: "complete_match", parameters: { type: "object" } } }],
    tool_choice: "auto",
    max_tokens: 2048
  });
  const reply = (call) => ({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          reasoning_content: "Synthetic reasoning for the offline demo.",
          tool_calls: [call]
        }
      }
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 40 },
      completion_tokens_details: { reasoning_tokens: 12 }
    }
  });
  const usage = { inputTokens: 100, outputTokens: 20, cachedTokens: 40, requests: 1 };
  const conclusion =
    status === "completed" ? { status, ...complete } : { status, error: "Invalid Agent response or tool arguments" };
  const rows = [
    { event: "queued" },
    { event: "request", request: 1, body: body(messages) },
    { event: "response", status: 200, durationMs: 90, body: reply(lookup), usage },
    { event: "tool_request", call: lookup },
    { event: "tool_result", tool_call_id: lookup.id, result: { candidates: [candidate] }, durationMs: 80 },
    {
      event: "request",
      request: 2,
      body: body([
        ...messages,
        reply(lookup).choices[0].message,
        { role: "tool", tool_call_id: lookup.id, content: JSON.stringify({ candidates: [candidate] }) }
      ])
    },
    { event: "response", status: 200, durationMs: 90, body: reply(finish), usage },
    { event: "tool_request", call: finish },
    status === "completed"
      ? { event: "tool_result", tool_call_id: finish.id, result: complete, durationMs: 80 }
      : { event: "validation_or_execution_error", error: conclusion.error },
    {
      event: "track_complete",
      attempt: conclusion,
      usage: { inputTokens: 200, outputTokens: 40, cachedTokens: 80, requests: 2 }
    }
  ];
  return {
    events: rows.map((data, i) => ({ ...data, recordedAt: new Date(base + i * 100).toISOString() })),
    result: {
      original,
      conclusion,
      applied:
        status === "completed"
          ? { ...original, status: "matched", selectedId: candidate.id, selectionSource: "agent" }
          : original
    }
  };
}

export async function writeDemo() {
  const dir = await mkdtemp(join(tmpdir(), "nq2am-studio-demo-"));
  const runId = randomUUID();
  const runDir = join(dir, "agent-runs", runId);
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  await writeFile(
    join(runDir, "manifest.json"),
    JSON.stringify({ runId, status: "completed", model: "offline-demo", promptVersion: "demo", demo: true }),
    { mode: 0o600 }
  );
  for (const [index, status] of ["completed", "failed"].entries()) {
    const track = sampleTrack(status);
    const trackDir = join(runDir, `track-${index}`);
    await mkdir(trackDir, { mode: 0o700 });
    await writeFile(join(trackDir, "trace.jsonl"), track.events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
      mode: 0o600
    });
    await writeFile(join(trackDir, "result.json"), JSON.stringify(track.result), { mode: 0o600 });
  }
  return dir;
}
