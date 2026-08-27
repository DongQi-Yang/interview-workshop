# 面试小应用 Plan 2 实施计划（练习打卡 + 工程加固）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从面试方案一键生成可勾选、可持久化的练习打卡计划；同时落地 Plan 1 最终审查移交的工程加固清单。

**Architecture:** 既有分层不变：`Store<T>` 增加串行化 `update(fn)` 消除读改写竞态；`ValidationError` 抽到 `src/errors.ts` 供 service 层使用；新增 practiceService（纯函数）+ 三条路由 + 前端「练习打卡」tab，全部文件级增量。

**Tech Stack:** 同 Plan 1（Node ≥ 20、TypeScript strict ESM、Express、zod、Vitest + supertest）。

**Spec:** `docs/superpowers/specs/2026-08-27-plan2-practice-spec.md`

## Global Constraints

- 分支 `feature/plan-2`；不改 Plan 1 已锁定的对外契约（既有 API 路径、响应包裹、AIProvider 接口）。
- 所有新输入边界 zod / 显式校验，错误一律中文 message；/api/v1 前缀与 {ok,data}/{ok,error:{code,message}} 包裹。
- `Store<T>` 新增 `update(fn: (value: T) => T | Promise<T>): Promise<T>`：按 store 实例串行执行（内部 promise 链），返回更新后的值；read/write 语义不变。
- 每任务先红后绿；`npm test && npm run build` 全绿后 commit；提交前 `git show --stat HEAD` 核实（全局 gitignore 有吞文件前科）。

---

### Task 1: 工程加固批处理

**Files:**
- Modify: `src/store/jsonStore.ts`（Store.update）、`src/app.ts`（polish/plan 路由改用 update）、`src/ai/registry.ts`（空数组守卫 + 失配 warn）、`src/ai/appleFMProvider.ts`（超时可注入 + 超时文案）、`public/app.js`（esc(severity) + 按钮双击守卫）、`package.json`（残留清理）
- Test: `test/jsonStore.test.ts`、`test/registry.test.ts`、`test/appleFMProvider.test.ts`、`test/errorBoundary.test.ts`、`test/frontend.test.ts`
- Create: `test/fixtures/slow-bridge.sh`

**Interfaces:**
- Produces: `Store<T>.update(fn)`（后续任务的打卡路由消费）；其余为行为加固，无新接口。

- [ ] **Step 1: 写失败测试（一批红）**

`test/jsonStore.test.ts` 追加：

```ts
  it("update 串行化：两次并发 update 全部生效", async () => {
    const s = createJsonStore<{ list: number[] }>(join(dir, "u.json"), { list: [] });
    await Promise.all([
      s.update(async (v) => {
        await new Promise((r) => setTimeout(r, 20));
        return { list: [...v.list, 1] };
      }),
      s.update((v) => ({ list: [...v.list, 2] })),
    ]);
    expect((await s.read()).list.sort()).toEqual([1, 2]);
  });

  it("update 返回更新后的值", async () => {
    const s = createJsonStore(join(dir, "u2.json"), { n: 0 });
    const out = await s.update((v) => ({ n: v.n + 1 }));
    expect(out).toEqual({ n: 1 });
    expect(await s.read()).toEqual({ n: 1 });
  });
```

`test/registry.test.ts` 追加：

```ts
  it("providers 为空数组时构造即抛 ProviderError", async () => {
    await expect(makeRegistry([])).rejects.toBeInstanceOf(ProviderError);
  });
```

（`makeRegistry` 当前直接 `new ProviderRegistry(...)` 不是 async 抛错——把该辅助函数改为 `async` 并在其中 `new`，构造抛错即 reject；或改用 `expect(() => new ProviderRegistry([], store)).toThrow(ProviderError)` 的同步断言，二选一，落盘保持与实现一致。）

`test/appleFMProvider.test.ts` 追加（`test/fixtures/slow-bridge.sh`，chmod +x：`#!/bin/sh\nsleep 5`）：

```ts
  it("桥超时被击杀时错误信息注明超时", async () => {
    const p = new AppleFMProvider("test/fixtures/slow-bridge.sh", { completeTimeoutMs: 200 });
    await expect(p.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
      message: expect.stringContaining("超时"),
    });
  }, 10_000);
```

