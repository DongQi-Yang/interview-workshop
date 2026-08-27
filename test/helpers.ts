import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "../src/ai/mockProvider.js";
import { ProviderRegistry } from "../src/ai/registry.js";
import { createJsonStore } from "../src/store/jsonStore.js";
import { defaultConfig } from "../src/config.js";
import type { AppDeps } from "../src/app.js";
import type { CompletionRequest } from "../src/ai/provider.js";

export async function makeTestDeps(
  handler: (req: CompletionRequest) => string = () => "{}",
): Promise<AppDeps> {
  const dataDir = await mkdtemp(join(tmpdir(), "app-"));
  const configStore = createJsonStore(join(dataDir, "config.json"), {
    ...defaultConfig(),
    activeProvider: "mock",
  });
  const registry = new ProviderRegistry([new MockProvider(handler)], configStore);
  return { registry, dataDir };
}
