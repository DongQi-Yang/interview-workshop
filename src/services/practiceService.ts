import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../errors.js";
import type { AppRecord } from "./records.js";

const StudyPlanResultSchema = z
  .object({
    studyPlan: z
      .array(z.object({ day: z.number().int().positive(), task: z.string() }).passthrough())
      .min(1),
  })
  .passthrough();

export interface PracticeTask {
  day: number;
  task: string;
  done: boolean;
  completedAt: string | null;
}

export interface PracticePlan {
  id: string;
  createdAt: string;
  sourceRecordId: string;
  tasks: PracticeTask[];
}

export function buildPracticePlan(record: AppRecord): PracticePlan {
  if (record.type !== "plan") throw new ValidationError("该记录不是面试方案，无法生成打卡计划");
  const parsed = StudyPlanResultSchema.safeParse(record.result);
  if (!parsed.success) throw new ValidationError("该方案没有可用的冲刺计划（studyPlan）");
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    sourceRecordId: record.id,
    tasks: [...parsed.data.studyPlan]
      .sort((a, b) => a.day - b.day)
      .map((d) => ({ day: d.day, task: d.task, done: false, completedAt: null })),
  };
}

export function toggleTask(plan: PracticePlan, index: number, done: boolean): PracticePlan {
  if (!Number.isInteger(index) || index < 0 || index >= plan.tasks.length) {
    throw new ValidationError("任务不存在");
  }
  return {
    ...plan,
    tasks: plan.tasks.map((t, i) =>
      i === index ? { ...t, done, completedAt: done ? new Date().toISOString() : null } : t,
    ),
  };
}
