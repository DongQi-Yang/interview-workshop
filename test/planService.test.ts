import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { generatePlan } from "../src/services/planService.js";
import { makeTestDeps } from "./helpers.js";

const GOOD = JSON.stringify({
  focusAreas: ["音视频专业深度"],
  questions: [
    { category: "音视频", question: "讲讲 PTS/DTS", answerOutline: ["B 帧导致解码序≠显示序"] },
  ],
  studyPlan: [{ day: 1, task: "过一遍崩溃治理故事" }],
});

describe("面试方案", () => {
  it("service 返回结构化方案", async () => {
    const deps = await makeTestDeps(() => GOOD);
    const out = await generatePlan(deps.registry, {
      resumeText: "简历",
      jobDescription: "字节跳动 剪映 iOS 高级工程师",
    });
    expect(out.focusAreas).toContain("音视频专业深度");
    expect(out.questions[0].answerOutline.length).toBeGreaterThan(0);
  });

  it("路由校验缺 JD 返回 400，成功时写入 plan 记录", async () => {
    const deps = await makeTestDeps(() => GOOD);
    const app = createApp(deps);
    const bad = await request(app).post("/api/v1/interview-plan").send({ resumeText: "x" });
    expect(bad.status).toBe(400);

    const okRes = await request(app)
      .post("/api/v1/interview-plan")
      .send({ resumeText: "x", jobDescription: "y" });
    expect(okRes.status).toBe(200);
    const list = await request(app).get("/api/v1/records");
    expect(list.body.data[0].type).toBe("plan");
  });
});
