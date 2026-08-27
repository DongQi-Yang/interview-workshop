# 面试小应用 Plan 1 实施计划（骨架 + 双 Provider + 简历润色 + 面试方案）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本地 Web 应用：简历润色 + 面试方案生成，AI 能力经统一 Provider 抽象在云端 Claude 与 Apple 端侧模型间可切换、可自动降级。

**Architecture:** Express + TypeScript 分层（routes → services → ai/store），`createApp(deps)` 依赖注入组合根；`AIProvider` 接口下挂 Claude（官方 SDK）/ AppleFM（Swift CLI 桥）/ Mock 三个实现，`ProviderRegistry` 负责选择与降级；数据落本地 JSON 文件（原子写）。

**Tech Stack:** Node ≥ 20、TypeScript（strict, ESM）、Express、zod、`@anthropic-ai/sdk`、Vitest + supertest、Swift（FoundationModels 桥，macOS 26）。

**Spec:** `docs/superpowers/specs/2026-08-27-interview-prep-app-spec.md`

## Global Constraints

- 项目根：`/Users/ghostoo/Projects/interview-prep-app`；所有依赖装在项目 `node_modules/`，禁止任何全局/系统级安装。
- 云端模型 ID 精确为 `claude-opus-5`（`data/config.json` 可覆盖）；调用必须走官方 SDK `@anthropic-ai/sdk`，默认附带 `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`。
- API key 只从环境 / `ant auth login` profile 解析；不写入仓库、不下发前端、不打印日志。
- 所有 API 走 `/api/v1` 前缀；响应统一 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`。
- 数据写盘必须原子（临时文件 + rename）；`data/` 加入 `.gitignore`。
- 全部 UI 与文案中文；测试不依赖网络与真实 key。
- 每个任务：先红测试后实现，结束即 commit。

---

### Task 1: 项目脚手架 + 健康检查接口

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `src/app.ts`, `src/server.ts`, `test/health.test.ts`

**Interfaces:**
- Produces: `createApp(): express.Express`（Task 6 会将签名改为 `createApp(deps: AppDeps)`，届时同步改本任务的测试）；`GET /api/v1/health` → `{ok:true,data:{status:"up"}}`

- [ ] **Step 1: 初始化工程**

```bash
mkdir -p /Users/ghostoo/Projects/interview-prep-app && cd /Users/ghostoo/Projects/interview-prep-app
git init
npm init -y
npm pkg set type=module scripts.dev="tsx src/server.ts" scripts.test="vitest run" scripts.build="tsc --noEmit"
npm i express zod @anthropic-ai/sdk
npm i -D typescript tsx vitest supertest @types/express @types/supertest @types/node
```

- [ ] **Step 2: 写 `tsconfig.json` 与 `.gitignore`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "skipLibCheck": true, "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`.gitignore`：

```
node_modules/
data/
bridge/bin/
.env
```

- [ ] **Step 3: 写失败测试 `test/health.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("health", () => {
  it("GET /api/v1/health 返回 up", async () => {
    const res = await request(createApp()).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: "up" } });
  });
});
```

- [ ] **Step 4: 运行确认失败**：`npm test` → FAIL（`createApp` 不存在）

- [ ] **Step 5: 实现 `src/app.ts` 与 `src/server.ts`**

```ts
// src/app.ts
import express from "express";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static("public"));
  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true, data: { status: "up" } });
  });
  return app;
}
```

```ts
// src/server.ts
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 5173);
createApp().listen(port, () => {
  console.log(`[server] http://localhost:${port}`);
});
```

- [ ] **Step 6: 运行确认通过**：`npm test` → PASS；`npm run build` → 无类型错误

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: 脚手架与健康检查接口"
```

---

### Task 2: 原子化 JSON 文件存储

**Files:**
- Create: `src/store/jsonStore.ts`, `test/jsonStore.test.ts`

**Interfaces:**
- Produces: `interface Store<T> { read(): Promise<T>; write(value: T): Promise<void>; }`；`createJsonStore<T>(filePath: string, defaultValue: T): Store<T>`

- [ ] **Step 1: 写失败测试 `test/jsonStore.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行确认失败**：`npm test` → FAIL

- [ ] **Step 3: 实现 `src/store/jsonStore.ts`**

```ts
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
```

- [ ] **Step 4: 运行确认通过**：`npm test` → PASS
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: 原子化 JSON 存储（损坏自动备份回退）"`

---

### Task 3: AIProvider 接口 + MockProvider

**Files:**
- Create: `src/ai/provider.ts`, `src/ai/mockProvider.ts`, `test/mockProvider.test.ts`

**Interfaces:**
- Produces:
  - `interface CompletionRequest { system: string; user: string; maxTokens?: number; }`
  - `interface Availability { available: boolean; reason?: string; }`
  - `interface AIProvider { readonly id: string; readonly name: string; checkAvailability(): Promise<Availability>; complete(req: CompletionRequest): Promise<string>; }`
  - `class ProviderError extends Error { readonly retryable: boolean }`
  - `class MockProvider implements AIProvider`（构造入参 `handler: (req: CompletionRequest) => string`，确定性输出，供全部测试使用）

