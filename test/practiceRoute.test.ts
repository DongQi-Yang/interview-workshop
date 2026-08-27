import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

const PLAN_JSON = JSON.stringify({
  focusAreas: ["音视频"],
  questions: [{ category: "基础", question: "q", answerOutline: ["a"] }],
  studyPlan: [{ day: 1, task: "开场三题" }, { day: 2, task: "八股" }],
});

async function appWithPlanRecord() {
  const deps = await makeTestDeps(() => PLAN_JSON);
  const app = createApp(deps);
  await request(app).post("/api/v1/interview-plan").send({ resumeText: "r", jobDescription: "jd" });
  return app;
}

describe("练习打卡", () => {
  it("无方案记录时生成打卡计划返回 400 中文引导", async () => {
    const app = createApp(await makeTestDeps(() => PLAN_JSON));
    const res = await request(app).post("/api/v1/practice-plan").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("面试方案");
  });

  it("从最近方案生成计划，GET 可读回", async () => {
    const app = await appWithPlanRecord();
    const res = await request(app).post("/api/v1/practice-plan").send({});
    expect(res.status).toBe(200);
    expect(res.body.data.tasks).toHaveLength(2);
    const got = await request(app).get("/api/v1/practice-plan");
    expect(got.body.data.tasks[0].task).toBe("开场三题");
  });

  it("勾选持久化且可取消；越界与非布尔 400", async () => {
    const app = await appWithPlanRecord();
    await request(app).post("/api/v1/practice-plan").send({});
    const done = await request(app).put("/api/v1/practice-plan/tasks/0").send({ done: true });
    expect(done.status).toBe(200);
    expect(done.body.data.tasks[0].done).toBe(true);
    const readBack = await request(app).get("/api/v1/practice-plan");
    expect(readBack.body.data.tasks[0].done).toBe(true);

    expect((await request(app).put("/api/v1/practice-plan/tasks/9").send({ done: true })).status).toBe(400);
    expect((await request(app).put("/api/v1/practice-plan/tasks/0").send({ done: "yes" })).status).toBe(400);

    const undone = await request(app).put("/api/v1/practice-plan/tasks/0").send({ done: false });
    expect(undone.status).toBe(200);
    expect(undone.body.data.tasks[0].done).toBe(false);
    expect(undone.body.data.tasks[0].completedAt).toBeNull();
    const readBackUndone = await request(app).get("/api/v1/practice-plan");
    expect(readBackUndone.body.data.tasks[0].done).toBe(false);
    expect(readBackUndone.body.data.tasks[0].completedAt).toBeNull();
  });

  it("无活跃计划时勾选返回 400", async () => {
    const app = createApp(await makeTestDeps(() => PLAN_JSON));
    const res = await request(app).put("/api/v1/practice-plan/tasks/0").send({ done: true });
    expect(res.status).toBe(400);
  });

  it("指定不存在的 recordId 返回 400", async () => {
    const app = await appWithPlanRecord();
    const res = await request(app).post("/api/v1/practice-plan").send({ recordId: "nope" });
    expect(res.status).toBe(400);
  });

  it("生成计划与在途勾选并发时不丢新计划（write 经串行链）", async () => {
    // 直接对同一个 practiceStore 构造交错：慢 update（模拟在途 PUT）先入链，
    // 随后 POST 生成新计划；若 POST 绕过链，慢 update 的落盘会覆盖新计划。
    const deps = await makeTestDeps(() => PLAN_JSON);
    const app = createApp(deps);
    await request(app).post("/api/v1/interview-plan").send({ resumeText: "r", jobDescription: "jd" });
    await request(app).post("/api/v1/practice-plan").send({}); // 旧计划 A
    const slowToggle = deps.practiceStore.update(async (plan) => {
      // 模拟在途 PUT：慢回调
      await new Promise((r) => setTimeout(r, 50));
      return plan; // 原样写回（相当于勾选后的旧计划）
    });
    const regen = request(app).post("/api/v1/practice-plan").send({}); // 并发重新生成 → 新计划 B
    await Promise.all([slowToggle, regen]);
    const finalPlan = (await request(app).get("/api/v1/practice-plan")).body.data;
    const regenPlan = (await regen).body.data;
    expect(finalPlan.id).toBe(regenPlan.id); // 最终落盘必须是新计划 B
  });
});
