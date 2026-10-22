const port = process.env.NQ2AM_STUDIO_PORT ?? "4111";
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Invalid NQ2AM_STUDIO_PORT");
try {
  const response = await fetch(`http://127.0.0.1:${port}/nq2am/sync`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const report = await response.json();
  console.log(
    `Imported: ${report.imported}; unchanged: ${report.unchanged}; skipped: ${report.skipped.length}. Refresh Studio to see the updated history.`
  );
  if (report.skipped.length) console.log(JSON.stringify(report.skipped, null, 2));
} catch (error) {
  console.error(
    `Studio sync failed (${error instanceof Error ? error.message : "unknown error"}). Start pnpm studio first.`
  );
  process.exitCode = 1;
}