- [ ] **Step 1: 写失败测试 `test/mockProvider.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/ai/mockProvider.js";

describe("MockProvider", () => {
  it("同输入同输出（确定性）", async () => {
    const p = new MockProvider((req) => `echo:${req.user}`);
    expect(await p.complete({ system: "s", user: "hi" })).toBe("echo:hi");
    expect(await p.complete({ system: "s", user: "hi" })).toBe("echo:hi");
    expect((await p.checkAvailability()).available).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npm test` → FAIL

- [ ] **Step 3: 实现**

```ts
// src/ai/provider.ts
export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface Availability {
  available: boolean;
  reason?: string;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  checkAvailability(): Promise<Availability>;
  complete(req: CompletionRequest): Promise<string>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}
```

```ts
// src/ai/mockProvider.ts
import type { AIProvider, Availability, CompletionRequest } from "./provider.js";

export class MockProvider implements AIProvider {
  readonly id = "mock";
  readonly name = "Mock（测试）";
  constructor(private handler: (req: CompletionRequest) => string) {}
  async checkAvailability(): Promise<Availability> {
    return { available: true };
  }
  async complete(req: CompletionRequest): Promise<string> {
    return this.handler(req);
  }
}
```

- [ ] **Step 4: 运行确认通过**：`npm test` → PASS
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: AIProvider 接口与 MockProvider"`

---

### Task 4: ClaudeProvider（官方 SDK，注入式可测）

**Files:**
- Create: `src/ai/claudeProvider.ts`, `test/claudeProvider.test.ts`

**Interfaces:**
- Consumes: `AIProvider`/`ProviderError`（Task 3）
- Produces: `class ClaudeProvider implements AIProvider`，`constructor(model?: string, client?: Anthropic)` —— 测试注入假 client，生产默认 `new Anthropic()`（SDK 自动解析 env key / `ant auth login` profile）

- [ ] **Step 1: 写失败测试 `test/claudeProvider.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeProvider } from "../src/ai/claudeProvider.js";

function fakeClient(create: (params: unknown) => Promise<unknown>): Anthropic {
  return { beta: { messages: { create } } } as unknown as Anthropic;
}

describe("ClaudeProvider", () => {
  it("拼接 text 块作为返回值，并带上 fallbacks 参数", async () => {
    let captured: any;
    const client = fakeClient(async (params) => {
      captured = params;
      return {
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "你好" },
          { type: "text", text: "世界" },
        ],
      };
    });
    const p = new ClaudeProvider("claude-opus-5", client);
    const out = await p.complete({ system: "sys", user: "hi" });
    expect(out).toBe("你好世界");
    expect(captured.model).toBe("claude-opus-5");
    expect(captured.system).toBe("sys");
    expect(captured.fallbacks).toBe("default");
    expect(captured.betas).toContain("server-side-fallback-2026-07-01");
  });

  it("stop_reason=refusal 时抛出不可重试的 ProviderError", async () => {
    const client = fakeClient(async () => ({ stop_reason: "refusal", content: [] }));
    const p = new ClaudeProvider("claude-opus-5", client);
    await expect(p.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
      retryable: false,
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npm test` → FAIL

- [ ] **Step 3: 实现 `src/ai/claudeProvider.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProviderError } from "./provider.js";
import type { AIProvider, Availability, CompletionRequest } from "./provider.js";

export class ClaudeProvider implements AIProvider {
  readonly id = "claude";
  readonly name = "Claude（云端）";
  private client: Anthropic;

  constructor(private model = "claude-opus-5", client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async checkAvailability(): Promise<Availability> {
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      return { available: true };
    }
    if (existsSync(join(homedir(), ".config", "anthropic"))) {
      return { available: true }; // ant auth login 的本地 profile
    }
    return {
      available: false,
      reason: "未检测到凭证：请设置 ANTHROPIC_API_KEY，或运行 ant auth login",
    };
  }

  async complete(req: CompletionRequest): Promise<string> {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        // 安全拒答时由服务端自动路由到后备模型，见 spec 技术决策
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ProviderError("Claude 凭证无效，请检查 API key", false);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ProviderError("Claude 触发限流，请稍后重试", true);
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new ProviderError("无法连接 Claude 服务（网络问题）", true);
      }
      throw new ProviderError(`Claude 调用失败: ${(err as Error).message}`, false);
    }
    if (res.stop_reason === "refusal") {
      throw new ProviderError("模型拒绝了该请求", false);
    }
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
}
```

- [ ] **Step 4: 运行确认通过**：`npm test` → PASS（若 `MessageCreateParamsNonStreaming` 类型名与已装 SDK 版本不符，以 `npm run build` 的报错为准改成 SDK 实际导出的参数类型，不引入 any）
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: ClaudeProvider（官方 SDK + refusal fallback）"`

---

### Task 5: Apple 端侧桥（Swift CLI）+ AppleFMProvider

**Files:**
- Create: `bridge/fm-bridge.swift`, `bridge/build.sh`, `src/ai/appleFMProvider.ts`, `test/fixtures/fake-bridge.sh`, `test/appleFMProvider.test.ts`

**Interfaces:**
- Consumes: `AIProvider`/`ProviderError`（Task 3）
- Produces: `class AppleFMProvider implements AIProvider`，`constructor(bridgePath?: string)`；桥协议：`fm-bridge --check` 退出码 0=可用；无参时 stdin 读 `{"system":string,"prompt":string}` JSON，stdout 输出纯文本

