import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/ai/mockProvider.js";

describe("MockProvider", () => {
  it("同输入同输出（确定性）", async () => {
    const p = new MockProvider((req) => `echo:${req.user}`);
    expect(await p.complete({ system: "s", user: "hi" })).toBe("echo:hi");
    expect(await p.complete({ system: "s", user: "hi" })).toBe("echo:hi");
    expect((await p.checkAvailability()).available).toBe(true);
  });
});
