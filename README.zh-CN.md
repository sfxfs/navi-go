# NaviGo

基于 LangChain/LangGraph 的多智能体旅行规划 TypeScript 后端。

NaviGo 通过编排多个专业 AI 智能体，整合航班查询、天气风险、预算评估、打包清单和安全检查，生成可持久化的旅行计划。它同时提供 HTTP API（Fastify）和 CLI 两种接口，底层共享同一个规划图（Planner Graph）。

## 技术栈

- **运行时**: Node.js (ESM)
- **语言**: TypeScript（`NodeNext` 模块解析）
- **AI 框架**: LangChain / LangGraph
- **模型提供商**: OpenAI
- **外部 API**: Duffel（航班）、Open-Meteo（天气）
- **持久化**: PostgreSQL + `@langchain/langgraph-checkpoint-postgres`
- **可观测性**: LangSmith（可选）
- **服务端**: Fastify
- **测试**: Vitest

## 功能特性

- **多智能体编排**: Supervisor 风格路由，协调偏好、目的地、行程、预算、打包、风险守卫和计划合成等智能体
- **真实航班查询**: 集成 Duffel API 获取实时航班报价
- **天气风险评估**: 基于 Open-Meteo 预报的每日风险评分
- **预算可行性分析**: 根据住宿偏好估算行程成本
- **安全防护**: 提示词注入和输出内容安全检测
- **状态持久化**: 基于 PostgreSQL 的线程级检查点与恢复
- **双端接口**: HTTP API（`POST /plan`、`GET /plan/:threadId`）+ CLI

## 快速开始

### 前置条件

- Node.js (>= 18)
- Docker & Docker Compose（用于本地 PostgreSQL）

### 1. 安装依赖

```bash
npm install
```

### 2. 启动 PostgreSQL

```bash
docker compose up -d postgres
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入你的密钥
```

必需变量：

| 变量 | 用途 |
|------|------|
| `OPENAI_API_KEY` | OpenAI 模型调用 |
| `DUFFEL_API_TOKEN` | 航班查询（Duffel） |
| `POSTGRES_URL` | 检查点持久化 |

可选变量：

| 变量 | 用途 |
|------|------|
| `LANGSMITH_API_KEY` | 追踪与评估 |
| `LANGSMITH_TRACING` | 设为 `true` 启用追踪 |

### 4. 运行

**API 服务**（默认）：
```bash
npm run dev
```

**CLI 规划器**：
```bash
npm run dev -- --cli \
  --thread-id trip-1 \
  --request "Plan a 3-day trip to Tokyo" \
  --origin SFO \
  --destination-hint Tokyo \
  --destination-city TYO \
  --destination-iata HND \
  --start-date 2026-04-21 \
  --end-date 2026-04-23 \
  --budget 2400 \
  --adults 1 \
  --children 0 \
  --interests food,museums
```

## 架构

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   HTTP API  │     │    CLI       │     │  Fastify Server │
│  POST /plan │     │  --cli 参数  │     │  GET /plan/:id  │
└──────┬──────┘     └──────┬───────┘     └─────────────────┘
       │                   │
       └─────────┬─────────┘
                 ▼
        ┌────────────────┐
        │  Planner Graph │  (基于 PlannerState 的 StateGraph)
        │   LangGraph    │
        └───────┬────────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
risk_guard  supervisor   preference
    │           │        destination
    │           │        itinerary
    │           │        budget
    │           │        packing
    │           │        plan_synthesizer
    └───────────┴───────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
   Duffel (航班)     Open-Meteo (天气)
   PostgreSQL (状态)
```

核心目录：

- `src/agents/` — 智能体节点实现
- `src/graph/` — 状态模式、路由逻辑、图构建器
- `src/tools/` — 外部 API 集成
- `src/interfaces/` — API 和 CLI 入口
- `src/persistence/` — 检查点存储器

## 开发命令

```bash
npm run dev              # 启动 API 服务
npm run build            # 编译到 dist/
npm run start            # 运行编译后应用
npm run typecheck        # TypeScript 检查 (tsc --noEmit)
npm run lint             # ESLint
npm run test             # 全部测试
npm run test:unit        # 单元测试
npm run test:integration # 集成测试
npm run test:eval        # 评估套件（需 LangSmith）
npm run acceptance       # 完整验收门禁
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/plan` | 调用规划图 |
| `GET`  | `/plan/:threadId` | 获取持久化状态 |
| `GET`  | `/health` | 健康检查 |

### POST /plan 示例

```bash
curl -X POST http://localhost:3000/plan \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "trip-1",
    "userRequest": {
      "requestText": "Plan a 3-day trip to Tokyo",
      "originIata": "SFO",
      "destinationHint": "Tokyo",
      "destinationCityCode": "TYO",
      "destinationIata": "HND",
      "travelStartDate": "2026-04-21",
      "travelEndDate": "2026-04-23",
      "budget": 2400,
      "adults": 1,
      "children": 0,
      "interests": ["food", "museums"]
    }
  }'
```

## 测试

- **单元测试**：独立验证智能体/工具行为 (`tests/unit/`)
- **集成测试**：端到端图编排和 API 验证，使用注入的伪造依赖 (`tests/integration/`)
- **评估**：基于 LangSmith 的场景评分 (`tests/evals/`)

测试中使用：
- `FakeStructuredChatModel` 提供确定性 LLM 输出
- `createInMemoryCheckpointer()` 避免对 PostgreSQL 的强依赖
- 行程智能体的工具依赖注入桩

## 环境变量说明

- 部分环境变量在 Zod schema 中标记为**可选**，但在实际运行到相关代码路径时，会通过 `require*` 辅助函数**强制校验**。
- `acceptance` 脚本仅在 `OPENAI_API_KEY`、`DUFFEL_API_TOKEN` 和 `POSTGRES_URL` 均设置时才会执行线上 API CLI 场景。
- Open-Meteo 免费预报 API 对日期范围有限制（通常约 14 天）。使用实时天气查询时，请选择允许窗口内的日期。