`test/errorBoundary.test.ts` 追加两条 max 分支测试：

```ts
  it("polish resumeText 超过 50000 字返回 400 中文报错", async () => {
    const res = await request(app).post("/api/v1/resume/polish").send({ resumeText: "x".repeat(50_001) });
    expect(res.status).toBe(400);
    expect(/[一-鿿]/.test(res.body.error.message)).toBe(true);
  });
  it("plan jobDescription 超过 50000 字返回 400 中文报错", async () => {
    const res = await request(app).post("/api/v1/interview-plan").send({ resumeText: "r", jobDescription: "x".repeat(50_001) });
    expect(res.status).toBe(400);
    expect(/[一-鿿]/.test(res.body.error.message)).toBe(true);
  });
```

（注意 payload 约 50KB，不会触发 1mb 的 body 限制，落在 zod max 分支。）

`test/frontend.test.ts` 追加静态锁定：

```ts
  it("app.js 转义 severity 且按钮有请求期禁用守卫", async () => {
    const res = await request(createApp(await makeTestDeps())).get("/app.js");
    expect(res.text).toContain("esc(s.severity)");
    expect(res.text).toContain("disabled = true");
  });
```

- [ ] **Step 2: 运行确认失败**：`npm test` → 上述新增全部 FAIL（update 不存在为编译错，属预期红）

- [ ] **Step 3: 实现**

`src/store/jsonStore.ts`：接口与实现加 update（串行链）：

```ts
export interface Store<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
  /** 串行化的读改写：同一 store 实例上的 update 依次执行，避免并发丢更新（铁律 3） */
  update(fn: (value: T) => T | Promise<T>): Promise<T>;
}
```

createJsonStore 内：

```ts
  let chain: Promise<unknown> = Promise.resolve();
  const store: Store<T> = {
    async read() { /* 原实现不变 */ },
    async write(value: T) { /* 原实现不变 */ },
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
```

`src/app.ts`：polish 与 plan 两处 `read→unshift→write` 改为：

```ts
    await deps.recordsStore.update((records) => {
      records.unshift({ id: randomUUID(), type: "polish", createdAt: new Date().toISOString(), input: { resumeText: parsed.data.resumeText }, result });
      return records;
    });
```

（plan 路由同型，type:"plan"、input 为 parsed.data。）

`src/ai/registry.ts` 构造函数与 getActive：

```ts
  constructor(private providers: AIProvider[], private configStore: Store<AppConfig>) {
    if (providers.length === 0) throw new ProviderError("ProviderRegistry 至少需要一个 Provider");
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
```

`src/ai/appleFMProvider.ts`：构造加可注入超时；超时击杀（`code === null`）时文案注明：

```ts
  constructor(
    private bridgePath = "bridge/bin/fm-bridge",
    private opts: { checkTimeoutMs?: number; completeTimeoutMs?: number } = {},
  ) {}
  // checkAvailability 用 this.opts.checkTimeoutMs ?? 10_000；complete 用 this.opts.completeTimeoutMs ?? 120_000
  // close 回调里：
  //   if (code === 0) resolve(...)
  //   else if (code === null) reject(new ProviderError(`端侧桥执行超时被终止（signal ${signal ?? "unknown"}）`, true))
  //   else reject(new ProviderError(`端侧桥退出码 ${code}: ${errOut.trim()}`, true))
```

（close 回调签名为 `(code, signal)`，现有代码只取 code——补上 signal 参数。）

`public/app.js`：

- `sev-${s.severity}` 与 `[${{...}[s.severity]}]` 处：class 用 `sev-${esc(s.severity)}`（标签映射对象取值不变，取不到时兜底 `esc(s.severity)` 原样显示）。
- polishBtn / planBtn onclick 开头 `btn.disabled = true`（btn 取 event 目标或直接 `$("#polishBtn")`），`finally` 里恢复 `false`——用 try/finally 包既有 try/catch。

`package.json`：删除 `main`、`directories`；`description` 填「面试工坊：本地简历润色与面试方案工具（端云双 AI 引擎）」。

- [ ] **Step 4: 运行确认通过**：`npm test && npm run build` → 全绿
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: Store.update 串行化与工程加固批处理"`

---

### Task 2: errors.ts 抽取 + practiceService

