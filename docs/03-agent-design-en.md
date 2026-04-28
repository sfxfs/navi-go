# 3. Agent Design

NaviGo implements a **specialized multi-agent pattern** where each agent owns a single planning domain. Agents communicate through a shared, strongly-typed state rather than direct message passing. This design decouples agent implementations, enables independent testing, and ensures that the supervisor router can reason about planning progress by inspecting state completeness.

## 3.1 Agent Taxonomy

| Agent | File | Responsibility | LLM Required? |
|-------|------|----------------|---------------|
| Requirement Parser | `src/agents/requirement-parser.agent.ts` | Extract structured trip fields from natural language | Yes |
| Form Completer | `src/agents/form-completer.agent.ts` | Validate completeness; assemble `UserRequest` or ask clarifying questions | Yes |
| Risk Guard | `src/agents/risk-guard.agent.ts` | Scan inputs/outputs for prompt injection and unsafe content via rules + LLM | Yes |
| Preference | `src/agents/preference.agent.ts` | Extract structured preferences from free-text request | Yes |
| Destination | `src/agents/destination.agent.ts` | Suggest destination candidates with rationale | Yes |
| Itinerary | `src/agents/itinerary.agent.ts` | Build day-by-day itinerary via LLM, fetch flights and weather | Yes |
| Budget | `src/agents/budget.agent.ts` | Estimate total cost and flag budget issues via LLM | Yes |
| Packing | `src/agents/packing.agent.ts` | Generate weather/activity-aware packing list via LLM | Yes |
| Plan Synthesizer | `src/agents/plan-synthesizer.agent.ts` | Assemble final plan artifact and apply output guardrails via LLM | Yes |

## 3.2 Agent Contract

Every agent conforms to the same function signature:

```typescript
async (state: PlannerState, deps?: AgentDependencies): Promise<Partial<PlannerState>>
```

- **Input**: Read-only access to the full `PlannerState`
- **Output**: A partial state update containing only the fields the agent owns
- **Side Effects**: Agents may call external tools (flights, weather) or invoke LLMs via `withStructuredOutput`
- **Idempotency**: All agents return `{}` when their required inputs are missing, making them safe to invoke repeatedly

## 3.3 Requirement Parser Agent

**Purpose**: Convert a raw natural-language request into partially structured trip fields.

**Implementation** (`src/agents/requirement-parser.agent.ts`):

```
Input:  state.naturalLanguage
Output: parsedRequest, decisionLog
```

- Uses `model.withStructuredOutput(ExtractedRequestSchema)` where every field is nullable.
- Prompt instructs the model to extract dates (`YYYY-MM-DD`), budget (number), IATA codes, and interest keywords.
- Missing fields are filtered out before writing to `parsedRequest`.

**Decision Log Evidence**:
- Raw natural language input
- Number of extracted fields

## 3.4 Form Completer Agent

**Purpose**: Validate whether extracted fields are sufficient to assemble a complete `UserRequest`, or generate clarifying questions.

**Implementation** (`src/agents/form-completer.agent.ts`):

```
Input:  state.parsedRequest, state.naturalLanguage
Output: userRequest (if complete), pendingQuestions (if incomplete), decisionLog
```

- Uses `model.withStructuredOutput(FormCompletionSchema)` returning `isComplete`, `userRequest`, and `pendingQuestions`.
- Required fields for completeness: `travelStartDate`, `travelEndDate`, `budget`.
- Missing fields use sensible defaults (`adults=1`, `children=0`, `interests=[]`, `userId="anonymous"`, `requestText=original natural language`).
- If incomplete, returns 1–2 natural-language questions and ends the graph; the client resumes via `/plan/chat/resume`.

**Decision Log Evidence**:
- Whether all required fields were present
- Missing questions asked

## 3.5 Risk Guard Agent

**Purpose**: First and last line of defense against adversarial inputs and unsafe outputs.

**Implementation** (`src/agents/risk-guard.agent.ts`):

```
Input:  state.userRequest.requestText, state.finalPlan
Output: safetyFlags, decisionLog
```

