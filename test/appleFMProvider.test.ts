import { describe, it, expect } from "vitest";
import { AppleFMProvider } from "../src/ai/appleFMProvider.js";

const FAKE = "test/fixtures/fake-bridge.sh";
const EXIT_FAST = "test/fixtures/exit-fast.sh";

describe("AppleFMProvider", () => {
  it("经桥进程返回 stdout 文本", async () => {
    const p = new AppleFMProvider(FAKE);
    expect(await p.complete({ system: "s", user: "u" })).toBe("端侧回答");
  });

  it("桥不存在时 checkAvailability 返回不可用及原因", async () => {
    const p = new AppleFMProvider("bridge/bin/does-not-exist");
    const a = await p.checkAvailability();
    expect(a.available).toBe(false);
    expect(a.reason).toBeTruthy();
  });

  it("桥执行失败时抛可重试 ProviderError", async () => {
    const p = new AppleFMProvider("bridge/bin/does-not-exist");
    await expect(p.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
    });
  });

  it("桥进程在读取 stdin 前提前退出（大 payload 触发 EPIPE）时，reject 为可重试 ProviderError 而不是使进程崩溃", async () => {
    const p = new AppleFMProvider(EXIT_FAST);
    const bigPayload = "x".repeat(5 * 1024 * 1024);
    await expect(
      p.complete({ system: "s", user: bigPayload }),
    ).rejects.toMatchObject({ name: "ProviderError", retryable: true });
  });

  it("桥超时被击杀时错误信息注明超时", async () => {
    const p = new AppleFMProvider("test/fixtures/slow-bridge.sh", { completeTimeoutMs: 200 });
    await expect(p.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
      message: expect.stringContaining("超时"),
    });
  }, 10_000);
});
