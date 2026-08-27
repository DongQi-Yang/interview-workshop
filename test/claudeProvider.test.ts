import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeProvider } from "../src/ai/claudeProvider.js";

function fakeClient(create: (params: unknown) => Promise<unknown>): Anthropic {
  return { beta: { messages: { create } } } as unknown as Anthropic;
}

describe("ClaudeProvider", () => {
  it("拼接 text 块作为返回值，并带上 fallbacks 参数", async () => {
    let captured: any;
    const client = fakeClient(async (params) => {
      captured = params;
      return {
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "你好" },
          { type: "text", text: "世界" },
        ],
      };
    });
    const p = new ClaudeProvider("claude-opus-5", client);
    const out = await p.complete({ system: "sys", user: "hi" });
    expect(out).toBe("你好世界");
    expect(captured.model).toBe("claude-opus-5");
    expect(captured.system).toBe("sys");
    expect(captured.fallbacks).toBe("default");
    expect(captured.betas).toContain("server-side-fallback-2026-07-01");
  });

  it("stop_reason=refusal 时抛出不可重试的 ProviderError", async () => {
    const client = fakeClient(async () => ({ stop_reason: "refusal", content: [] }));
    const p = new ClaudeProvider("claude-opus-5", client);
    await expect(p.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
      retryable: false,
    });
  });
});