- **LLM scan**: Uses `model.withStructuredOutput(RiskGuardSchema)` to semantically detect prompt injection attempts and unsafe output patterns. **Optimization**: The LLM scan is skipped on subsequent invocations within the same plan cycle if safety flags already exist from a previous risk-guard run — this avoids redundant LLM calls (~1-2s each) since the user request hasn't changed.
- **Rule scan**: `detectPromptInjection(...)` (`src/security/guardrails.ts`) applies regex patterns with zero-width character and homoglyph normalization. Rule-based checks always run (cheap).
- **Output scan**: If `finalPlan` exists, runs `detectUnsafeOutput(...)` on the summary.
- Flags are prefixed with `BLOCKED_PROMPT_INJECTION:` or `UNSAFE_OUTPUT:`.
- The router (`routeFromRiskGuard`) routes blocked requests directly to the plan synthesizer for a safe refusal.

**Patterns Detected** (rules):
- "ignore (all/previous/prior/earlier) instructions"
- "reveal the (system/developer/hidden/inner) prompt"
- "bypass (safety/guard/policy/restrictions/filters)"
- "act as ... without restrictions"
- "disable (security/guardrails/filters/safeguards)"
- "new instructions", "replace instructions", "forget instructions"
- "DAN mode", "jailbreak"

**Unsafe Output Patterns**:
- Bomb/weapon/explosive/firearm manufacture
- Illegal trafficking/smuggling
- Evading law enforcement/taxes
- Self-harm/suicide instructions
- Child exploitation/abuse

## 3.6 Preference Agent

**Purpose**: Convert unstructured user intent into a structured preference profile.

**Implementation** (`src/agents/preference.agent.ts`):

Uses `model.withStructuredOutput(PreferencesSchema)` with a prompt template:

```typescript
PreferencesSchema = z.object({
  travelStyle: z.enum(["relaxed", "balanced", "packed"]),
  prioritizedInterests: z.array(z.string().min(1)),
  preferredPace: z.enum(["slow", "normal", "fast"]),
  accommodationPreference: z.enum(["budget", "midrange", "premium"]),
});
```

If the user explicitly provided `interests` in the request, those override the model-extracted interests. This ensures user intent is not silently overwritten.

**Decision Log Evidence**:
- Budget value
- Extracted interest list
- Output travel profile style

## 3.7 Destination Agent

**Purpose**: Generate ranked destination candidates with supporting rationale.

**Implementation** (`src/agents/destination.agent.ts`):

Uses `model.withStructuredOutput(DestinationSuggestionsSchema)` where candidates include:

```typescript
DestinationCandidateSchema = z.object({
  name: z.string(),
  country: z.string(),
  iataCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  cityCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  rationale: z.string(),
});
```

**Fallback Logic**: If the user provided a `destinationHint`, `destinationCityCode`, and `destinationIata`, the agent prepends this as an explicit fallback candidate when it is not already present in the generated list. The final candidate list is capped to 3 entries.

**Prompt Context**:
- User request text
- Travel dates and budget
- Interests
- Travel style (from preferences)
- Destination hint (if any)

## 3.8 Itinerary Agent

**Purpose**: Construct a concrete day-by-day itinerary grounded in real flights and weather data.

**Implementation** (`src/agents/itinerary.agent.ts`):

### Flight Search

If `originIata` and destination IATA are available, calls `searchFlightOffers()` (Duffel integration) twice:
- **Outbound**: origin → destination on `travelStartDate`
- **Return**: destination → origin on `travelEndDate`

Flight options are ranked by `pickRecommendedFlightOption()` (`src/agents/flight-option-selection.ts`) using an O(n) min-find reduce, preferring flights arriving on or before the travel start date, then by earlier arrival, lower price, and earlier departure.

### Weather Risk Assessment

Calls `fetchWeatherRiskSummary()` (Open-Meteo integration) to get daily forecasts with risk levels:

- **HIGH**: Severe weather codes (thunderstorm, heavy snow, heavy rain) or precipitation probability >= 70%
- **MEDIUM**: Precipitation probability >= 40%
- **LOW**: Everything else

