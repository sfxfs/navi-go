# 2. 系统架构

## 2.1 架构概览

NaviGo 采用**多智能体状态图**架构。核心抽象是来自 LangGraph 的编译后 `StateGraph`，它迭代调用专业化智能体，每个智能体从共享的强类型状态对象读取并写入。主管节点根据哪些状态字段仍缺失或不完整来决定下一个运行的智能体。

系统围绕三个层次设计：

1. **接口层**：HTTP API（Fastify）与 CLI 运行器——两者调用同一个编译后的图。
2. **编排层**：图构建器、状态模式、路由逻辑与断点续传。
3. **智能体与工具层**：领域专用智能体与外部 API 集成。

```
+------------------+------------------+------------------+
|   接口层          |   编排层          |   智能体与工具层   |
+------------------+------------------+------------------+
| API 路由          | StateGraph       | 需求解析器        |
| (plan.route.ts)  | (builder.ts)     | (req-parser.     |
|                  |                  |  agent.ts)       |
| CLI 运行器        | PlannerState     | 表单补全器        |
| (run-plan.ts)    | (state.ts)       | (form-completer. |
|                  |                  |  agent.ts)       |
| Fastify 服务器    | 路由器            | 偏好智能体        |
| (server.ts)      | (routes.ts)      | (preference.     |
|                  |                  |  agent.ts)       |
|                  | 断点续传器         | 目的地智能体       |
|                  | (checkpointer.ts)| (destination.    |
|                  |                  |  agent.ts)       |
|                  |                  | 行程智能体        |
|                  |                  | (itinerary.      |
|                  |                  |  agent.ts)       |
|                  |                  | 预算智能体        |
|                  |                  | (budget.agent.ts)|
|                  |                  | 打包智能体        |
|                  |                  | (packing.agent.ts|
|                  |                  | )                |
|                  |                  | 风险守卫          |
|                  |                  | (risk-guard.     |
|                  |                  |  agent.ts)       |
|                  |                  | 计划合成器        |
|                  |                  | (plan-synthesizer|
|                  |                  | .agent.ts)       |
+------------------+------------------+------------------+
|                                     | Duffel 航班      |
|                                     | (duffel-flight.  |
|                                     |  tool.ts)        |
|                                     | Open-Meteo       |
|                                     | 天气             |
|                                     | (openmeteo-      |
|                                     |  weather.tool.ts)|
+------------------+------------------+------------------+
```

## 2.2 状态模式

图状态在 `src/graph/state.ts` 中使用 LangGraph `Annotation.Root` 定义。每个字段都有一个归约器（reducer）函数，控制智能体输出如何合并到运行状态中。

### PlannerState 字段

| 字段 | 类型 | 归约器 | 说明 |
|-------|------|---------|-------------|
| `userRequest` | `UserRequest \| null` | 替换 | 解析后的用户输入（日期、预算、IATA 代码、兴趣） |
| `preferences` | `Preferences \| null` | 替换 | 提取的旅行风格、节奏、住宿档次 |
| `destinationCandidates` | `DestinationCandidate[]` | 替换 | 带推荐理由的排序目的地 |
| `flightOptions` | `FlightOption[]` | 替换 | Duffel 实时去程航班报价 |
| `returnFlightOptions` | `FlightOption[]` | 替换 | Duffel 实时返程航班报价 |
| `weatherRisks` | `WeatherRiskSummary \| null` | 替换 | 每日天气预报与风险等级 |
| `itineraryDraft` | `ItineraryDay[]` | 替换 | 按天的活动与主题 |
| `budgetAssessment` | `BudgetAssessment \| null` | 替换 | 估算总费用与上限对比及提示 |
| `packingList` | `string[]` | 替换 | 生成的打包物品 |
| `selectedFlightOfferId` | `string \| null` | 替换 | 推荐的去程航班报价 ID |
| `selectedReturnFlightOfferId` | `string \| null` | 替换 | 推荐的返程航班报价 ID |
| `safetyFlags` | `string[]` | 集合并集 | 累积的风险标记（去重） |
| `decisionLog` | `DecisionLogEntry[]` | 拼接 | 每一步智能体操作的可审计追踪 |
| `finalPlan` | `FinalPlan \| null` | 替换 | 合成的最终产物 |
| `naturalLanguage` | `string \| null` | 替换 | 原始自然语言用户输入 |
| `parsedRequest` | `ParsedRequest \| null` | 替换 | 部分提取的请求字段 |
| `pendingQuestions` | `string[] \| null` | 替换 | 针对缺失字段的澄清式问题 |

### 替换 vs. 集合并集归约器

大部分字段使用**替换归约器**（`(_, next) => next`），因为智能体生成的是其领域的完整快照。只有 `safetyFlags` 使用**集合并集**以跨阶段累积标记，`decisionLog` 使用拼接以保留历史。

## 2.3 图构建器

`src/graph/builder.ts` 组装 `StateGraph`：

