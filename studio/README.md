# nq2am → Mastra Studio

Observation only: no Agent execution, framework migration, paid calls, or custom viewer UI.

From the repository root:

```sh
pnpm studio       # real local history; discovers new batches automatically
pnpm studio:demo  # synthetic offline history only
pnpm studio:sync  # optional immediate scan / diagnostic report
```

Open/reload `/traces`: completed logs appear without a sync command. Reads trigger serialized, incremental scans (at most once per second); unfinished files are retried after they change. The pinned Studio's rolling Auto refresh does not refetch the legacy LibSQL list, so page reload is the reliable update path (no upstream bundle patch or custom reader). Logs still need real `recordedAt` timestamps.

Requires Node.js 22.18+ (22.x) or 24.11+. Stop one Studio instance before starting another in this workspace.

See [usage, limitations, privacy and verification](../docs/mastra-studio.md).