**Files:**
- Create: `src/errors.ts`, `src/services/practiceService.ts`, `test/practiceService.test.ts`
- Modify: `src/app.ts`（删除本地 ValidationError 类，改 `import { ValidationError } from "./errors.js"`）

**Interfaces:**
- Produces:
  - `class ValidationError extends Error`（name="ValidationError"，构造 `(message: string)`）——迁移，语义不变，既有 400 映射与测试必须保持绿。
  - `interface PracticeTask { day: number; task: string; done: boolean; completedAt: string | null; }`
  - `interface PracticePlan { id: string; createdAt: string; sourceRecordId: string; tasks: PracticeTask[]; }`
  - `buildPracticePlan(record: AppRecord): PracticePlan`（record.type!=="plan" 或 result.studyPlan 缺失/为空 → ValidationError；tasks 按 day 升序，done=false，completedAt=null）
  - `toggleTask(plan: PracticePlan, index: number, done: boolean): PracticePlan`（纯函数返回新对象；index 非整数/越界 → ValidationError；done=true 写 ISO completedAt，false 置 null）

- [ ] **Step 1: 写失败测试 `test/practiceService.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildPracticePlan, toggleTask } from "../src/services/practiceService.js";
import type { AppRecord } from "../src/services/records.js";

function planRecord(studyPlan: unknown): AppRecord {
  return { id: "rec-1", type: "plan", createdAt: "2026-08-27T00:00:00.000Z", input: {}, result: { focusAreas: [], questions: [], studyPlan } };
}

describe("buildPracticePlan", () => {
  it("从方案记录生成按 day 升序的打卡任务", () => {
    const plan = buildPracticePlan(planRecord([
      { day: 2, task: "音视频八股" },
      { day: 1, task: "开场三题" },
    ]));
    expect(plan.sourceRecordId).toBe("rec-1");
    expect(plan.tasks.map((t) => t.day)).toEqual([1, 2]);
    expect(plan.tasks[0]).toMatchObject({ task: "开场三题", done: false, completedAt: null });
  });

  it("非 plan 记录抛 ValidationError", () => {
    const rec = { ...planRecord([{ day: 1, task: "x" }]), type: "polish" as const };
    expect(() => buildPracticePlan(rec)).toThrowError(expect.objectContaining({ name: "ValidationError" }));
  });

  it("studyPlan 缺失或为空抛 ValidationError", () => {
    expect(() => buildPracticePlan(planRecord(undefined))).toThrowError(expect.objectContaining({ name: "ValidationError" }));
    expect(() => buildPracticePlan(planRecord([]))).toThrowError(expect.objectContaining({ name: "ValidationError" }));
  });
});

describe("toggleTask", () => {
  const base = buildPracticePlan(planRecord([{ day: 1, task: "a" }, { day: 2, task: "b" }]));

  it("勾选写入 completedAt，取消置 null，且不改原对象", () => {
    const done = toggleTask(base, 0, true);
    expect(done.tasks[0].done).toBe(true);
    expect(done.tasks[0].completedAt).toBeTruthy();
    expect(base.tasks[0].done).toBe(false);
    const undone = toggleTask(done, 0, false);
    expect(undone.tasks[0]).toMatchObject({ done: false, completedAt: null });
  });

  it("越界与非整数 index 抛 ValidationError", () => {
    for (const idx of [-1, 2, 1.5, Number.NaN]) {
      expect(() => toggleTask(base, idx, true)).toThrowError(expect.objectContaining({ name: "ValidationError" }));
    }
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

`src/errors.ts`：

```ts
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
```

`src/app.ts`：删除文件内的 `class ValidationError`，顶部 `import { ValidationError } from "./errors.js";`（其余引用点不变，既有测试保持绿）。

`src/services/practiceService.ts`：

```ts
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../errors.js";
import type { AppRecord } from "./records.js";

const StudyPlanResultSchema = z
  .object({
    studyPlan: z
      .array(z.object({ day: z.number().int().positive(), task: z.string() }).passthrough())
      .min(1),
  })
  .passthrough();

export interface PracticeTask {
  day: number;
  task: string;
  done: boolean;
  completedAt: string | null;
}

export interface PracticePlan {
  id: string;
  createdAt: string;
  sourceRecordId: string;
  tasks: PracticeTask[];
}