- [ ] **Step 1: 写 Swift 桥 `bridge/fm-bridge.swift`**（无测试框架，验证方式为 Step 2 编译 + `--check` 手跑；Node 侧行为由假桥脚本测）

```swift
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

struct Req: Decodable { let system: String; let prompt: String }

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

if CommandLine.arguments.contains("--check") {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available: print("ok"); exit(0)
        default: fail("端侧模型不可用（未开启 Apple Intelligence 或机型不支持）")
        }
    } else { fail("需要 macOS 26+") }
    #else
    fail("当前 SDK 无 FoundationModels 框架")
    #endif
}

#if canImport(FoundationModels)
if #available(macOS 26.0, *) {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let req = try? JSONDecoder().decode(Req.self, from: data) else {
        fail("stdin 不是合法的 {system, prompt} JSON")
    }
    let semaphore = DispatchSemaphore(value: 0)
    Task {
        do {
            let session = LanguageModelSession(instructions: req.system)
            let response = try await session.respond(to: req.prompt)
            print(response.content)
            exit(0)
        } catch {
            fail("端侧推理失败: \(error)")
        }
    }
    semaphore.wait()
} else { fail("需要 macOS 26+") }
#else
fail("当前 SDK 无 FoundationModels 框架")
#endif
```

`bridge/build.sh`：

```bash
#!/bin/sh
set -e
cd "$(dirname "$0")"
mkdir -p bin
xcrun swiftc -O fm-bridge.swift -o bin/fm-bridge
echo "built bridge/bin/fm-bridge"
```

- [ ] **Step 2: 编译并手跑一次**：`sh bridge/build.sh && ./bridge/bin/fm-bridge --check`；记录结果（可用 / 不可用原因）。编译失败或不可用不阻塞本任务——Provider 对此有降级路径，继续走 Step 3。

- [ ] **Step 3: 写假桥脚本与失败测试**

`test/fixtures/fake-bridge.sh`（`chmod +x`）：

```sh
#!/bin/sh
if [ "$1" = "--check" ]; then exit 0; fi
cat > /dev/null
printf '端侧回答'
```

`test/appleFMProvider.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { AppleFMProvider } from "../src/ai/appleFMProvider.js";

const FAKE = "test/fixtures/fake-bridge.sh";

describe("AppleFMProvider", () => {
  it("经桥进程返回 stdout 文本", async () => {
    const p = new AppleFMProvider(FAKE);
    expect(await p.complete({ system: "s", user: "u" })).toBe("端侧回答");
  });

  it("桥不存在时 checkAvailability 返回不可用及原因", async () => {
    const p = new AppleFMProvider("bridge/bin/does-not-exist");
    const a = await p.checkAvailability();
    expect(a.available).toBe(false);
    expect(a.reason).toBeTruthy();
  });

  it("桥执行失败时抛可重试 ProviderError", async () => {
    const p = new AppleFMProvider("bridge/bin/does-not-exist");
    await expect(p.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
    });
  });
});
```

- [ ] **Step 4: 运行确认失败**：`npm test` → FAIL

- [ ] **Step 5: 实现 `src/ai/appleFMProvider.ts`**

```ts
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
```

- [ ] **Step 6: 运行确认通过**：`npm test` → PASS
- [ ] **Step 7: Commit**：`git add -A && git commit -m "feat: Apple 端侧桥与 AppleFMProvider"`

---

### Task 6: ProviderRegistry（切换 + 降级链）+ 配置与设置路由

**Files:**
- Create: `src/ai/registry.ts`, `src/config.ts`, `test/registry.test.ts`
- Modify: `src/app.ts`（签名改为 `createApp(deps: AppDeps)`）, `src/server.ts`, `test/health.test.ts`（改用 `makeTestDeps()`）
- Create: `test/helpers.ts`

**Interfaces:**
- Consumes: `AIProvider`（Task 3）、`Store<T>`/`createJsonStore`（Task 2）
- Produces:
  - `interface AppConfig { activeProvider: string; claudeModel: string; }`，默认 `{ activeProvider: "claude", claudeModel: "claude-opus-5" }`；`defaultConfig(): AppConfig`
  - `class ProviderRegistry { constructor(providers: AIProvider[], configStore: Store<AppConfig>); list(): AIProvider[]; getActive(): Promise<AIProvider>; setActive(id: string): Promise<void>; complete(req: CompletionRequest): Promise<CompletionOutcome>; }`
  - `interface CompletionOutcome { text: string; providerId: string; fallback: boolean; }`
  - `interface AppDeps { registry: ProviderRegistry; dataDir: string; }`；`createApp(deps: AppDeps)`
  - 路由：`GET /api/v1/settings/providers` → `{ok:true,data:{active,providers:[{id,name,available,reason?}]}}`；`PUT /api/v1/settings/provider` body `{id}`
  - `test/helpers.ts` 导出 `makeTestDeps(handler?: (req: CompletionRequest) => string): AppDeps`（MockProvider + 临时目录 store，全部后续测试复用）

- [ ] **Step 1: 写失败测试 `test/registry.test.ts`**

```ts
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
    expect(out).toEqual({ text: "claude 的回答", providerId: "claude", fallback: true && false });
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
});
```

（注意第一个断言写作 `fallback: false`——上面代码里 `true && false` 是笔误示范，落盘时直接写 `{ text: "claude 的回答", providerId: "claude", fallback: false }`。）

