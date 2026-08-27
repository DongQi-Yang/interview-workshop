import { spawn } from "node:child_process";
import { ProviderError } from "./provider.js";
import type { AIProvider, Availability, CompletionRequest } from "./provider.js";

export class AppleFMProvider implements AIProvider {
  readonly id = "apple";
  readonly name = "Apple 端侧（Foundation Models）";

  constructor(private bridgePath = "bridge/bin/fm-bridge") {}

  async checkAvailability(): Promise<Availability> {
    try {
      await this.run(["--check"], "", 10_000);
      return { available: true };
    } catch (err) {
      return { available: false, reason: (err as Error).message };
    }
  }

  async complete(req: CompletionRequest): Promise<string> {
    const input = JSON.stringify({ system: req.system, prompt: req.user });
    return this.run([], input, 120_000);
  }

  private run(args: string[], stdin: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bridgePath, args, { timeout });
      let out = "";
      let errOut = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (errOut += d));
      child.on("error", (err) =>
        reject(new ProviderError(`端侧桥启动失败: ${err.message}`, true)),
      );
      child.on("close", (code) => {
        if (code === 0) resolve(out.replace(/\n$/, ""));
        else reject(new ProviderError(`端侧桥退出码 ${code}: ${errOut.trim()}`, true));
      });
      if (stdin) child.stdin.write(stdin);
      child.stdin.end();
    });
  }
}
