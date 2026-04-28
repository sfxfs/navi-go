# 3. 智能体设计

NaviGo 采用**专业化多智能体模式**，每个智能体负责单一规划领域。智能体通过共享的强类型状态通信，而非直接消息传递。这种设计解耦了智能体实现，支持独立测试，并确保主管路由器可以通过检查状态完整性来推理规划进度。

## 3.1 智能体分类

| 智能体 | 文件 | 职责 | 是否需要 LLM？ |
|-------|------|----------------|---------------|
| 需求解析器 | `src/agents/requirement-parser.agent.ts` | 从自然语言提取结构化旅行字段 | 是 |
| 表单补全器 | `src/agents/form-completer.agent.ts` | 校验完整性；组装 `UserRequest` 或发起追问 | 是 |
| 风险守卫 | `src/agents/risk-guard.agent.ts` | 通过规则 + LLM 扫描输入/输出的提示注入与不安全内容 | 是 |
| 偏好 | `src/agents/preference.agent.ts` | 从自由文本请求提取结构化偏好 | 是 |
| 目的地 | `src/agents/destination.agent.ts` | 带推荐理由的目的地候选建议 | 是 |
| 行程 | `src/agents/itinerary.agent.ts` | 通过 LLM 构建按天行程，获取航班与天气 | 是 |
| 预算 | `src/agents/budget.agent.ts` | 通过 LLM 估算总费用并标记预算问题 | 是 |
| 打包 | `src/agents/packing.agent.ts` | 通过 LLM 生成天气/活动感知的打包清单 | 是 |
| 计划合成器 | `src/agents/plan-synthesizer.agent.ts` | 通过 LLM 组装最终计划产物并应用输出护栏 | 是 |

## 3.2 智能体契约

每个智能体遵循相同的函数签名：

```typescript
async (state: PlannerState, deps?: AgentDependencies): Promise<Partial<PlannerState>>
```

- **输入**：对完整 `PlannerState` 的只读访问
- **输出**：仅包含该智能体所拥有的字段的部分状态更新
- **副作用**：智能体可调用外部工具（航班、天气）或通过 `withStructuredOutput` 调用 LLM
- **幂等性**：所有智能体在所需输入缺失时返回 `{}`，确保可安全重复调用

## 3.3 需求解析器智能体

**目的**：将原始自然语言请求转换为部分结构化的旅行字段。

**实现**（`src/agents/requirement-parser.agent.ts`）：

```
输入:  state.naturalLanguage
输出:  parsedRequest, decisionLog
```

- 使用 `model.withStructuredOutput(ExtractedRequestSchema)`，每个字段均可为空。
- 提示词指导模型提取日期（`YYYY-MM-DD`）、预算（数字）、IATA 代码和兴趣关键词。
- 缺失字段在写入 `parsedRequest` 前被过滤掉。

**决策日志证据**：
- 原始自然语言输入
- 提取的字段数量

## 3.4 表单补全器智能体

**目的**：校验提取的字段是否足以组装完整的 `UserRequest`，或生成澄清式问题。

**实现**（`src/agents/form-completer.agent.ts`）：

```
输入:  state.parsedRequest, state.naturalLanguage
输出:  userRequest（若完整）, pendingQuestions（若不完整）, decisionLog
```

- 使用 `model.withStructuredOutput(FormCompletionSchema)` 返回 `isComplete`、`userRequest` 和 `pendingQuestions`。
- 完整性必填字段：`travelStartDate`、`travelEndDate`、`budget`。
- 缺失字段使用合理默认值（`adults=1`、`children=0`、`interests=[]`、`userId="anonymous"`、`requestText=原始自然语言`）。
- 若不完整，返回 1–2 条自然语言问题并结束图；客户端通过 `/plan/chat/resume` 恢复。

**决策日志证据**：
- 所有必填字段是否齐全
- 提出的缺失问题

## 3.5 风险守卫智能体

**目的**：对抗性输入与不安全输入的第一道与最后一道防线。

**实现**（`src/agents/risk-guard.agent.ts`）：

```
输入:  state.userRequest.requestText, state.finalPlan
输出:  safetyFlags, decisionLog
```

