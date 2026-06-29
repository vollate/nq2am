import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import appleRouter from "./routes/apple.js";
import authRouter from "./routes/auth.js";
import matchRouter from "./routes/match.js";
import playlistsRouter from "./routes/playlists.js";
import preferencesRouter from "./routes/preferences.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startServer(port: number): Promise<void> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use("/api/auth", authRouter);
  app.use("/api/apple", appleRouter);
  app.use("/api", playlistsRouter);
  app.use("/api", matchRouter);
  app.use("/api", preferencesRouter);

  // Serve static SPA in production
  const webDist = join(__dirname, "..", "..", "web", "dist");
  app.use(express.static(webDist));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(join(webDist, "index.html"));
  });

  app.listen(port, async () => {
    process.stdout.write(`nq2am server running at http://localhost:${port}\n`);
    const { default: open } = await import("open");
    await open(`http://localhost:${port}`);
  });
}

// Auto-start when run directly
const DEFAULT_PORT = Number(process.env.PORT) || 3001;
startServer(DEFAULT_PORT);
