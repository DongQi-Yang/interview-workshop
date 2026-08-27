import { join } from "node:path";
import { createApp } from "./app.js";
import { ProviderRegistry } from "./ai/registry.js";
import { ClaudeProvider } from "./ai/claudeProvider.js";
import { AppleFMProvider } from "./ai/appleFMProvider.js";
import { createJsonStore } from "./store/jsonStore.js";
import { defaultConfig } from "./config.js";
import type { AppRecord } from "./services/records.js";

const dataDir = process.env.DATA_DIR ?? "data";
const configStore = createJsonStore(join(dataDir, "config.json"), defaultConfig());
const cfg = await configStore.read();
const registry = new ProviderRegistry(
  [new ClaudeProvider(cfg.claudeModel), new AppleFMProvider()],
  configStore,
);
const recordsStore = createJsonStore<AppRecord[]>(join(dataDir, "records.json"), []);

const port = Number(process.env.PORT ?? 5173);
createApp({ registry, dataDir, recordsStore }).listen(port, () => {
  console.log(`[server] http://localhost:${port}`);
});
