import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProviderError } from "./provider.js";
import type { AIProvider, Availability, CompletionRequest } from "./provider.js";

export class ClaudeProvider implements AIProvider {
  readonly id = "claude";
  readonly name = "Claude（云端）";
  private client: Anthropic;

  constructor(private model = "claude-opus-5", client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async checkAvailability(): Promise<Availability> {
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      return { available: true };
    }
    if (existsSync(join(homedir(), ".config", "anthropic"))) {
      return { available: true }; // ant auth login 的本地 profile
    }
    return {
      available: false,
      reason: "未检测到凭证：请设置 ANTHROPIC_API_KEY，或运行 ant auth login",
    };
  }

  async complete(req: CompletionRequest): Promise<string> {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        // 安全拒答时由服务端自动路由到后备模型，见 spec 技术决策
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ProviderError("Claude 凭证无效，请检查 API key", false);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ProviderError("Claude 触发限流，请稍后重试", true);
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new ProviderError("无法连接 Claude 服务（网络问题）", true);
      }
      throw new ProviderError(`Claude 调用失败: ${(err as Error).message}`, false);
    }
    if (res.stop_reason === "refusal") {
      throw new ProviderError("模型拒绝了该请求", false);
    }
    return res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
}