- [ ] **Step 2: 运行确认失败**：`npm test` → FAIL

- [ ] **Step 3: 实现 `src/config.ts` 与 `src/ai/registry.ts`**

```ts
// src/config.ts
export interface AppConfig {
  activeProvider: string;
  claudeModel: string;
}

export function defaultConfig(): AppConfig {
  return { activeProvider: "claude", claudeModel: "claude-opus-5" };
}
```

```ts
// src/ai/registry.ts
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
  ) {}

  list(): AIProvider[] {
    return [...this.providers];
  }

  async getActive(): Promise<AIProvider> {
    const cfg = await this.configStore.read();
    return this.providers.find((p) => p.id === cfg.activeProvider) ?? this.providers[0];
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
```

- [ ] **Step 4: 改造 `src/app.ts` 为依赖注入 + 设置路由，写 `test/helpers.ts`，更新 `health.test.ts` 与 `server.ts`**

```ts
// src/app.ts（整体替换）
import express from "express";
import type { ProviderRegistry } from "./ai/registry.js";
import { ProviderError } from "./ai/provider.js";

export interface AppDeps {
  registry: ProviderRegistry;
  dataDir: string;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static("public"));

  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true, data: { status: "up" } });
  });

  app.get("/api/v1/settings/providers", async (_req, res, next) => {
    try {
      const active = await deps.registry.getActive();
      const providers = await Promise.all(
        deps.registry.list().map(async (p) => {
          const a = await p.checkAvailability();
          return { id: p.id, name: p.name, available: a.available, reason: a.reason };
        }),
      );
      res.json({ ok: true, data: { active: active.id, providers } });
    } catch (err) {
      next(err);
    }
  });

  app.put("/api/v1/settings/provider", async (req, res, next) => {
    try {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      await deps.registry.setActive(id);
      res.json({ ok: true, data: { active: id } });
    } catch (err) {
      next(err);
    }
  });

  // 统一错误边界：业务错 4xx，其余 500，进程永不因单个请求崩溃（铁律 3/5）
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof ProviderError ? 502 : err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({ ok: false, error: { code: err.name, message: err.message } });
  });

  return app;
}
```

```ts
// test/helpers.ts
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
```

`test/health.test.ts` 改为：

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

describe("health", () => {
  it("GET /api/v1/health 返回 up", async () => {
    const res = await request(createApp(await makeTestDeps())).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: "up" } });
  });
});
```

```ts
// src/server.ts（整体替换：生产组合根）
import { join } from "node:path";
import { createApp } from "./app.js";
import { ProviderRegistry } from "./ai/registry.js";
import { ClaudeProvider } from "./ai/claudeProvider.js";
import { AppleFMProvider } from "./ai/appleFMProvider.js";
import { createJsonStore } from "./store/jsonStore.js";
import { defaultConfig } from "./config.js";

const dataDir = process.env.DATA_DIR ?? "data";
const configStore = createJsonStore(join(dataDir, "config.json"), defaultConfig());
const cfg = await configStore.read();
const registry = new ProviderRegistry(
  [new ClaudeProvider(cfg.claudeModel), new AppleFMProvider()],
  configStore,
);

const port = Number(process.env.PORT ?? 5173);
createApp({ registry, dataDir }).listen(port, () => {
  console.log(`[server] http://localhost:${port}`);
});
```

- [ ] **Step 5: 运行确认全部通过**：`npm test && npm run build` → PASS
- [ ] **Step 6: Commit**：`git add -A && git commit -m "feat: ProviderRegistry 降级链、设置路由与依赖注入"`

---

### Task 7: LLM JSON 输出解析（带一次重试）+ 简历润色

**Files:**
- Create: `src/ai/json.ts`, `src/services/resumeService.ts`, `test/resumeService.test.ts`, `test/resumeRoute.test.ts`
- Modify: `src/app.ts`（注册路由）、`test/helpers.ts`（AppDeps 增加 recordsStore）

**Interfaces:**
- Consumes: `ProviderRegistry.complete`（Task 6）、`createJsonStore`（Task 2）
- Produces:
  - `completeJson<T>(registry, req, schema: ZodType<T>): Promise<{ value: T; providerId: string; fallback: boolean }>` —— 剥 \`\`\`json 围栏、`JSON.parse` + zod 校验；失败则把报错拼进 user 再问一次，仍失败抛 `ProviderError("模型输出无法解析", true)`
  - `PolishResult = { revised: string; suggestions: Array<{ severity: "high"|"medium"|"low"; original: string; suggestion: string; reason: string }> }`；`PolishResultSchema`（zod，`.passthrough()`）
  - `polishResume(registry, resumeText): Promise<PolishResult & { providerId: string; fallback: boolean }>`
  - 路由 `POST /api/v1/resume/polish` body `{resumeText}`（1 ≤ 长度 ≤ 50000，否则 400）；结果追加保存到 `recordsStore`（`data/records.json`，`Array<Record>`，`Record = { id, type: "polish"|"plan", createdAt, input, result }`）；`GET /api/v1/records` 返回全部（新在前）
  - `AppDeps` 增加 `recordsStore: Store<AppRecord[]>`（`AppRecord` 类型定义在 `src/services/records.ts`）

- [ ] **Step 1: 写失败测试 `test/resumeService.test.ts`**

```ts
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
```

`test/resumeRoute.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

