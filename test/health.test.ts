import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

describe("health", () => {
  it("GET /api/v1/health 返回 up", async () => {
    const res = await request(createApp(await makeTestDeps())).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: "up" } });
  });
});
