# 8. Evaluation and Testing Summary

本节基于当前 `tests/` 与脚本配置，给出 NaviGo 的测试与评估总结。

## 8.1 测试分层

```
tests/
├── unit/
│   ├── agents/
│   ├── security/
│   └── tools/
├── integration/
├── evals/
└── helpers/
```

### Unit

- `tests/unit/agents/budget.agent.test.ts`
- `tests/unit/agents/itinerary.agent.test.ts`
- `tests/unit/agents/risk-guard.agent.test.ts`
- `tests/unit/security/guardrails.test.ts`
- `tests/unit/tools/http.test.ts`

目标：验证单模块逻辑正确性与错误路径。

### Integration

- `tests/integration/graph.plan-flow.test.ts`
- `tests/integration/api.plan-endpoint.test.ts`
- `tests/integration/api.frontend-route.test.ts`

目标：验证完整图流程、API 路由、静态资源与状态持久化读取行为。

### Eval

- `tests/evals/travel-planner.eval.ts`

目标：验证“最终计划完整性”基线；该用例对 `LANGSMITH_API_KEY` 做环境门控。

## 8.2 关键覆盖点（按模块）

| 模块 | 已有验证点（来自测试代码） |
|---|---|
| `risk-guard.agent.ts` | 注入命中与非命中分支、风险标记写入 |
| `itinerary.agent.ts` | 活动生成去重、高风险天气室内 fallback、未知城市锚点 fallback |
| `budget.agent.ts` | 超预算/预算内分支及风险标记 |
| `guardrails.ts` | prompt injection / unsafe output 检测，schema 验证失败分支 |
| `tools/common/http.ts` | query 组装、超时中断与错误映射 |
| `graph/builder.ts` + `routes.ts` | 全链路执行、按状态推进节点、线程恢复 |
| API routes | `POST /plan` 与 `GET /plan/:threadId` 行为与状态读取 |

## 8.3 测试策略特点

### 1) 可重复性强

测试大量使用：

- `FakeStructuredChatModel`
- `createInMemoryCheckpointer()`
- itinerary 依赖注入（stubbed flight/weather）

因此单元与集成测试不依赖真实外部 API，结果稳定。

### 2) 边界约束一致

测试夹具普遍通过 schema（如 `UserRequestSchema.parse(...)`）构造，保证与生产输入契约一致。

### 3) 状态机验证优先

集成测试关注的是状态图执行结果（`finalPlan`、snapshot、thread 恢复），而不是内部实现细节，适合保障重构安全。

## 8.4 当前评估（Eval）机制

`tests/evals/travel-planner.eval.ts` 的基线评分由四项组成：

- 有 summary
- itinerary 非空
- packingList 非空
- budget 存在

通过条件：`completenessScore >= 4`。

这属于“结构完整性”评估，适合作为最低质量门槛。

## 8.5 仍可增强的评估维度

以下为建议项（当前仓库未完整实现）：

1. **相关性评估**：目的地/行程与用户兴趣匹配度
2. **预算准确性评估**：估算模型与样本真实开销偏差
3. **安全鲁棒性评估**：注入变体语料回归集
4. **多场景回归**：亲子、多人、高风险天气、无航班等边界场景
5. **性能评估**：分节点耗时与外部 API 失败率趋势

## 8.6 执行命令汇总

```bash
npm run test:unit
npm run test:integration
npm run test:eval
npm run test
npm run acceptance
```

其中 `acceptance` 会在满足环境变量时追加 live CLI 场景验证。

## 8.7 结论

基于现有测试代码可确认：

- 核心规划链路（graph + API）已有自动化覆盖
- 关键安全环节（注入检测、unsafe output 检测）已有单元测试覆盖
- 外部依赖调用的超时与错误映射已有单元测试覆盖

同时，当前 eval 仍以结构完整性为主，若用于更高可靠性场景，建议补齐语义质量、安全鲁棒性与性能回归三类评估。