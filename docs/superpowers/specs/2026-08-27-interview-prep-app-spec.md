# 面试小应用 · 规格说明（Spec）

## Goal（用户原话，逐字）

> 「我想做一个面试小应用，修改 润色 简历，形成面试方案 面试计划」

需求确认问答（用户选择，逐字记录）：

| 问题 | 用户选择 |
|---|---|
| 应用形态 | **本地 Web 应用** |
| 智能能力来源 | **两者都要（端云可切换）**：云端 Claude API + Apple 端侧 Foundation Models，接口抽象统一、实现可切换 |
| MVP 范围 | **简历导入与润色、面试方案生成、练习计划与打卡、模拟面试对话**（全选） |
| 项目定位 | **求职作品集 + 自用**：分层清晰、有单测、README 讲设计决策 |

## 分期（Scope Check）

四个功能不是一个不可分的整体。按「每期交付可独立运行、可测试的软件」拆为三期：

- **Plan 1（本期）**：应用骨架 + 端云双 Provider 抽象 + **简历润色** + **面试方案生成**
- Plan 2（后续）：练习计划与打卡（日程生成、勾选、进度持久化）
- Plan 3（后续）：模拟面试对话（多轮追问、逐题点评，走同一 Provider 层）

Plan 2/3 只增量加 service + route + 前端 tab，不改既有模块内部实现（铁律 6）。

## 功能需求（Plan 1）

1. **简历润色**：粘贴简历文本 → 返回 ① 逐条修改建议（严重度/原文/建议/理由）② 改写后的完整简历文本。结果本地持久化，可回看。
2. **面试方案生成**：粘贴简历 + 目标岗位 JD → 返回 ① 备战重点 ② 预测面试题（分类 + 答题要点）③ 冲刺日程。结果本地持久化。
3. **Provider 切换**：设置页可查看各 Provider 可用状态并切换；活跃 Provider 不可用时自动降级到另一个可用 Provider，且对用户可见（响应标注实际使用的 Provider 与是否降级）。
4. 全部 UI 与文案为中文。

## 技术决策

- **运行时**：Node.js ≥ 20，TypeScript（strict），ESM。
- **服务端**：Express；**测试**：Vitest + supertest；**校验**：zod。
- **云端 AI**：官方 SDK `@anthropic-ai/sdk`，默认模型 `claude-opus-5`（配置可覆盖）；默认开启 server-side refusal fallback（`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`）。凭证从环境（`ANTHROPIC_API_KEY`）或 `ant auth login` 的本地 profile 解析，**绝不写入仓库、绝不下发前端**。
- **端侧 AI**：macOS 26 的 FoundationModels 框架，经 `bridge/fm-bridge.swift` 编译出的 CLI 桥接（stdin JSON → stdout 文本；`--check` 探测可用性）。不可用时（未开 Apple Intelligence / 机型不支持 / 未编译）自动降级云端。
- **存储**：本地 JSON 文件（`data/`），原子写（临时文件 + rename），损坏自动备份并回退默认值。
- **安装规范**：依赖全部装在项目 `node_modules/`，无任何全局/系统级安装（遵守用户级 CLAUDE.md 第五节）。

## 架构铁律对照（设计如何满足）

| 铁律 | 本设计的满足方式 |
|---|---|
| 1 高内聚 | 一个文件一职责：`store/` 只管持久化，`ai/` 只管模型调用，`services/` 只管业务 prompt 与结果结构，`routes/` 只管 HTTP 边界 |
| 2 低耦合 | 业务层只依赖 `AIProvider` 接口与 `Store<T>` 接口；`createApp(deps)` 依赖注入，无隐式全局状态；测试注入 Mock |
| 3 极强稳定性 | Provider 失败自动降级链；存储原子写 + 损坏回退；所有路由统一错误包裹，任何异常不崩进程；重启后数据完整（文件已落盘） |
| 4 极高并发 | 全链路 async/await，无同步阻塞 IO（`node:fs/promises`）；AI 调用彼此独立可并发 |
| 5 极强鲁棒性 | 所有入参 zod 校验（长度上限、必填）；LLM 输出 zod 校验 + 一次自动重试；异常路径有专门测试 |
| 6 极强扩展性 | 新增 Provider = 新增一个实现文件 + 注册；新增功能（Plan 2/3）= 新增 service/route 文件，不改既有模块 |

## 多系统交互准则对照

| 准则 | 满足方式 |
|---|---|
| 稳定数据边界 | HTTP API 走 `/api/v1` 前缀；响应统一 `{ok, data}` / `{ok, error:{code,message}}`；破坏性变更须升 `/api/v2` |
| 标准化接口 | 前后端只通过 HTTP JSON 通信；Node 与 Swift 桥只通过 stdin/stdout JSON 通信 |
| 单一数据源 | `data/` 目录唯一 owner 是服务端；前端只读 API，从不直接碰文件 |
| 可观测边界 | 每次 AI 调用输出结构化日志（provider / 耗时 / 成败 / 是否降级） |
| 演进不破坏 | 新字段一律 optional；zod schema 用 `.passthrough()` 兼容未知字段 |

## 验证纪律（结论必有可复现测试）

- 每个任务先写失败测试（red）再实现（green），测试落仓库、`npm test` 可任意时刻重跑。
- 所有测试用 MockProvider / 假桥脚本，**不依赖网络与真实 key**，同输入同结论。
- 「修好了/做完了」的每一条结论都指向具体测试文件。

## 非目标（本期不做）

- 上架/多用户/鉴权（本地单用户工具）
- 简历文件解析（PDF/Word 导入，先支持纯文本粘贴）
- 练习打卡与模拟面试（Plan 2/3）
