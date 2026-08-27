import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

describe("PUT /api/v1/settings/provider", () => {
  it("未知 id → 400 且 ok=false", async () => {
    const app = createApp(await makeTestDeps());
    const res = await request(app).put("/api/v1/settings/provider").send({ id: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("缺失 id（空 body）→ 400", async () => {
    const app = createApp(await makeTestDeps());
    const res = await request(app).put("/api/v1/settings/provider").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("合法 id → 200 且 data.active 正确", async () => {
    const app = createApp(await makeTestDeps());
    const res = await request(app).put("/api/v1/settings/provider").send({ id: "mock" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { active: "mock" } });
  });
});
