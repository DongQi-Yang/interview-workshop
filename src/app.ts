import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ProviderRegistry } from "./ai/registry.js";
import { ProviderError } from "./ai/provider.js";
import type { Store } from "./store/jsonStore.js";
import type { AppRecord } from "./services/records.js";
import { polishResume } from "./services/resumeService.js";
import { generatePlan } from "./services/planService.js";
import { ValidationError } from "./errors.js";

export interface AppDeps {
  registry: ProviderRegistry;
  dataDir: string;
  recordsStore: Store<AppRecord[]>;
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
      if (!id) {
        throw new ValidationError("id 不能为空");
      }
      if (!deps.registry.list().some((p) => p.id === id)) {
        throw new ValidationError(`未知的 Provider: ${id}`);
      }
      // 校验通过后 setActive 理论上不会再抛 ProviderError（纵深防御，registry 契约不变）
      await deps.registry.setActive(id);
      res.json({ ok: true, data: { active: id } });
    } catch (err) {
      next(err);
    }
  });

  // zod 默认英文文案（如字段缺失时的 "Invalid input: expected …"）兜底为中文，保证接口对客户端始终返回中文 message
  function zhMessage(message: string): string {
    return /^[\x00-\x7F]*$/.test(message) ? "请求参数不合法" : message;
  }

  const PolishBody = z.object({
    resumeText: z.string().min(1, "简历不能为空").max(50_000, "简历过长"),
  });

  app.post("/api/v1/resume/polish", async (req, res, next) => {
    try {
      const parsed = PolishBody.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(zhMessage(parsed.error.issues[0].message));
      }
      const result = await polishResume(deps.registry, parsed.data.resumeText);
      await deps.recordsStore.update((records) => {
        records.unshift({
          id: randomUUID(),
          type: "polish",
          createdAt: new Date().toISOString(),
          input: { resumeText: parsed.data.resumeText },
          result,
        });
        return records;
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  const PlanBody = z.object({
    resumeText: z.string().min(1, "简历不能为空").max(50_000, "简历过长"),
    jobDescription: z.string().min(1, "JD 不能为空").max(50_000, "JD 过长"),
  });

  app.post("/api/v1/interview-plan", async (req, res, next) => {
    try {
      const parsed = PlanBody.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(zhMessage(parsed.error.issues[0].message));
      }
      const result = await generatePlan(deps.registry, parsed.data);
      await deps.recordsStore.update((records) => {
        records.unshift({
          id: randomUUID(),
          type: "plan",
          createdAt: new Date().toISOString(),
          input: parsed.data,
          result,
        });
        return records;
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/v1/records", async (_req, res, next) => {
    try {
      res.json({ ok: true, data: await deps.recordsStore.read() });
    } catch (err) {
      next(err);
    }
  });

  // 统一错误边界：业务错 4xx，其余 500，进程永不因单个请求崩溃（铁律 3/5）
  // body-parser 等中间件层的错误（畸形 JSON / 超限 payload）自带数字 err.status（400~499），需原样透传，
  // 否则一律折叠成 500 会掩盖客户端问题的真实性质。
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const anyErr = err as { status?: unknown };
    const clientStatus =
      typeof anyErr.status === "number" && anyErr.status >= 400 && anyErr.status < 500
        ? anyErr.status
        : undefined;
    const status = err instanceof ProviderError ? 502 : err.name === "ValidationError" ? 400 : clientStatus ?? 500;
    // 不吞栈：完整堆栈只落服务端日志（可观测边界），响应体只回传 code/message，避免向客户端泄漏内部细节
    console.error(`[error] status=${status} ${err.name}: ${err.message}`, err.stack);
    res.status(status).json({ ok: false, error: { code: err.name, message: err.message } });
  });

  return app;
}
