import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";

export interface Store<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
  /** 串行化的读改写：同一 store 实例上的 update 依次执行，避免并发丢更新（铁律 3） */
  update(fn: (value: T) => T | Promise<T>): Promise<T>;
}

export function createJsonStore<T>(filePath: string, defaultValue: T): Store<T> {
  let chain: Promise<unknown> = Promise.resolve();
  const store: Store<T> = {
    async read(): Promise<T> {
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return structuredClone(defaultValue);
        }
        throw err;
      }
      try {
        return JSON.parse(raw) as T;
      } catch {
        // 损坏文件：备份后回退默认值，绝不让坏数据崩掉进程（铁律 3）
        const backup = join(dirname(filePath), `${basename(filePath)}.corrupt-${Date.now()}`);
        await rename(filePath, backup);
        console.warn(`[store] 文件损坏，已备份到 ${backup}`);
        return structuredClone(defaultValue);
      }
    },
    async write(value: T): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      const tmp = join(dirname(filePath), `.${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
      await rename(tmp, filePath); // 原子替换：任何时刻磁盘上都是完整文件
    },
    update(fn) {
      const next = chain.then(async () => {
        const value = await store.read();
        const updated = await fn(value);
        await store.write(updated);
        return updated;
      });
      chain = next.catch(() => undefined); // 单次失败不能卡死后续 update
      return next;
    },
  };
  return store;
}