export function buildPracticePlan(record: AppRecord): PracticePlan {
  if (record.type !== "plan") throw new ValidationError("该记录不是面试方案，无法生成打卡计划");
  const parsed = StudyPlanResultSchema.safeParse(record.result);
  if (!parsed.success) throw new ValidationError("该方案没有可用的冲刺计划（studyPlan）");
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    sourceRecordId: record.id,
    tasks: [...parsed.data.studyPlan]
      .sort((a, b) => a.day - b.day)
      .map((d) => ({ day: d.day, task: d.task, done: false, completedAt: null })),
  };
}

export function toggleTask(plan: PracticePlan, index: number, done: boolean): PracticePlan {
  if (!Number.isInteger(index) || index < 0 || index >= plan.tasks.length) {
    throw new ValidationError("任务不存在");
  }
  return {
    ...plan,
    tasks: plan.tasks.map((t, i) =>
      i === index ? { ...t, done, completedAt: done ? new Date().toISOString() : null } : t,
    ),
  };
}
```

- [ ] **Step 4: 运行确认通过**：`npm test && npm run build` → 全绿（含既有全部测试）
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: practiceService 与 ValidationError 抽取"`

---

### Task 3: 打卡路由 + 存储装配

**Files:**
- Modify: `src/app.ts`（AppDeps 加 practiceStore + 三条路由）、`test/helpers.ts`、`src/server.ts`
- Create: `test/practiceRoute.test.ts`

**Interfaces:**
- Consumes: `buildPracticePlan`/`toggleTask`/`PracticePlan`（Task 2）、`Store.update`（Task 1）
- Produces:
  - `AppDeps.practiceStore: Store<PracticePlan | null>`（helpers 与 server 同步：`data/practice.json` 默认 `null`）
  - `POST /api/v1/practice-plan` body `{recordId?: string}`：recordId 给定则找该记录（找不到→400「找不到该记录」）；未给定取 records 里第一条 `type==="plan"`（没有→400「还没有生成过面试方案，请先在「面试方案」页生成」）；成功 `practiceStore.write(plan)` 并返回 plan
  - `GET /api/v1/practice-plan` → 活跃计划或 null
  - `PUT /api/v1/practice-plan/tasks/:index` body `{done: boolean}`（非布尔→400 中文）；无活跃计划→400「还没有打卡计划」；经 `practiceStore.update` 内调用 `toggleTask`（越界由其抛 ValidationError→400）；返回更新后的 plan

- [ ] **Step 1: 写失败测试 `test/practiceRoute.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { makeTestDeps } from "./helpers.js";

const PLAN_JSON = JSON.stringify({
  focusAreas: ["音视频"],
  questions: [{ category: "基础", question: "q", answerOutline: ["a"] }],
  studyPlan: [{ day: 1, task: "开场三题" }, { day: 2, task: "八股" }],
});

async function appWithPlanRecord() {
  const deps = await makeTestDeps(() => PLAN_JSON);
  const app = createApp(deps);
  await request(app).post("/api/v1/interview-plan").send({ resumeText: "r", jobDescription: "jd" });
  return app;
}

describe("练习打卡", () => {
  it("无方案记录时生成打卡计划返回 400 中文引导", async () => {
    const app = createApp(await makeTestDeps(() => PLAN_JSON));
    const res = await request(app).post("/api/v1/practice-plan").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("面试方案");
  });

  it("从最近方案生成计划，GET 可读回", async () => {
    const app = await appWithPlanRecord();
    const res = await request(app).post("/api/v1/practice-plan").send({});
    expect(res.status).toBe(200);
    expect(res.body.data.tasks).toHaveLength(2);
    const got = await request(app).get("/api/v1/practice-plan");
    expect(got.body.data.tasks[0].task).toBe("开场三题");
  });

  it("勾选持久化且可取消；越界与非布尔 400", async () => {
    const app = await appWithPlanRecord();
    await request(app).post("/api/v1/practice-plan").send({});
    const done = await request(app).put("/api/v1/practice-plan/tasks/0").send({ done: true });
    expect(done.status).toBe(200);
    expect(done.body.data.tasks[0].done).toBe(true);
    const readBack = await request(app).get("/api/v1/practice-plan");
    expect(readBack.body.data.tasks[0].done).toBe(true);

    expect((await request(app).put("/api/v1/practice-plan/tasks/9").send({ done: true })).status).toBe(400);
    expect((await request(app).put("/api/v1/practice-plan/tasks/0").send({ done: "yes" })).status).toBe(400);
  });

  it("无活跃计划时勾选返回 400", async () => {
    const app = createApp(await makeTestDeps(() => PLAN_JSON));
    const res = await request(app).put("/api/v1/practice-plan/tasks/0").send({ done: true });
    expect(res.status).toBe(400);
  });

  it("指定不存在的 recordId 返回 400", async () => {
    const app = await appWithPlanRecord();
    const res = await request(app).post("/api/v1/practice-plan").send({ recordId: "nope" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

`src/app.ts`（AppDeps 加字段；路由与既有路由并列，顶部补 practiceService import）：

```ts
const PracticeBody = z.object({ recordId: z.string().optional() });
const ToggleBody = z.object({ done: z.boolean({ message: "done 必须是布尔值" }) });

