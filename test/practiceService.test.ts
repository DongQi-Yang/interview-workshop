import { describe, it, expect } from "vitest";
import { buildPracticePlan, toggleTask } from "../src/services/practiceService.js";
import type { AppRecord } from "../src/services/records.js";

function planRecord(studyPlan: unknown): AppRecord {
  return { id: "rec-1", type: "plan", createdAt: "2026-08-27T00:00:00.000Z", input: {}, result: { focusAreas: [], questions: [], studyPlan } };
}

describe("buildPracticePlan", () => {
  it("从方案记录生成按 day 升序的打卡任务", () => {
    const plan = buildPracticePlan(planRecord([
      { day: 2, task: "音视频八股" },
      { day: 1, task: "开场三题" },
    ]));
    expect(plan.sourceRecordId).toBe("rec-1");
    expect(plan.tasks.map((t) => t.day)).toEqual([1, 2]);
    expect(plan.tasks[0]).toMatchObject({ task: "开场三题", done: false, completedAt: null });
  });

  it("非 plan 记录抛 ValidationError", () => {
    const rec = { ...planRecord([{ day: 1, task: "x" }]), type: "polish" as const };
    expect(() => buildPracticePlan(rec)).toThrowError(expect.objectContaining({ name: "ValidationError" }));
  });

  it("studyPlan 缺失或为空抛 ValidationError", () => {
    expect(() => buildPracticePlan(planRecord(undefined))).toThrowError(expect.objectContaining({ name: "ValidationError" }));
    expect(() => buildPracticePlan(planRecord([]))).toThrowError(expect.objectContaining({ name: "ValidationError" }));
  });
});

describe("toggleTask", () => {
  const base = buildPracticePlan(planRecord([{ day: 1, task: "a" }, { day: 2, task: "b" }]));

  it("勾选写入 completedAt，取消置 null，且不改原对象", () => {
    const done = toggleTask(base, 0, true);
    expect(done.tasks[0].done).toBe(true);
    expect(done.tasks[0].completedAt).toBeTruthy();
    expect(base.tasks[0].done).toBe(false);
    const undone = toggleTask(done, 0, false);
    expect(undone.tasks[0]).toMatchObject({ done: false, completedAt: null });
  });

  it("越界与非整数 index 抛 ValidationError", () => {
    for (const idx of [-1, 2, 1.5, Number.NaN]) {
      expect(() => toggleTask(base, idx, true)).toThrowError(expect.objectContaining({ name: "ValidationError" }));
    }
  });
});
