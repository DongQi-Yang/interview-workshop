import express from "express";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static("public"));
  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true, data: { status: "up" } });
  });
  return app;
}
