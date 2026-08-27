import { describe, it, expect } from "vitest";
import { AppleFMProvider } from "../src/ai/appleFMProvider.js";

const FAKE = "test/fixtures/fake-bridge.sh";

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
});