app.post("/api/v1/practice-plan", async (req, res, next) => {
  try {
    const parsed = PracticeBody.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError(zhMessage(parsed.error.issues[0].message));
    const records = await deps.recordsStore.read();
    const source = parsed.data.recordId
      ? records.find((r) => r.id === parsed.data.recordId)
      : records.find((r) => r.type === "plan");
    if (!source) {
      throw new ValidationError(
        parsed.data.recordId ? "找不到该记录" : "还没有生成过面试方案，请先在「面试方案」页生成",
      );
    }
    const plan = buildPracticePlan(source);
    await deps.practiceStore.write(plan);
    res.json({ ok: true, data: plan });
  } catch (err) {
    next(err);
  }
});

app.get("/api/v1/practice-plan", async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await deps.practiceStore.read() });
  } catch (err) {
    next(err);
  }
});

app.put("/api/v1/practice-plan/tasks/:index", async (req, res, next) => {
  try {
    const parsed = ToggleBody.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(zhMessage(parsed.error.issues[0].message));
    const updated = await deps.practiceStore.update((plan) => {
      if (!plan) throw new ValidationError("还没有打卡计划");
      return toggleTask(plan, Number(req.params.index), parsed.data.done);
    });
    res.json({ ok: true, data: updated });
  } catch (err) {
    next(err);
  }
});
```

`test/helpers.ts` 与 `src/server.ts`：`practiceStore = createJsonStore<PracticePlan | null>(join(dataDir, "practice.json"), null)` 并传入 deps。

- [ ] **Step 4: 运行确认通过**：`npm test && npm run build` → 全绿
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: 练习打卡 API（生成/查询/勾选，update 串行化持久化）"`

---

### Task 4: 前端「练习打卡」tab

**Files:**
- Modify: `public/index.html`、`public/app.js`、`public/style.css`
- Test: `test/frontend.test.ts`（追加静态断言）

**Interfaces:**
- Consumes: Task 3 的三条 API。

- [ ] **Step 1: 写失败测试**（`test/frontend.test.ts` 追加）：

```ts
  it("页面含练习打卡入口且 app.js 接入打卡 API", async () => {
    const app = createApp(await makeTestDeps());
    const page = await request(app).get("/index.html");
    expect(page.text).toContain("练习打卡");
    const js = await request(app).get("/app.js");
    expect(js.text).toContain("/api/v1/practice-plan");
    expect(js.text).toContain("loadPractice");
  });
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

`public/index.html`：nav 增 `<button data-tab="practice">练习打卡</button>`；main 增：

```html
    <section id="tab-practice" class="tab">
      <div id="practiceView"></div>
    </section>
