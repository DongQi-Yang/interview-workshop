import { spawn } from "node:child_process";
import { ProviderError } from "./provider.js";
import type { AIProvider, Availability, CompletionRequest } from "./provider.js";

export class AppleFMProvider implements AIProvider {
  readonly id = "apple";
  readonly name = "Apple 端侧（Foundation Models）";

  constructor(
    private bridgePath = "bridge/bin/fm-bridge",
    private opts: { checkTimeoutMs?: number; completeTimeoutMs?: number } = {},
  ) {}

  async checkAvailability(): Promise<Availability> {
    try {
      await this.run(["--check"], "", this.opts.checkTimeoutMs ?? 10_000);
      return { available: true };
    } catch (err) {
      return { available: false, reason: (err as Error).message };
    }
  }

  async complete(req: CompletionRequest): Promise<string> {
    const input = JSON.stringify({ system: req.system, prompt: req.user });
    return this.run([], input, this.opts.completeTimeoutMs ?? 120_000);
  }

  private run(args: string[], stdin: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bridgePath, args, { timeout });
      let out = "";
      let errOut = "";
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (errOut += d));
      child.on("error", (err) =>
        settle(() => reject(new ProviderError(`端侧桥启动失败: ${err.message}`, true))),
      );
      // 桥进程可能在消费 stdin 之前就已退出（如提前失败分支），此时向 child.stdin
      // 写入会触发异步 EPIPE 'error' 事件；不监听会被 Node 当作未捕获异常抛出，
      // 直接崩掉整个进程。这里显式捕获并路由进同一个 reject 路径，映射为可重试
      // ProviderError，保证外部依赖故障只影响单次请求，不影响进程存活。
      child.stdin.on("error", (err) =>
        settle(() => reject(new ProviderError(`端侧桥 stdin 写入失败: ${err.message}`, true))),
      );
      child.on("close", (code, signal) => {
        settle(() => {
          if (code === 0) resolve(out.replace(/\n$/, ""));
          else if (code === null)
            reject(new ProviderError(`端侧桥执行超时被终止（signal ${signal ?? "unknown"}）`, true));
          else reject(new ProviderError(`端侧桥退出码 ${code}: ${errOut.trim()}`, true));
        });
      });
      if (stdin) child.stdin.write(stdin);
      child.stdin.end();
    });
  }
}
