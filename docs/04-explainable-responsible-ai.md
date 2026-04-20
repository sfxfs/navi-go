# 4. Explainable & Responsible AI Practices

本文档基于当前仓库实现（`src/**`、`tests/**`、`.github/workflows/**`）总结 NaviGo 的可解释与负责任 AI 实践。

## 4.1 可解释性设计

### 1) 决策日志（Decision Log）

每个 agent 在输出 `Partial<PlannerState>` 时都会追加一条 `decisionLog` 记录（`makeDecisionLog`），字段包括：

- `agent`
- `inputSummary`
- `keyEvidence`
- `outputSummary`
- `riskFlags`
- `timestamp`

这意味着调用方不仅能看到最终 `finalPlan`，还能看到每一步“基于什么证据做了什么决策”。

### 2) 结构化输出约束

需要 LLM 的两个 agent：

- `preference_agent`
- `destination_agent`

都使用 `withStructuredOutput(...)` + Zod schema，避免自由文本直接进入状态：

- `PreferencesSchema`
- `DestinationSuggestionsSchema` / `DestinationCandidateSchema`

### 3) 边界层统一校验

Zod 校验覆盖：

- 环境变量：`src/config/env.ts`
- API 请求体：`src/interfaces/api/routes/plan.route.ts`
- 外部 API 响应：Duffel / Open-Meteo 工具层
- 最终计划：`FinalPlanSchema`

## 4.2 责任式 AI（Responsible AI）落地

### 1) 用户意图优先

`preference_agent` 中，如果用户在 `userRequest.interests` 里明确给出了兴趣项，会覆盖模型抽取的兴趣，减少“模型擅自改写用户偏好”的风险。

### 2) 明确风险暴露，不静默处理

- `risk_guard` 会把检测到的风险写入 `safetyFlags`
- `budget_agent` 超预算时写入 `BUDGET_EXCEEDED`
- `plan_synthesizer` 会把安全标记带入最终输出

即使计划可继续生成，风险也不会被隐藏。

### 3) 受控拒答路径

当检测到提示注入（`BLOCKED_PROMPT_INJECTION`）时，路由会直接进入 `plan_synthesizer` 生成安全拒答摘要，而不是继续执行完整规划链路。

## 4.3 可追溯性与审计

### 1) 线程级状态可回放

图状态使用 checkpointer 持久化，API 提供 `GET /plan/:threadId` 读取线程快照，可用于：

- 回溯 planner 在哪个节点结束
- 查看完整状态 `values`
- 查看 metadata 与时间戳

### 2) 可选 LangSmith 追踪

`LANGSMITH_TRACING=true` 时启用 tracing；metadata 通过 `buildTraceMetadata(...)` 附带：

- `userId`
- `threadId`
- `scenario`
- `service`

## 4.4 数据处理与最小化说明（基于现状）

当前实现中，`userRequest`（包含 `userId`）属于 `PlannerState` 的一部分，因此会进入 checkpoint 状态（取决于所用 checkpointer）。

也就是说：

- 系统**具备**线程状态持久化能力（默认 Postgres）
- 并非“只在内存瞬时存在，不落库”

如果部署方有更严格的数据最小化要求，建议在调用前对 `userId` 做脱敏/映射，或在状态层引入最小字段策略。

## 4.5 当前可验证的优势与边界

### 已实现优势

- 有明确安全闸门（risk guard）
- 有结构化输出与 schema 约束
- 有审计日志（decisionLog）
- 有线程级可追溯能力（checkpoint + getState）

### 已知边界

- 提示注入检测当前是规则匹配（regex），覆盖常见模式但不是完备防护
- 最终计划摘要的安全检测也是规则匹配
- 预算模型是启发式估算，不是实时报价结算模型

以上边界均可从现有代码直接观察到。