```

`public/app.js`：tab 切换分支加 `if (btn.dataset.tab === "practice") loadPractice().catch((err) => { $("#practiceView").innerHTML = `<p class="error">${esc(err.message)}</p>`; });`；新增：

```js
async function loadPractice() {
  const view = $("#practiceView");
  const plan = await api("/api/v1/practice-plan");
  if (!plan) {
    view.innerHTML =
      '<p>还没有打卡计划。先在「面试方案」生成方案，然后回来一键生成。</p>' +
      '<button id="genPractice">从最近的面试方案生成打卡计划</button>' +
      '<p class="error" id="practiceError"></p>';
    $("#genPractice").onclick = async () => {
      const btn = $("#genPractice");
      btn.disabled = true;
      try {
        await api("/api/v1/practice-plan", { method: "POST", body: "{}" });
        await loadPractice();
      } catch (err) {
        $("#practiceError").textContent = err.message;
        btn.disabled = false;
      }
    };
    return;
  }
  const doneCount = plan.tasks.filter((t) => t.done).length;
  view.innerHTML =
    `<p class="meta">进度：${doneCount} / ${plan.tasks.length}</p>` +
    '<ul class="practice">' +
    plan.tasks
      .map(
        (t, i) =>
          `<li><label><input type="checkbox" data-index="${i}" ${t.done ? "checked" : ""}> ` +
          `<b>D${esc(t.day)}</b> ${esc(t.task)}${t.done ? `<small>（${esc(new Date(t.completedAt).toLocaleString("zh-CN"))} 完成）</small>` : ""}</label></li>`,
      )
      .join("") +
    '</ul><button id="regenPractice">重新生成（覆盖当前进度）</button><p class="error" id="practiceError"></p>';
  view.querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.onchange = async () => {
      box.disabled = true;
      try {
        await api(`/api/v1/practice-plan/tasks/${box.dataset.index}`, {
          method: "PUT",
          body: JSON.stringify({ done: box.checked }),
        });
        await loadPractice();
      } catch (err) {
        box.checked = !box.checked;
        box.disabled = false;
        $("#practiceError").textContent = err.message;
      }
    };
  });
  $("#regenPractice").onclick = async () => {
    const btn = $("#regenPractice");
    btn.disabled = true;
    try {
      await api("/api/v1/practice-plan", { method: "POST", body: "{}" });
      await loadPractice();
    } catch (err) {
      $("#practiceError").textContent = err.message;
      btn.disabled = false;
    }
  };
}
```

`public/style.css` 追加：

```css
ul.practice { list-style: none; padding: 0; }
ul.practice li { padding: 6px 0; border-bottom: 1px solid #e0e0e6; }
ul.practice small { color: #5c6674; margin-left: 8px; }
```

- [ ] **Step 4: 运行确认通过**：`npm test` → 全绿；`PORT=5299 npm run dev` 起服务，curl 冒烟 `/index.html` 含「练习打卡」后停掉
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat: 前端练习打卡 tab（生成/勾选/进度/重生成）"`

---

### Task 5: README 更新 + Check 表补行

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** 更新 README：功能列表加「练习打卡」（生成来源、勾选持久化、覆盖式重生成）；API 清单补三条新路由；「原话 vs 已交付」Check 表把「练习计划与打卡」一行从「本期未交付（Plan 2）」改为已交付并给证据（`src/services/practiceService.ts` + `test/practiceRoute.test.ts`）；架构一节补 `Store.update` 串行化说明；测试说明一节把「降级链四种场景」措辞精确为「降级链 4 种场景 + Provider 管理 3 种场景」；「已知偏差/加固」区补 Plan 2 落地的加固项与仍留后续的清单（cwd 基准、Swift Task.detached、saveRecord、maxTokens 注释）。
- [ ] **Step 2:** `npm test && npm run build` 全绿
- [ ] **Step 3: Commit**：`git add -A && git commit -m "docs: README 更新（练习打卡与加固清单）"`

---

## Self-Review 记录

1. **Spec 覆盖**：生成（T3 POST + T2 build）、勾选与进度（T3 PUT/GET + T4 UI）、持久化（practiceStore + update 串行化）、中文引导与全部异常路径（T2/T3 测试逐条）、加固清单 8 项（T1 与 T5）——spec 全覆盖；未做项在 spec 与 README 显式声明。
2. **占位符扫描**：无 TBD；T1 的 appleFMProvider 改动以行为契约 + 关键分支伪码给出，具体行落点由实施者按现有文件结构落（该文件已含 settle 守卫等 Plan 1 修复，逐字替换不现实，契约为准）。
3. **类型一致性**：`Store.update` 签名在 T1 定义、T3 消费一致；`PracticePlan/PracticeTask` 在 T2 定义、T3/T4 消费一致；`ValidationError` 迁移后 name 语义不变，错误中间件无需改动。
