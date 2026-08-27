import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonStore } from "../src/store/jsonStore.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "store-")); });

describe("jsonStore", () => {
  it("写入后可读回同一值", async () => {
    const s = createJsonStore(join(dir, "a.json"), { n: 0 });
    await s.write({ n: 42 });
    expect(await s.read()).toEqual({ n: 42 });
  });

  it("文件不存在时返回默认值", async () => {
    const s = createJsonStore(join(dir, "missing.json"), { n: 7 });
    expect(await s.read()).toEqual({ n: 7 });
  });

  it("文件损坏时备份坏文件并返回默认值（不抛异常）", async () => {
    const p = join(dir, "bad.json");
    await writeFile(p, "{not json", "utf8");
    const s = createJsonStore(p, { n: 1 });
    expect(await s.read()).toEqual({ n: 1 });
    const names = await readdir(dir);
    expect(names.some((f) => f.startsWith("bad.json.corrupt-"))).toBe(true);
  });

  it("write 后目录中无残留临时文件", async () => {
    const s = createJsonStore(join(dir, "c.json"), {});
    await s.write({ x: 1 });
    const names = await readdir(dir);
    expect(names.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
