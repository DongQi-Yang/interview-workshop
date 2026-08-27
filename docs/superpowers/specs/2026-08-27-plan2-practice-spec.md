# 面试小应用 · Plan 2 规格说明（练习计划与打卡 + 工程加固）

## Goal（用户原话，逐字）

> 「我想做一个面试小应用，修改 润色 简历，形成面试方案 面试计划」
> MVP 范围多选中的第三项：**「练习计划与打卡」**（Plan 1 已显式分期，本期交付）

## 功能需求

1. **生成打卡计划**：从已生成的面试方案记录（`type:"plan"` 的 record，其 `result.studyPlan` 为按天任务）一键生成打卡计划；默认取最近一次方案，也可指定 recordId。没有任何方案记录时给出中文引导（「请先在面试方案生成」）。
2. **勾选打卡**：逐任务勾选完成 / 取消，记录完成时间；进度（x / y）可见。
3. **进度持久化**：打卡状态落盘 `data/practice.json`（原子写），重启零丢失（铁律 3）。单活跃计划模型：重新生成覆盖旧计划（单用户本地工具，YAGNI）。
4. 全中文 UI；前端新增「练习打卡」tab，纯增量（不改既有 tab 行为）。

## 工程加固（Plan 1 最终审查移交清单，本期落地部分）

| 项 | 来源 | 本期处置 |
|---|---|---|
| Store 无并发安全的读改写 → records 竞态丢数据 | T7 deferred + 终审建议 | `Store<T>` 增加 `update(fn)`：按 store 实例串行化的读改写；polish/plan 路由与新打卡路由全部改用 |
| registry.getActive 失配静默回退无日志；providers 空数组无防御 | T6 deferred | 空数组构造即抛；失配回退 console.warn |
| `esc(s.severity)` 漏套 | 终审 parked | 补上 |
| PolishBody/PlanBody `max(50000)` 分支无测试 | T7 deferred + 终审 parked | 各补一条 400 测试 |
| polish/plan 按钮无双击并发守卫 | T9 deferred | 请求期间禁用按钮 |
| AppleFM 超时击杀后错误文案不可辨识 | T5 deferred | code null + killed 时文案注明「超时」；超时可注入以便测试 |
| package.json 脚手架残留（main/description/directories） | 终审 Minor#9 | 清理 |
| README「降级链四种场景」措辞 | T10 deferred | 随 README 更新一并精确 |

本期不做（留 Plan 3 或按需）：saveRecord 提取（仍只有两处调用）、cwd 相对路径基准、Swift 桥 Task.detached（下次真机验证端侧时改）、maxTokens 未用注释。

## 技术决策

- `ValidationError` 从 app.ts 抽到 `src/errors.ts`（services 层也要抛输入错误，不能反向依赖 HTTP 层——高内聚/低耦合）。
- API（/api/v1，统一 {ok,data}/{ok,error} 包裹）：
  - `POST /api/v1/practice-plan` body `{recordId?}` → 生成并覆盖活跃计划
  - `GET /api/v1/practice-plan` → 活跃计划或 null
  - `PUT /api/v1/practice-plan/tasks/:index` body `{done: boolean}` → 勾选；index 越界/NaN → 400
- 数据模型：`PracticePlan { id, createdAt, sourceRecordId, tasks: [{day, task, done, completedAt|null}] }`，tasks 按 day 升序。
- 存储 owner 仍是服务端（准则 3）；`data/practice.json` 默认值 `null`。

## 铁律对照（增量）

| 铁律 | 满足方式 |
|---|---|
| 1 高内聚 | practiceService 只管计划构建与勾选纯函数；errors.ts 只管错误类型 |
| 2 低耦合 | service 不 import express/app；路由只调 service + store |
| 3 稳定性 | update(fn) 串行化消除读改写丢数据；practice.json 原子写；空数组防御 |
| 4 并发 | update 串行化按 store 实例隔离，不同 store 之间仍并发；全 async |
| 5 鲁棒性 | recordId 不存在 / 非 plan 记录 / studyPlan 缺失 / index 越界 / done 非布尔全部 400 中文报错，各有测试 |
| 6 扩展性 | 新功能 = 新增 service/路由/前端 tab 文件级增量；Store.update 为接口新增方法（既有 read/write 语义不变） |

## 验证纪律

同 Plan 1：每任务先红后绿、测试零网络、`npm test` 可任意重跑；并发 update 有确定性测试（两次并发 update 全部生效）。
