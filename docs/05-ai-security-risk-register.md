# 5. AI Security Risk Register

以下风险台账基于当前仓库实现与 CI/CD 配置（`.github/workflows/ci.yml`、`cd.yml`）整理。

## 5.1 风险矩阵（定性）

| 风险ID | 风险项 | 可能性 | 影响 | 当前残余风险 |
|---|---|---|---|---|
| R-01 | Prompt Injection / 越权指令注入 | 中 | 高 | 中-低 |
| R-02 | 不安全输出（unsafe content） | 低-中 | 高 | 低 |
| R-03 | LLM 结构化输出偏差/幻觉 | 中 | 中 | 低 |
| R-04 | 外部依赖与供应链风险 | 中 | 高 | 中 |
| R-05 | 密钥泄漏与凭据误用 | 低-中 | 高 | 中-低 |
| R-06 | 上游 API 异常导致可用性下降 | 中 | 中 | 中 |
| R-07 | 数据最小化不足（thread state 持久化） | 中 | 中 | 中 |

## 5.2 风险明细与控制

### R-01 Prompt Injection / 越权注入

**攻击面**
- 用户输入 `userRequest.requestText`

**现有控制**
- `detectPromptInjection(...)`（`src/security/guardrails.ts`）对常见注入语句做 regex 检测
- `risk_guard` 命中后写入 `BLOCKED_PROMPT_INJECTION`
- `routeFromRiskGuard(...)` 将流程导向 `plan_synthesizer` 的安全拒答路径

**验证证据**
- `tests/unit/agents/risk-guard.agent.test.ts`

**残余风险**
- 对变体攻击（编码、语义改写、多语混淆）覆盖有限

---

### R-02 不安全输出

**攻击面**
- 最终计划摘要文本

**现有控制**
- `detectUnsafeOutput(...)`（`src/security/guardrails.ts`）
- `plan_synthesizer` 在生成 summary 后再次扫描并追加 `safetyFlags`

**验证证据**
- `tests/unit/security/guardrails.test.ts`

**残余风险**
- 规则库可维护性与覆盖面依赖人工更新

---

### R-03 LLM 输出偏差/幻觉

**攻击面**
- 偏好抽取与目的地建议

**现有控制**
- `withStructuredOutput(...)` + Zod schema
- IATA/City code 格式约束
- 用户显式兴趣项可覆盖模型抽取结果
- 用户显式目的地（hint + code）有 fallback 合并逻辑

**验证证据**
- `tests/integration/*.test.ts`（FakeStructuredChatModel 驱动）

**残余风险**
- 结构合法不等于语义一定正确

---

### R-04 供应链风险

**攻击面**
- npm 依赖、容器镜像、构建产物

**现有控制（CI/CD 已启用）**
- `npm audit --omit=dev`（CI）
- TruffleHog secret scan（CI）
- Semgrep security scan（CI）
- Trivy image scan（CI/CD）
- SBOM 生成与上传（CI/CD）
- Build provenance attestation（CD）

**验证证据**
- `.github/workflows/ci.yml`
- `.github/workflows/cd.yml`

**残余风险**
- 依赖“已知漏洞”检测为主，零日风险仍存在

---

### R-05 密钥泄漏与凭据误用

**攻击面**
- `OPENAI_API_KEY`、`DUFFEL_API_TOKEN`、`POSTGRES_URL`、`LANGSMITH_API_KEY`

**现有控制**
- 环境变量 schema 校验 + `require*` 访问器
- Duffel token 仅通过请求头注入（`src/tools/common/duffel.ts`）
- 工具层统一 `ToolError`，避免将敏感上下文直接暴露给调用方

**残余风险**
- 调试日志/外部系统误配置仍可能造成泄漏

---

### R-06 上游 API 异常与可用性

**攻击面**
- Duffel、Open-Meteo 网络抖动或限流

**现有控制**
- `requestJson(...)` 统一超时、重试、AbortController
- HTTP 失败映射到 `ToolError` 分类
- API 层对 `ToolError` 返回 502，避免吞错

**验证证据**
- `tests/unit/tools/http.test.ts`
- `src/tools/common/http.ts`

**残余风险**
- 多上游同时异常时仍会影响端到端成功率

---

### R-07 数据最小化不足

**风险说明**
- `PlannerState` 包含完整 `userRequest`，默认 checkpointer 为 Postgres 持久化
- 因此线程状态可能包含用户标识信息（如 `userId`）

**现有控制**
- 线程级隔离（`thread_id`）
- 可通过部署策略控制数据库保留周期

**建议控制**
- 生产环境引入 `userId` 映射/脱敏策略
- 为 checkpoint 数据定义 TTL 或归档清理任务

## 5.3 处置流程（建议）

1. **检测**：`safetyFlags` 命中高风险标记
2. **隔离**：按 `threadId` 追踪相关请求并停止重试
3. **取证**：读取 `GET /plan/:threadId` 快照 + decisionLog
4. **修复**：补充 guardrail 规则或策略
5. **回归**：新增对应单元/集成测试，防止复发

## 5.4 后续增强建议

| 优先级 | 建议 |
|---|---|
| 高 | 为 prompt injection 增加语义分类器（规则 + 模型双层） |
| 高 | 为 thread state 增加数据最小化与过期清理策略 |
| 中 | 对 `/plan` 增加限流与认证（按 user/thread） |
| 中 | 建立安全回归用例集（注入语料、越权语料、越狱语料） |
| 低 | 对风险命中事件输出统一审计事件流（便于 SIEM 对接） |