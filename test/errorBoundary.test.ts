import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

describe("统一错误边界：body 解析层错误应映射为对应 4xx，而非 500", () => {
  it("畸形 JSON body → 400（而非 500 SyntaxError）", async () => {
    const app = createApp(await makeTestDeps());
    const res = await request(app)
      .post("/api/v1/resume/polish")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("超 1mb payload → 413（而非 500 PayloadTooLargeError）", async () => {
    const app = createApp(await makeTestDeps());
    const res = await request(app)
      .post("/api/v1/resume/polish")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ resumeText: "x".repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.ok).toBe(false);
  });
});

describe("ProviderError → 502 端到端（路由级）", () => {
  it("provider 输出两次都不是合法 JSON → completeJson 抛 retryable ProviderError → 502", async () => {
    const deps = await makeTestDeps(() => "不是 JSON 的纯文本回复");
    const app = createApp(deps);
    const res = await request(app).post("/api/v1/resume/polish").send({ resumeText: "原文" });
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
  });
});

describe("zod 默认英文文案兜底为中文", () => {
  it("POST polish 空 body（缺字段）→ 400 且 error.message 含中文字符", async () => {
    const app = createApp(await makeTestDeps());
    const res = await request(app).post("/api/v1/resume/polish").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.message).toMatch(/[一-龥]/);
  });

  it("POST interview-plan 空 body（缺字段）→ 400 且 error.message 含中文字符", async () => {
    const app = createApp(await makeTestDeps());
    const res = await request(app).post("/api/v1/interview-plan").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.message).toMatch(/[一-龥]/);
  });
});