- **LLM 扫描**：使用 `model.withStructuredOutput(RiskGuardSchema)` 语义检测提示注入尝试与不安全输出模式。**优化**：若同一规划周期内前次风险守卫已产生安全标记，则跳过 LLM 扫描（避免冗余 LLM 调用，每次约 1-2 秒）。
- **规则扫描**：`detectPromptInjection(...)`（`src/security/guardrails.ts`）应用正则模式，并支持零宽字符与 homoglyph 归一化。规则检查始终运行（低成本）。
- **输出扫描**：若 `finalPlan` 存在，对摘要运行 `detectUnsafeOutput(...)`。
- 标记前缀为 `BLOCKED_PROMPT_INJECTION:` 或 `UNSAFE_OUTPUT:`。
- 路由器（`routeFromRiskGuard`）将阻断请求直接路由到计划合成器以生成安全拒答。

**检测到的模式**（规则层）：
- "ignore (all/previous/prior/earlier) instructions"
- "reveal the (system/developer/hidden/inner) prompt"
- "bypass (safety/guard/policy/restrictions/filters)"
- "act as ... without restrictions"
- "disable (security/guardrails/filters/safeguards)"
- "new instructions"、"replace instructions"、"forget instructions"
- "DAN mode"、"jailbreak"

**不安全输出模式**：
- 炸弹/武器/爆炸物/枪械制造
- 非法贩运/走私
- 逃避执法/税务
- 自残/自杀指导
- 儿童剥削/虐待

## 3.6 偏好智能体

**目的**：将非结构化用户意图转换为结构化偏好画像。

**实现**（`src/agents/preference.agent.ts`）：

使用 `model.withStructuredOutput(PreferencesSchema)` 与提示词模板：

```typescript
PreferencesSchema = z.object({
  travelStyle: z.enum(["relaxed", "balanced", "packed"]),
  prioritizedInterests: z.array(z.string().min(1)),
  preferredPace: z.enum(["slow", "normal", "fast"]),
  accommodationPreference: z.enum(["budget", "midrange", "premium"]),
});
```

若用户在请求中显式提供了 `interests`，则覆盖模型提取的兴趣，确保用户意图不会被静默改写。

**决策日志证据**：
- 预算值
- 提取的兴趣列表
- 输出的旅行画像风格

## 3.7 目的地智能体

**目的**：生成带支持理由的排序目的地候选。

**实现**（`src/agents/destination.agent.ts`）：

使用 `model.withStructuredOutput(DestinationSuggestionsSchema)`，候选包含：

```typescript
DestinationCandidateSchema = z.object({
  name: z.string(),
  country: z.string(),
  iataCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  cityCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  rationale: z.string(),
});
```

**回退逻辑**：若用户提供了 `destinationHint`、`destinationCityCode` 和 `destinationIata`，当该目的地未出现在生成列表中时，智能体会将其作为显式回退候选前置。最终候选列表限制为 3 条。

**提示词上下文**：
- 用户请求文本
- 旅行日期与预算
- 兴趣
- 旅行风格（来自偏好）
- 目的地提示（如有）

## 3.8 行程智能体

**目的**：基于真实航班与天气数据构建具体的按天行程。

**实现**（`src/agents/itinerary.agent.ts`）：

### 航班搜索

若 `originIata` 与目的地 IATA 可用，调用 `searchFlightOffers()`（Duffel 集成）两次：
- **去程**：origin → destination，日期为 `travelStartDate`
- **返程**：destination → origin，日期为 `travelEndDate`

航班选项通过 `pickRecommendedFlightOption()`（`src/agents/flight-option-selection.ts`）的 O(n) min-find reduce 进行排序，优先选择抵达时间不晚于旅行开始日期的航班，然后按更早抵达、更低价格、更早起飞排序。

### 天气风险评估

调用 `fetchWeatherRiskSummary()`（Open-Meteo 集成）获取每日预报与风险等级：

- **HIGH**：恶劣天气代码（雷暴、大雪、大雨）或降水概率 >= 70%
- **MEDIUM**：降水概率 >= 40%
- **LOW**：其他情况

### 活动生成

使用 `model.withStructuredOutput(ItineraryDraftSchema)` 生成行程。提示词包含：
- 目的地、日期、旅客、预算、兴趣、风格、节奏
- 推荐的去程与返程航班详情
- 每日天气预报（温度与风险等级）

对 LLM 的指令：
- 将抵达日标记为轻松日程；将离开日标记为退房与机场中转。
- 高风险天气日优先安排室内活动。
- 将兴趣分散到各天。

