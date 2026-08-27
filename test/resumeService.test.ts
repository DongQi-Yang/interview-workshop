import { describe, it, expect } from "vitest";
import { polishResume } from "../src/services/resumeService.js";
import { makeTestDeps } from "./helpers.js";

const GOOD = JSON.stringify({
  revised: "改写后的简历",
  suggestions: [
    { severity: "high", original: "熟悉各种技术", suggestion: "删除空泛表述", reason: "无信息量" },
  ],
});

describe("polishResume", () => {
  it("返回结构化润色结果", async () => {
    const deps = await makeTestDeps(() => GOOD);
    const out = await polishResume(deps.registry, "我的简历原文");
    expect(out.revised).toBe("改写后的简历");
    expect(out.suggestions[0].severity).toBe("high");
    expect(out.providerId).toBe("mock");
  });

  it("模型输出带 ```json 围栏也能解析", async () => {
    const deps = await makeTestDeps(() => "```json\n" + GOOD + "\n```");
    const out = await polishResume(deps.registry, "原文");
    expect(out.revised).toBe("改写后的简历");
  });

  it("首次输出非法 JSON 时自动重试一次", async () => {
    let calls = 0;
    const deps = await makeTestDeps(() => (++calls === 1 ? "不是 JSON" : GOOD));
    const out = await polishResume(deps.registry, "原文");
    expect(calls).toBe(2);
    expect(out.revised).toBe("改写后的简历");
  });

  it("两次都非法则抛 ProviderError", async () => {
    const deps = await makeTestDeps(() => "始终不是 JSON");
    await expect(polishResume(deps.registry, "原文")).rejects.toMatchObject({
      name: "ProviderError",
    });
  });
});