const GOOD = JSON.stringify({ revised: "新简历", suggestions: [] });

describe("POST /api/v1/resume/polish", () => {
  it("润色成功并写入记录", async () => {
    const deps = await makeTestDeps(() => GOOD);
    const app = createApp(deps);
    const res = await request(app).post("/api/v1/resume/polish").send({ resumeText: "原文" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.revised).toBe("新简历");

    const list = await request(app).get("/api/v1/records");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].type).toBe("polish");
  });

  it("空简历返回 400", async () => {
    const deps = await makeTestDeps(() => GOOD);
    const res = await request(createApp(deps))
      .post("/api/v1/resume/polish")
      .send({ resumeText: "" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npm test` → FAIL

- [ ] **Step 3: 实现 `src/ai/json.ts`**

```ts
import type { ZodType } from "zod";
import { ProviderError } from "./provider.js";
import type { CompletionRequest } from "./provider.js";
import type { ProviderRegistry } from "./registry.js";

function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (m ? m[1] : text).trim();
}

export async function completeJson<T>(
  registry: ProviderRegistry,
  req: CompletionRequest,
  schema: ZodType<T>,
): Promise<{ value: T; providerId: string; fallback: boolean }> {
  let lastError = "";
  let attempt = req;
  for (let i = 0; i < 2; i++) {
    const out = await registry.complete(attempt);
    try {
      const parsed: unknown = JSON.parse(stripFences(out.text));
      const value = schema.parse(parsed);
      return { value, providerId: out.providerId, fallback: out.fallback };
    } catch (err) {
      lastError = (err as Error).message;
      attempt = {
        ...req,
        user: `${req.user}\n\n上一次输出无法解析（错误：${lastError}）。请只输出符合要求的 JSON，不要任何解释文字或代码围栏。`,
      };
    }
  }
  throw new ProviderError(`模型输出无法解析为约定 JSON: ${lastError}`, true);
}
```

- [ ] **Step 4: 实现 `src/services/records.ts` 与 `src/services/resumeService.ts`**

```ts
// src/services/records.ts
export interface AppRecord {
  id: string;
  type: "polish" | "plan";
  createdAt: string;
  input: unknown;
  result: unknown;
}
```

```ts
// src/services/resumeService.ts
import { z } from "zod";
import { completeJson } from "../ai/json.js";
import type { ProviderRegistry } from "../ai/registry.js";

export const PolishResultSchema = z
  .object({
    revised: z.string(),
    suggestions: z.array(
      z
        .object({
          severity: z.enum(["high", "medium", "low"]),
          original: z.string(),
          suggestion: z.string(),
          reason: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type PolishResult = z.infer<typeof PolishResultSchema>;

const SYSTEM = `你是一位资深技术猎头兼技术面试官，精通中文技术简历的评审与改写。
对用户提供的简历：
1. 逐条找出问题（错别字、空泛表述、无量化数据、职责化描述、时间线矛盾、定位模糊），每条给出 severity（high=硬伤必改 / medium=显著提升 / low=锦上添花）、original（原文片段）、suggestion（具体改法）、reason（为什么）。
2. 输出改写后的完整简历文本（revised），保留用户真实经历，绝不虚构数据；不确定的量化数据用「◻︎」占位提示用户补充。
只输出 JSON：{"revised": string, "suggestions": [{"severity","original","suggestion","reason"}]}，不要任何其他文字。`;

export async function polishResume(registry: ProviderRegistry, resumeText: string) {
  const { value, providerId, fallback } = await completeJson(
    registry,
    { system: SYSTEM, user: `以下是我的简历原文：\n\n${resumeText}` },
    PolishResultSchema,
  );
  return { ...value, providerId, fallback };
}
```

- [ ] **Step 5: 注册路由（Modify `src/app.ts`）、扩展 helpers**

`src/app.ts` 在设置路由之后、错误中间件之前追加（并在 `AppDeps` 中加入 `recordsStore: Store<AppRecord[]>`，顶部补相应 import：`randomUUID` 来自 `node:crypto`、`z` 来自 `zod`）：

```ts
const PolishBody = z.object({ resumeText: z.string().min(1, "简历不能为空").max(50_000, "简历过长") });

app.post("/api/v1/resume/polish", async (req, res, next) => {
  try {
    const parsed = PolishBody.safeParse(req.body);
    if (!parsed.success) {
      const e = new Error(parsed.error.issues[0].message);
      e.name = "ValidationError";
      throw e;
    }
    const result = await polishResume(deps.registry, parsed.data.resumeText);
    const records = await deps.recordsStore.read();
    records.unshift({
      id: randomUUID(),
      type: "polish",
      createdAt: new Date().toISOString(),
      input: { resumeText: parsed.data.resumeText },
      result,
    });
    await deps.recordsStore.write(records);
    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

app.get("/api/v1/records", async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await deps.recordsStore.read() });
  } catch (err) {
    next(err);
  }
});
```

`test/helpers.ts` 的 `makeTestDeps` 增加：

```ts
const recordsStore = createJsonStore<AppRecord[]>(join(dataDir, "records.json"), []);
return { registry, dataDir, recordsStore };
```

`src/server.ts` 同步创建生产 `recordsStore`（`data/records.json`）并传入 `createApp`。

- [ ] **Step 6: 运行确认全部通过**：`npm test && npm run build` → PASS
- [ ] **Step 7: Commit**：`git add -A && git commit -m "feat: 简历润色（JSON 解析重试 + 记录持久化）"`

---

### Task 8: 面试方案生成

**Files:**
- Create: `src/services/planService.ts`, `test/planService.test.ts`
- Modify: `src/app.ts`（注册 `POST /api/v1/interview-plan`）

**Interfaces:**
- Consumes: `completeJson`（Task 7）、`recordsStore`（Task 7）
- Produces:
  - `InterviewPlanSchema`（zod，`.passthrough()`）：`{ focusAreas: string[]; questions: Array<{ category: string; question: string; answerOutline: string[] }>; studyPlan: Array<{ day: number; task: string }> }`
  - `generatePlan(registry, input: { resumeText: string; jobDescription: string })`
  - 路由 `POST /api/v1/interview-plan` body `{resumeText, jobDescription}`（各 1..50000，否则 400）；记录 `type:"plan"` 入 `recordsStore`

- [ ] **Step 1: 写失败测试 `test/planService.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { generatePlan } from "../src/services/planService.js";
import { makeTestDeps } from "./helpers.js";

const GOOD = JSON.stringify({
  focusAreas: ["音视频专业深度"],
  questions: [
    { category: "音视频", question: "讲讲 PTS/DTS", answerOutline: ["B 帧导致解码序≠显示序"] },
  ],
  studyPlan: [{ day: 1, task: "过一遍崩溃治理故事" }],
});

describe("面试方案", () => {
  it("service 返回结构化方案", async () => {
    const deps = await makeTestDeps(() => GOOD);
    const out = await generatePlan(deps.registry, {
      resumeText: "简历",
      jobDescription: "字节跳动 剪映 iOS 高级工程师",
    });
    expect(out.focusAreas).toContain("音视频专业深度");
    expect(out.questions[0].answerOutline.length).toBeGreaterThan(0);
  });

  it("路由校验缺 JD 返回 400，成功时写入 plan 记录", async () => {
    const deps = await makeTestDeps(() => GOOD);
    const app = createApp(deps);
    const bad = await request(app).post("/api/v1/interview-plan").send({ resumeText: "x" });
    expect(bad.status).toBe(400);

    const okRes = await request(app)
      .post("/api/v1/interview-plan")
      .send({ resumeText: "x", jobDescription: "y" });
    expect(okRes.status).toBe(200);
    const list = await request(app).get("/api/v1/records");
    expect(list.body.data[0].type).toBe("plan");
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npm test` → FAIL

- [ ] **Step 3: 实现 `src/services/planService.ts` 并在 `src/app.ts` 注册路由**

```ts
// src/services/planService.ts
import { z } from "zod";
import { completeJson } from "../ai/json.js";
import type { ProviderRegistry } from "../ai/registry.js";

export const InterviewPlanSchema = z
  .object({
    focusAreas: z.array(z.string()),
    questions: z.array(
      z
        .object({
          category: z.string(),
          question: z.string(),
          answerOutline: z.array(z.string()),
        })
        .passthrough(),
    ),
    studyPlan: z.array(
      z.object({ day: z.number().int().positive(), task: z.string() }).passthrough(),
    ),
  })
  .passthrough();

export type InterviewPlan = z.infer<typeof InterviewPlanSchema>;

const SYSTEM = `你是一位资深面试教练。根据候选人简历与目标岗位 JD：
1. focusAreas：列出 3–6 个备战重点（结合 JD 要求与简历强弱项）。
2. questions：预测 8–15 道最可能被问的面试题，按 category 分类（如 简历深挖/专业领域/语言基础/系统设计/行为面），每题给 answerOutline（3–6 条答题要点，基于候选人简历中的真实经历组织）。
3. studyPlan：给出按天的冲刺计划（day 从 1 开始的整数）。
只输出 JSON：{"focusAreas": string[], "questions": [{"category","question","answerOutline": string[]}], "studyPlan": [{"day": number, "task": string}]}，不要任何其他文字。`;

export async function generatePlan(
  registry: ProviderRegistry,
  input: { resumeText: string; jobDescription: string },
) {
  const user = `【目标岗位 JD】\n${input.jobDescription}\n\n【候选人简历】\n${input.resumeText}`;
  const { value, providerId, fallback } = await completeJson(
    registry,
    { system: SYSTEM, user, maxTokens: 16000 },
    InterviewPlanSchema,
  );
  return { ...value, providerId, fallback };
}
```

`src/app.ts` 追加路由（与 Task 7 的润色路由并列，复用同一错误边界）：

```ts
const PlanBody = z.object({
  resumeText: z.string().min(1, "简历不能为空").max(50_000),
  jobDescription: z.string().min(1, "JD 不能为空").max(50_000),
});

app.post("/api/v1/interview-plan", async (req, res, next) => {
  try {
    const parsed = PlanBody.safeParse(req.body);
    if (!parsed.success) {
      const e = new Error(parsed.error.issues[0].message);
      e.name = "ValidationError";
      throw e;
    }
    const result = await generatePlan(deps.registry, parsed.data);
    const records = await deps.recordsStore.read();
    records.unshift({
      id: randomUUID(),
      type: "plan",
      createdAt: new Date().toISOString(),
      input: parsed.data,
      result,
    });
    await deps.recordsStore.write(records);
    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: 运行确认通过**：`npm test && npm run build` → PASS
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: 面试方案生成"`

---

### Task 9: 前端单页

**Files:**
- Create: `public/index.html`, `public/app.js`, `public/style.css`, `test/frontend.test.ts`

**Interfaces:**
- Consumes: Task 6/7/8 的全部 `/api/v1/*` 路由（fetch JSON）
- Produces: 单页三个 tab（简历润色 / 面试方案 / 历史记录）+ 顶栏 Provider 下拉（显示可用状态，切换调 `PUT /api/v1/settings/provider`；结果区展示实际 providerId 与降级标记）

- [ ] **Step 1: 写失败测试 `test/frontend.test.ts`**（冒烟：静态页可达且含关键元素）

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

describe("前端静态页", () => {
  it("GET / 返回含三个功能入口的页面", async () => {
    const res = await request(createApp(await makeTestDeps())).get("/index.html");
    expect(res.status).toBe(200);
    expect(res.text).toContain("简历润色");
    expect(res.text).toContain("面试方案");
    expect(res.text).toContain("历史记录");
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL（404）

- [ ] **Step 3: 实现三个前端文件**

`public/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>面试工坊</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header>
    <h1>面试工坊</h1>
    <label>AI 引擎
      <select id="provider"></select>
    </label>
  </header>
  <nav>
    <button data-tab="polish" class="active">简历润色</button>
    <button data-tab="plan">面试方案</button>
    <button data-tab="records">历史记录</button>
  </nav>
  <main>
    <section id="tab-polish" class="tab active">
      <textarea id="resumeText" placeholder="粘贴你的简历全文…"></textarea>
      <button id="polishBtn">开始润色</button>
      <div id="polishResult"></div>
    </section>
    <section id="tab-plan" class="tab">
      <textarea id="planResume" placeholder="粘贴简历全文…"></textarea>
      <textarea id="planJD" placeholder="粘贴目标岗位 JD…"></textarea>
      <button id="planBtn">生成面试方案</button>
      <div id="planResult"></div>
    </section>
    <section id="tab-records" class="tab">
      <div id="recordsList"></div>
    </section>
  </main>
  <script src="app.js"></script>
</body>
</html>
```

`public/app.js`（要点：`api()` 统一封装 fetch + 错误展示；`loadProviders()` 填充下拉并标注不可用原因；`renderPolish()` 按 severity 分色列建议 + 改写全文与「复制」按钮；`renderPlan()` 渲染 focusAreas/questions/studyPlan；`loadRecords()` 列历史可展开；每个结果头部显示 `本次使用：{providerId}` 与降级提示）：

```js
const $ = (s) => document.querySelector(s);

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? "请求失败");
  return body.data;
}

function metaLine(data) {
  const fb = data.fallback ? "（活跃引擎不可用，已自动降级）" : "";
  return `<p class="meta">本次使用：${data.providerId}${fb}</p>`;
}

async function loadProviders() {
  const data = await api("/api/v1/settings/providers");
  const sel = $("#provider");
  sel.innerHTML = data.providers
    .map(
      (p) =>
        `<option value="${p.id}" ${p.id === data.active ? "selected" : ""} ${p.available ? "" : "disabled"}>
          ${p.name}${p.available ? "" : "（不可用）"}</option>`,
    )
    .join("");
  sel.onchange = () =>
    api("/api/v1/settings/provider", { method: "PUT", body: JSON.stringify({ id: sel.value }) });
}

document.querySelectorAll("nav button").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("nav button, .tab").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "records") loadRecords();
  };
});

$("#polishBtn").onclick = async () => {
  const out = $("#polishResult");
  out.innerHTML = "<p>润色中…</p>";
  try {
    const data = await api("/api/v1/resume/polish", {
      method: "POST",
      body: JSON.stringify({ resumeText: $("#resumeText").value }),
    });
    out.innerHTML =
      metaLine(data) +
      "<h3>修改建议</h3><ul>" +
      data.suggestions
        .map(
          (s) =>
            `<li class="sev-${s.severity}"><b>[${{ high: "硬伤", medium: "建议", low: "可选" }[s.severity]}]</b>
             「${s.original}」→ ${s.suggestion}<br><small>${s.reason}</small></li>`,
        )
        .join("") +
      `</ul><h3>改写版全文 <button id="copyBtn">复制</button></h3><pre>${data.revised}</pre>`;
    $("#copyBtn").onclick = () => navigator.clipboard.writeText(data.revised);
  } catch (err) {
    out.innerHTML = `<p class="error">${err.message}</p>`;
  }
};

$("#planBtn").onclick = async () => {
  const out = $("#planResult");
  out.innerHTML = "<p>生成中…</p>";
  try {
    const data = await api("/api/v1/interview-plan", {
      method: "POST",
      body: JSON.stringify({
        resumeText: $("#planResume").value,
        jobDescription: $("#planJD").value,
      }),
    });
    out.innerHTML =
      metaLine(data) +
      "<h3>备战重点</h3><ul>" + data.focusAreas.map((f) => `<li>${f}</li>`).join("") + "</ul>" +
      "<h3>预测面试题</h3>" +
      data.questions
        .map(
          (q) =>
            `<details><summary>[${q.category}] ${q.question}</summary><ul>` +
            q.answerOutline.map((a) => `<li>${a}</li>`).join("") +
            "</ul></details>",
        )
        .join("") +
      "<h3>冲刺计划</h3><ol>" +
      data.studyPlan.map((d) => `<li>D${d.day}：${d.task}</li>`).join("") +
      "</ol>";
  } catch (err) {
    out.innerHTML = `<p class="error">${err.message}</p>`;
  }
};

async function loadRecords() {
  const list = await api("/api/v1/records");
  $("#recordsList").innerHTML =
    list.length === 0
      ? "<p>暂无记录</p>"
      : list
          .map(
            (r) =>
              `<details><summary>${r.type === "polish" ? "简历润色" : "面试方案"} · ${new Date(r.createdAt).toLocaleString("zh-CN")}</summary>
               <pre>${JSON.stringify(r.result, null, 2)}</pre></details>`,
          )
          .join("");
}

loadProviders().catch((err) => console.error(err));
```

`public/style.css`（要点：中文系统字体栈；`nav` tab 切换态；`.sev-high` 红 / `.sev-medium` 橙 / `.sev-low` 灰；`.meta` 小字；`.error` 红字；textarea 全宽 12 行；`pre` 可换行）：

```css
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 860px; padding: 16px;
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif; line-height: 1.7; }
header { display: flex; justify-content: space-between; align-items: baseline; }
nav { display: flex; gap: 8px; border-bottom: 2px solid #e0e0e6; margin-bottom: 16px; }
nav button { border: none; background: none; padding: 8px 14px; font-size: 15px; cursor: pointer; }
nav button.active { border-bottom: 2px solid #2b4a8b; color: #2b4a8b; font-weight: 600; }
.tab { display: none; } .tab.active { display: block; }
textarea { width: 100%; min-height: 200px; padding: 10px; font: inherit; margin-bottom: 8px; }
button { cursor: pointer; }
pre { white-space: pre-wrap; background: #f5f6f8; padding: 12px; border-radius: 8px; }
.sev-high { color: #b3261e; } .sev-medium { color: #96650c; } .sev-low { color: #5c6674; }
.meta { color: #5c6674; font-size: 13px; }
.error { color: #b3261e; }
```

- [ ] **Step 4: 运行确认通过**：`npm test` → PASS；`npm run dev` 手动打开 http://localhost:5173 冒烟一遍两个功能（活跃 Provider 用真实可用者）
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: 前端单页（润色/方案/历史 + Provider 切换）"`

---

### Task 10: README（含铁律对照与原话 Check 表）+ 收尾

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 全部前序任务的交付物（逐条对照）

- [ ] **Step 1: 写 `README.md`**，必须包含：
  1. 项目简介与截图位（面试工坊：本地简历润色与面试方案生成，端云双引擎可切换）。
  2. 快速开始：`npm i` → 配置凭证（`ANTHROPIC_API_KEY` 或 `ant auth login`）→ 可选 `sh bridge/build.sh` 编译端侧桥 → `npm run dev`。
  3. 架构图（分层 + Provider 降级链）与设计决策（为什么接口抽象、为什么原子写、为什么 zod 双向校验）——这是作品集的讲解材料。
  4. **铁律对照表**：spec 中六条铁律 + 五条多系统准则逐条列「本仓库的落点文件」。
  5. **原话 vs 已交付 Check 表**（防漂移纪律第 2 条）：

| 用户原话 | 已交付证据 |
|---|---|
| 「修改 润色 简历」 | `src/services/resumeService.ts` + `POST /api/v1/resume/polish` + `test/resumeService.test.ts` |
| 「形成面试方案 面试计划」 | `src/services/planService.ts`（focusAreas/questions/**studyPlan 按天计划**）+ `test/planService.test.ts` |
| 「本地 Web 应用」 | Express 本地服务 + `public/` 单页，无外部部署依赖 |
| 「两者都要（端云可切换）」 | `ClaudeProvider` + `AppleFMProvider` + `ProviderRegistry` 切换与降级 + `test/registry.test.ts` |
| 「练习计划与打卡」「模拟面试对话」 | **本期未交付**，见 spec 分期（Plan 2/3）——显式声明，非漂移遗漏 |

  6. 测试说明：`npm test` 全量可重跑、零网络依赖（验证纪律第 3 条）。
- [ ] **Step 2: 全量验证**：`npm test && npm run build` → 全绿
- [ ] **Step 3: Commit**：`git add -A && git commit -m "docs: README（架构、铁律对照、原话 Check 表）"`

---

## Self-Review 记录

1. **Spec 覆盖**：简历润色（Task 7）、面试方案（Task 8）、Provider 切换与降级（Task 4/5/6）、持久化（Task 2/7）、前端（Task 9）、中文 UI（Task 9）、README/Check（Task 10）——spec 的 Plan 1 范围全覆盖；练习打卡与模拟面试按 spec 分期显式排除。
2. **占位符扫描**：无 TBD/TODO；Task 9 的 CSS/JS 与 Task 10 的 README 均给出实际内容或逐项明确的内容清单。
3. **类型一致性**：`AIProvider`/`CompletionRequest`（Task 3）在 4/5/6/7 中签名一致；`Store<T>`（Task 2）在 6/7 中一致；`AppDeps` 在 Task 6 定义、Task 7 扩展 `recordsStore` 时同步更新 helpers 与 server；`completeJson` 的返回结构在 7/8 一致。Task 6 测试代码中一处笔误已在文内标注更正。