**决策日志证据**：
- 找到的去程与返程航班选项数量
- 高风险天气日数量
- 生成的行程天数

## 3.9 预算智能体

**目的**：估算总旅行费用并判断是否在用户预算范围内。

**实现**（`src/agents/budget.agent.ts`）：

使用 `model.withStructuredOutput(BudgetAssessmentSchema)`，提示词包含：
- 用户预算上限
- 旅行时长与夜数
- 旅客（成人/儿童）
- 住宿偏好
- 选中的去程与返程航班详情及总航班费用
- 行程每日主题

LLM 返回：
```typescript
BudgetAssessmentSchema = z.object({
  estimatedTotal: z.number().nonnegative(),
  budgetLimit: z.number().positive(),
  withinBudget: z.boolean(),
  optimizationTips: z.array(z.string()),
});
```

**风险标记**：`BUDGET_EXCEEDED`，当 `estimatedTotal > budgetLimit` 时触发。

**决策日志证据**：
- 估算总额与预算上限
- 住宿偏好
- 选中的航班报价 ID 与航班费用

## 3.10 打包智能体

**目的**：基于天气预报与计划活动生成上下文相关的打包清单。

**实现**（`src/agents/packing.agent.ts`）：

使用 `model.withStructuredOutput(PackingListSchema)`，提示词包含：
- 目的地与旅行日期
- 旅客（成人/儿童）
- 每日天气预报（温度、降水、风险）
- 行程每日主题与活动

LLM 返回简洁、去重的必备物品打包清单。

**决策日志证据**：
- 预报天数与高风险天数
- 生成的打包物品数量

## 3.11 计划合成器智能体

**目的**：将所有智能体输出组装为最终、已校验的计划产物。

**实现**（`src/agents/plan-synthesizer.agent.ts`）：

### 安全拒答路径

若 `safetyFlags` 中存在 `BLOCKED_PROMPT_INJECTION`，合成器生成拒答摘要而非旅行计划。

### 正常路径

使用 `model.withStructuredOutput(PlanSynthesisSchema)` 生成：
- **摘要**：人类可读的旅行概览（目的地、天数、预算状态）
- **安全标记**：LLM 检测到的任何额外标记

然后组装最终产物：
- **选中目的地**：`destinationCandidates` 的第一项
- **选中航班**：`selectedFlightOfferId` 与 `selectedReturnFlightOfferId`（如有）
- **行程**：完整 `itineraryDraft`
- **预算**：完整 `budgetAssessment`
- **打包清单**：完整 `packingList`
- **安全标记**：所有累积标记与 LLM/规则检测标记的合并

### 输出护栏

返回前，合成器对生成的摘要运行 `detectUnsafeOutput()`。任何不安全模式都会追加到 `safetyFlags`。

最终计划通过 Zod 的 `FinalPlanSchema` 校验后才写入状态。

## 3.12 智能体依赖注入

智能体接受依赖以支持使用 fake 和 stub 进行测试：

| 智能体 | 依赖 |
|-------|-------------|
| `requirement_parser` | `{ model: ChatOpenAI }` |
| `form_completer` | `{ model: ChatOpenAI }` |
| `risk_guard` | `{ model: ChatOpenAI }` |
| `preference_agent` | `{ model: ChatOpenAI }` |
| `destination_agent` | `{ model: ChatOpenAI }` |
| `itinerary_agent` | `{ model: ChatOpenAI, searchFlights, fetchWeather }` |
| `budget_agent` | `{ model: ChatOpenAI }` |
| `packing_agent` | `{ model: ChatOpenAI }` |
| `plan_synthesizer` | `{ model: ChatOpenAI }` |

默认依赖使用生产实现（真实 OpenAI 模型、真实 Duffel/Open-Meteo API），测试注入 `FakeStructuredChatModel` 和 stub 工具函数。

## 3.13 决策日志

每个智能体向 `state.decisionLog` 追加一条 `DecisionLogEntry`：

```typescript
{
  agent: string,
  inputSummary: string,
  keyEvidence: string[],
  outputSummary: string,
  riskFlags: string[],
  timestamp: string, // ISO 8601
}
```

这创建了一个不可变的、仅追加的审计追踪，记录每次规划决策、考虑的证据以及标记的风险。日志在 API 响应中返回，并在 CLI 输出中打印。