```typescript
const graphBuilder = new StateGraph(PlannerStateAnnotation)
  .addNode("risk_guard", runRiskGuardAgent)
  .addNode("supervisor", runSupervisorNode)
  .addNode("preference_agent", runPreferenceAgent)
  .addNode("destination_agent", runDestinationAgent)
  .addNode("itinerary_agent", runItineraryAgent)
  .addNode("budget_agent", runBudgetAgent)
  .addNode("packing_agent", runPackingAgent)
  .addNode("plan_synthesizer", runPlanSynthesizerAgent)
  .addNode("requirement_parser", runRequirementParser)
  .addNode("form_completer", runFormCompleter)
  .addConditionalEdges(START, routeFromStart)
  .addEdge("requirement_parser", "form_completer")
  .addConditionalEdges("form_completer", routeFromFormCompleter)
  .addConditionalEdges("risk_guard", routeFromRiskGuard)
  .addConditionalEdges("supervisor", routeFromSupervisor)
  .addEdge("preference_agent", "risk_guard")
  .addEdge("destination_agent", "risk_guard")
  .addEdge("itinerary_agent", "risk_guard")
  .addEdge("budget_agent", "risk_guard")
  .addEdge("packing_agent", "risk_guard")
  .addEdge("plan_synthesizer", END);
```

每条智能体边都会回到 `risk_guard`，确保在整个规划生命周期中持续进行安全扫描。为降低延迟和成本，风险守卫在同一规划周期内的后续调用中会跳过 LLM 扫描（若安全标记已存在）—— 仅重新运行低成本的规则检查。

## 2.4 路由逻辑

路由器（`src/graph/routes.ts`）实现状态驱动的条件边：

### `routeFromStart`

- 若 `naturalLanguage` 存在且 `parsedRequest` 缺失 → `requirement_parser`
- 若 `parsedRequest` 存在且 `userRequest` 缺失 → `form_completer`
- 若 `userRequest` 存在 → `risk_guard`
- 否则 → `END`

### `routeFromFormCompleter`

- 若 `pendingQuestions` 非空 → `END`（等待用户通过 `/plan/chat/resume` 回复）
- 若 `userRequest` 已组装 → `risk_guard`
- 否则 → `END`

### `routeFromRiskGuard`

- 若 `isBlockedByRiskGuard(state)` 为真且无最终计划 → `plan_synthesizer`（安全拒答）
- 若 `finalPlan` 已设置 → `END`
- 否则 → `supervisor`

### `routeFromSupervisor`

按依赖顺序检查状态字段：

1. 无 `userRequest` → `END`
2. 无 `preferences` → `preference_agent`
3. 无 `destinationCandidates` → `destination_agent`
4. 缺失 `itineraryDraft` 或 `weatherRisks` → `itinerary_agent`
5. 无 `budgetAssessment` → `budget_agent`
6. `packingList` 为空 → `packing_agent`
7. 无 `finalPlan` → `plan_synthesizer`
8. 否则 → `END`

## 2.5 持久化与断点续传

图通过 `BaseCheckpointSaver` 编译，支持线程级状态持久化与恢复。

### PostgreSQL Saver（生产环境）

```typescript
const saver = PostgresSaver.fromConnString(connectionString);
await saver.setup();
```

`buildPlannerGraph()` 默认使用。需要 `POSTGRES_URL`。

### 内存 Saver（测试）

```typescript
const saver = new MemorySaver();
```

单元测试与集成测试使用，避免外部数据库依赖。

### 状态恢复

API 支持 `GET /plan/:threadId` 获取任意线程的当前断点状态，包括 `next` 节点、`values`、`metadata` 和 `createdAt`。这使客户端可以轮询规划进度或恢复中断的会话。

## 2.6 接口

### HTTP API

实现在 `src/interfaces/api/server.ts` 和 `src/interfaces/api/routes/plan.route.ts`：

| 端点 | 方法 | 说明 |
|----------|--------|-------------|
| `/plan` | `POST` | 以结构化 `userRequest` 和 `threadId` 调用规划图 |
| `/plan/chat` | `POST` | 提交自然语言请求；可能返回 `pendingQuestions` |
| `/plan/chat/resume` | `POST` | 回答待澄清问题并继续规划 |
| `/plan/:threadId` | `GET` | 按线程获取断点状态 |
| `/health` | `GET` | 健康检查 |

POST 处理器使用 Zod 校验载荷，捕获 `ToolError` 并映射为 `502 Bad Gateway`，返回 `finalPlan`、`safetyFlags` 和 `decisionLog`。

### CLI 运行器

实现在 `src/interfaces/cli/run-plan.ts`：

接收标志：`--thread-id`、`--request`、`--user-id`、`--origin`、`--destination-hint`、`--destination-city`、`--destination-iata`、`--start-date`、`--end-date`、`--budget`、`--adults`、`--children`、`--interests`。

将最终计划以格式化 JSON 输出到标准输出。

## 2.7 错误处理与韧性

### 工具错误

所有外部 API 调用都通过 `src/tools/common/http.ts` 中的 `requestJson()`，提供：

- **超时**：默认 15 秒，使用 `AbortController`
- **重试**：2 次重试，指数退避（`150ms × 2^attempt × random(0.85, 1.15)`）
- **类型化错误**：`ToolError` 含代码（`AUTH_ERROR`、`RATE_LIMIT`、`UPSTREAM_TIMEOUT`、`UPSTREAM_BAD_RESPONSE`、`NETWORK_ERROR`、`VALIDATION_ERROR`）

### 模式校验

Zod schema 守护：
- 环境变量（`src/config/env.ts`）
- API 请求体（`plan.route.ts`）
- LLM 结构化输出（智能体级 `withStructuredOutput`）
- 外部 API 响应（航班与天气工具）

### 安全失败智能体行为

每个智能体在所需输入缺失时返回 `{}`（无操作），使图对偏态和乱序执行具备韧性。

## 2.8 限流与静态资源

Fastify 服务器注册：
- `@fastify/rate-limit`，每分钟 100 请求。
- `@fastify/static`，从 `public/` 目录提供文件（例如 `/` 路径的 `index.html`）。
