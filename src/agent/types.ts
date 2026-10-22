/** Shared, JSON-only Agent API contracts. Credentials never appear in task state. */
export type AgentSettings = { baseUrl: string; model: string; apiKey?: string };
export type AgentSettingsView = { baseUrl: string; model: string; hasApiKey: boolean; configured: boolean };
export type AgentSettingsUpdate = { baseUrl?: string; model?: string; apiKey?: string | null };
export type AgentOutcome = "matched" | "no_match" | "uncertain";
export type AgentAttempt = {
  runId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  outcome?: AgentOutcome;
  reason?: string;
  evidence?: string[];
  model: string;
  completedAt?: string;
  error?: string;
};
export type AgentUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  requests: number;
};
export type AgentRun = {
  runId: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  indices: number[];
  total: number;
  processed: number;
  currentIndex?: number;
  matched: number;
  noMatch: number;
  uncertain: number;
  failed: number;
  model: string;
  logDir: string;
  promptVersion: string;
  prefixHash: string;
  prefixBytes: number;
  usage: AgentUsage;
  error?: string;
};
export type AgentConclusion = { outcome: AgentOutcome; candidateKey?: string; reason: string; evidence: string[] };
export type AgentAliasResult = {
  available: boolean;
  version: string | null;
  results: Array<{
    name: string;
    status: "found" | "ambiguous" | "not_found" | "unavailable";
    groups: Array<{ aliases: string[]; truncated: boolean }>;
    truncated: boolean;
  }>;
};
export type AgentCandidateView = {
  candidateKey: string;
  name: string;
  artistName: string;
  albumName?: string;
  durationMs?: number;
  isrc?: string;
  storefront?: string;
};
export type AgentCandidatePage = { candidates: AgentCandidateView[]; total: number; offset: number };
export type AgentToolResult = AgentAliasResult | AgentCandidatePage | AgentConclusion;
export type AgentConnectionTest = { supported: boolean; durationMs: number; error?: string };
