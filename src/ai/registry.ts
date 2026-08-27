import { ProviderError } from "./provider.js";
import type { AIProvider, CompletionRequest } from "./provider.js";
import type { Store } from "../store/jsonStore.js";
import type { AppConfig } from "../config.js";

export interface CompletionOutcome {
  text: string;
  providerId: string;
  fallback: boolean;
}

export class ProviderRegistry {
  constructor(
    private providers: AIProvider[],
    private configStore: Store<AppConfig>,
  ) {
    if (providers.length === 0) throw new ProviderError("ProviderRegistry 至少需要一个 Provider");
  }

  list(): AIProvider[] {
    return [...this.providers];
  }

  async getActive(): Promise<AIProvider> {
    const cfg = await this.configStore.read();
    const found = this.providers.find((p) => p.id === cfg.activeProvider);
    if (!found) {
      console.warn(`[ai] 配置的活跃 Provider "${cfg.activeProvider}" 不存在，回退到 ${this.providers[0].id}`);
      return this.providers[0];
    }
    return found;
  }

  async setActive(id: string): Promise<void> {
    if (!this.providers.some((p) => p.id === id)) {
      throw new ProviderError(`未知的 Provider: ${id}`);
    }
    const cfg = await this.configStore.read();
    await this.configStore.write({ ...cfg, activeProvider: id });
  }

  async complete(req: CompletionRequest): Promise<CompletionOutcome> {
    const active = await this.getActive();
    // 降级链：活跃者优先，其余真实 Provider 兜底；mock 只能被显式选择（铁律 3）
    const order = [
      active,
      ...this.providers.filter((p) => p.id !== active.id && p.id !== "mock"),
    ];
    let lastErr: Error | undefined;
    for (const p of order) {
      const avail = await p.checkAvailability();
      if (!avail.available) {
        console.warn(`[ai] provider=${p.id} 不可用: ${avail.reason}`);
        lastErr = new ProviderError(avail.reason ?? `${p.id} 不可用`);
        continue;
      }
      const t0 = Date.now();
      try {
        const text = await p.complete(req);
        console.info(`[ai] provider=${p.id} ms=${Date.now() - t0} ok fallback=${p.id !== active.id}`);
        return { text, providerId: p.id, fallback: p.id !== active.id };
      } catch (err) {
        console.warn(`[ai] provider=${p.id} ms=${Date.now() - t0} failed: ${(err as Error).message}`);
        lastErr = err as Error;
      }
    }
    throw lastErr instanceof ProviderError
      ? lastErr
      : new ProviderError(lastErr?.message ?? "无可用 AI Provider");
  }
}
