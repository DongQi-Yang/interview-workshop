import { z } from "zod";
import { completeJson } from "../ai/json.js";
import type { ProviderRegistry } from "../ai/registry.js";

export const PolishResultSchema = z
  .object({
    revised: z.string(),
    suggestions: z.array(
      z
        .object({
          severity: z.enum(["high", "medium", "low"]),
          original: z.string(),
          suggestion: z.string(),
          reason: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type PolishResult = z.infer<typeof PolishResultSchema>;

const SYSTEM = `你是一位资深技术猎头兼技术面试官，精通中文技术简历的评审与改写。
对用户提供的简历：
1. 逐条找出问题（错别字、空泛表述、无量化数据、职责化描述、时间线矛盾、定位模糊），每条给出 severity（high=硬伤必改 / medium=显著提升 / low=锦上添花）、original（原文片段）、suggestion（具体改法）、reason（为什么）。
2. 输出改写后的完整简历文本（revised），保留用户真实经历，绝不虚构数据；不确定的量化数据用「◻︎」占位提示用户补充。
只输出 JSON：{"revised": string, "suggestions": [{"severity","original","suggestion","reason"}]}，不要任何其他文字。`;

export async function polishResume(registry: ProviderRegistry, resumeText: string) {
  const { value, providerId, fallback } = await completeJson(
    registry,
    { system: SYSTEM, user: `以下是我的简历原文：\n\n${resumeText}` },
    PolishResultSchema,
  );
  return { ...value, providerId, fallback };
}
