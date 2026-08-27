import { z } from "zod";
import { completeJson } from "../ai/json.js";
import type { ProviderRegistry } from "../ai/registry.js";

export const InterviewPlanSchema = z
  .object({
    focusAreas: z.array(z.string()),
    questions: z.array(
      z
        .object({
          category: z.string(),
          question: z.string(),
          answerOutline: z.array(z.string()),
        })
        .passthrough(),
    ),
    studyPlan: z.array(
      z.object({ day: z.number().int().positive(), task: z.string() }).passthrough(),
    ),
  })
  .passthrough();

export type InterviewPlan = z.infer<typeof InterviewPlanSchema>;

const SYSTEM = `你是一位资深面试教练。根据候选人简历与目标岗位 JD：
1. focusAreas：列出 3–6 个备战重点（结合 JD 要求与简历强弱项）。
2. questions：预测 8–15 道最可能被问的面试题，按 category 分类（如 简历深挖/专业领域/语言基础/系统设计/行为面），每题给 answerOutline（3–6 条答题要点，基于候选人简历中的真实经历组织）。
3. studyPlan：给出按天的冲刺计划（day 从 1 开始的整数）。
只输出 JSON：{"focusAreas": string[], "questions": [{"category","question","answerOutline": string[]}], "studyPlan": [{"day": number, "task": string}]}，不要任何其他文字。`;

export async function generatePlan(
  registry: ProviderRegistry,
  input: { resumeText: string; jobDescription: string },
) {
  const user = `【目标岗位 JD】\n${input.jobDescription}\n\n【候选人简历】\n${input.resumeText}`;
  const { value, providerId, fallback } = await completeJson(
    registry,
    { system: SYSTEM, user, maxTokens: 16000 },
    InterviewPlanSchema,
  );
  return { ...value, providerId, fallback };
}
