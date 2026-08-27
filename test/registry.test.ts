import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderRegistry } from "../src/ai/registry.js";
import { createJsonStore } from "../src/store/jsonStore.js";
import { defaultConfig } from "../src/config.js";
import { ProviderError } from "../src/ai/provider.js";
import type { AIProvider } from "../src/ai/provider.js";

function stub(id: string, opts: { available?: boolean; fail?: boolean; text?: string }): AIProvider {
  return {
    id,
    name: id,
    async checkAvailability() {
      return { available: opts.available ?? true, reason: "stub" };
    },
    async complete() {
      if (opts.fail) throw new ProviderError(`${id} 失败`, true);
      return opts.text ?? `${id} 的回答`;
    },
  };
}

async function makeRegistry(providers: AIProvider[]) {
  const dir = await mkdtemp(join(tmpdir(), "reg-"));
  const store = createJsonStore(join(dir, "config.json"), defaultConfig());
  return new ProviderRegistry(providers, store);
}

describe("ProviderRegistry", () => {
  it("使用活跃 Provider，成功时 fallback=false", async () => {
    const reg = await makeRegistry([stub("claude", {}), stub("apple", {})]);
    const out = await reg.complete({ system: "s", user: "u" });
    expect(out).toEqual({ text: "claude 的回答", providerId: "claude", fallback: false });
  });

  it("活跃 Provider 不可用时降级到另一个并标记 fallback", async () => {
    const reg = await makeRegistry([stub("claude", { available: false }), stub("apple", {})]);
    const out = await reg.complete({ system: "s", user: "u" });
    expect(out.providerId).toBe("apple");
    expect(out.fallback).toBe(true);
  });

  it("活跃 Provider 调用失败时同样降级", async () => {
    const reg = await makeRegistry([stub("claude", { fail: true }), stub("apple", {})]);
    const out = await reg.complete({ system: "s", user: "u" });
    expect(out.providerId).toBe("apple");
  });

  it("全部不可用时抛 ProviderError", async () => {
    const reg = await makeRegistry([
      stub("claude", { available: false }),
      stub("apple", { available: false }),
    ]);
    await expect(reg.complete({ system: "s", user: "u" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("setActive 持久化且拒绝未知 id", async () => {
    const reg = await makeRegistry([stub("claude", {}), stub("apple", {})]);
    await reg.setActive("apple");
    expect((await reg.getActive()).id).toBe("apple");
    await expect(reg.setActive("nope")).rejects.toBeInstanceOf(ProviderError);
  });

  it("mock Provider 不参与自动降级", async () => {
    const reg = await makeRegistry([stub("claude", { available: false }), stub("mock", {})]);
    await expect(reg.complete({ system: "s", user: "u" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("providers 为空数组时构造即抛 ProviderError", async () => {
    await expect(makeRegistry([])).rejects.toBeInstanceOf(ProviderError);
  });
});
