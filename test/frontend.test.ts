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

  it("app.js 包含错误处理 UI providerError", async () => {
    const res = await request(createApp(await makeTestDeps())).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("providerError");
  });

  it("app.js 包含 HTML 转义函数 esc（防止 innerHTML 注入）", async () => {
    const res = await request(createApp(await makeTestDeps())).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("function esc(");
  });

  it("app.js 转义 severity 且按钮有请求期禁用守卫", async () => {
    const res = await request(createApp(await makeTestDeps())).get("/app.js");
    expect(res.text).toContain("esc(s.severity)");
    expect(res.text).toContain("disabled = true");
  });
});