### Activity Generation

Uses `model.withStructuredOutput(ItineraryDraftSchema)` to generate the itinerary. The prompt includes:
- Destination, dates, travelers, budget, interests, style, pace
- Recommended outbound and return flight details
- Daily weather forecast with temperatures and risk levels

Instructions to the LLM:
- Mark arrival day as a light schedule; mark departure day for checkout and airport transfer.
- On high-risk weather days, prioritize indoor activities.
- Spread interests across days.

**Decision Log Evidence**:
- Number of outbound and return flight options found
- Number of high-risk weather days
- Generated itinerary days

## 3.9 Budget Agent

**Purpose**: Estimate total trip cost and determine feasibility against the user budget.

**Implementation** (`src/agents/budget.agent.ts`):

Uses `model.withStructuredOutput(BudgetAssessmentSchema)` with a prompt that includes:
- User budget limit
- Trip duration and nights
- Travelers (adults/children)
- Accommodation preference
- Selected outbound and return flight details and total flight cost
- Itinerary day themes

The LLM returns:
```typescript
BudgetAssessmentSchema = z.object({
  estimatedTotal: z.number().nonnegative(),
  budgetLimit: z.number().positive(),
  withinBudget: z.boolean(),
  optimizationTips: z.array(z.string()),
});
```

**Risk Flag**: `BUDGET_EXCEEDED` when `estimatedTotal > budgetLimit`.

**Decision Log Evidence**:
- Estimated total and budget limit
- Accommodation preference
- Selected flight offer IDs and flight cost

## 3.10 Packing Agent

**Purpose**: Generate a contextual packing list based on weather forecasts and planned activities.

**Implementation** (`src/agents/packing.agent.ts`):

Uses `model.withStructuredOutput(PackingListSchema)` with a prompt that includes:
- Destination and travel dates
- Travelers (adults/children)
- Daily weather forecast (temperature, precipitation, risk)
- Itinerary day themes and activities

The LLM returns a concise, deduplicated packing list of essential items.

**Decision Log Evidence**:
- Forecast days and high-risk days
- Number of packing items generated

## 3.11 Plan Synthesizer Agent

**Purpose**: Assemble all agent outputs into a final, validated plan artifact.

**Implementation** (`src/agents/plan-synthesizer.agent.ts`):

### Safe Refusal Path

If `BLOCKED_PROMPT_INJECTION` is present in `safetyFlags`, the synthesizer produces a refusal summary instead of a travel plan.

### Normal Path

Uses `model.withStructuredOutput(PlanSynthesisSchema)` to generate:
- **Summary**: Human-readable trip overview with destination, days, and budget status
- **Safety flags**: Any additional flags detected by the LLM

Then assembles the final artifact via `buildFinalPlan()` which accepts individual state fields (`itineraryDraft`, `budgetAssessment`, `packingList`, `existingSafetyFlags`) instead of the full state object, avoiding non-null assertions:
- **Selected Destination**: First candidate from `destinationCandidates`
- **Selected Flight**: `selectedFlightOfferId` and `selectedReturnFlightOfferId` (if available)
- **Itinerary**: Full `itineraryDraft`
- **Budget**: Full `budgetAssessment`
- **Packing List**: Full `packingList`
- **Safety Flags**: All accumulated flags merged with LLM-detected and rule-detected flags

### Output Guardrails

Before returning, the synthesizer runs `detectUnsafeOutput()` on the generated summary. Any unsafe patterns are added to `safetyFlags`.

The final plan is validated against `FinalPlanSchema` using Zod before being written to state.

## 3.12 Agent Dependency Injection

Agents accept dependencies to support testing with fakes and stubs:

| Agent | Dependencies |
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

Default dependencies use production implementations (real OpenAI model, real Duffel/Open-Meteo APIs), while tests inject `FakeStructuredChatModel` and stubbed tool functions.

## 3.13 Decision Log

Every agent appends a `DecisionLogEntry` to `state.decisionLog`:

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

This creates an immutable, append-only audit trail of every planning decision, evidence considered, and risk flagged. The log is returned in API responses and printed in CLI output.
