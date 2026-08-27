import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

describe("前端静态页", () => {
  it("GET /index.html 返回含三个功能入口的页面", async () => {
    const res = await request(createApp(await makeTestDeps())).get("/index.html");
    expect(res.status).toBe(200);
    expect(res.text).toContain("简历润色");
    expect(res.text).toContain("面试方案");
    expect(res.text).toContain("历史记录");
  });
});
