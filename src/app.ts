import express from "express";
import type { ProviderRegistry } from "./ai/registry.js";
import { ProviderError } from "./ai/provider.js";

export interface AppDeps {
  registry: ProviderRegistry;
  dataDir: string;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static("public"));

  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true, data: { status: "up" } });
  });

  app.get("/api/v1/settings/providers", async (_req, res, next) => {
    try {
      const active = await deps.registry.getActive();
      const providers = await Promise.all(
        deps.registry.list().map(async (p) => {
          const a = await p.checkAvailability();
          return { id: p.id, name: p.name, available: a.available, reason: a.reason };
        }),
      );
      res.json({ ok: true, data: { active: active.id, providers } });
    } catch (err) {
      next(err);
    }
  });

  app.put("/api/v1/settings/provider", async (req, res, next) => {
    try {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      await deps.registry.setActive(id);
      res.json({ ok: true, data: { active: id } });
    } catch (err) {
      next(err);
    }
  });

  // 统一错误边界：业务错 4xx，其余 500，进程永不因单个请求崩溃（铁律 3/5）
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof ProviderError ? 502 : err.name === "ValidationError" ? 400 : 500;
    // 不吞栈：完整堆栈只落服务端日志（可观测边界），响应体只回传 code/message，避免向客户端泄漏内部细节
    console.error(`[error] status=${status} ${err.name}: ${err.message}`, err.stack);
    res.status(status).json({ ok: false, error: { code: err.name, message: err.message } });
  });

  return app;
}
