import type { ZodType } from "zod";
import { ProviderError } from "./provider.js";
import type { CompletionRequest } from "./provider.js";
import type { ProviderRegistry } from "./registry.js";

function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (m ? m[1] : text).trim();
}

export async function completeJson<T>(
  registry: ProviderRegistry,
  req: CompletionRequest,
  schema: ZodType<T>,
): Promise<{ value: T; providerId: string; fallback: boolean }> {
  let lastError = "";
  let attempt = req;
  for (let i = 0; i < 2; i++) {
    const out = await registry.complete(attempt);
    try {
      const parsed: unknown = JSON.parse(stripFences(out.text));
      const value = schema.parse(parsed);
      return { value, providerId: out.providerId, fallback: out.fallback };
    } catch (err) {
      lastError = (err as Error).message;
      attempt = {
        ...req,
        user: `${req.user}\n\n上一次输出无法解析（错误：${lastError}）。请只输出符合要求的 JSON，不要任何解释文字或代码围栏。`,
      };
    }
  }
  throw new ProviderError(`模型输出无法解析为约定 JSON: ${lastError}`, true);
}
