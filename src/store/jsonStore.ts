import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";

export interface Store<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
}

export function createJsonStore<T>(filePath: string, defaultValue: T): Store<T> {
  return {
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
  };
}
