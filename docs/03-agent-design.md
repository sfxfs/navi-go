# 3. Agent Design

NaviGo implements a **specialized multi-agent pattern** where each agent owns a single planning domain. Agents communicate through a shared, strongly-typed state rather than direct message passing. This design decouples agent implementations, enables independent testing, and ensures that the supervisor router can reason about planning progress by inspecting state completeness.

## 3.1 Agent Taxonomy

| Agent | File | Responsibility | LLM Required? |
|-------|------|----------------|---------------|
| Risk Guard | `src/agents/risk-guard.agent.ts` | Scan inputs/outputs for prompt injection and unsafe content | No |
| Preference | `src/agents/preference.agent.ts` | Extract structured preferences from free-text request | Yes |
| Destination | `src/agents/destination.agent.ts` | Suggest destination candidates with rationale | Yes |
| Itinerary | `src/agents/itinerary.agent.ts` | Build day-by-day itinerary, fetch flights and weather | No* |
| Budget | `src/agents/budget.agent.ts` | Estimate total cost and flag budget issues | No |
| Packing | `src/agents/packing.agent.ts` | Generate weather/activity-aware packing list | No |
| Plan Synthesizer | `src/agents/plan-synthesizer.agent.ts` | Assemble final plan artifact and apply output guardrails | No |

\* The itinerary agent uses deterministic logic for activity selection but delegates to external tools (flight search, weather) for live data.

## 3.2 Agent Contract

Every agent conforms to the same function signature:

```typescript
async (state: PlannerState, deps?: AgentDependencies): Promise<Partial<PlannerState>>
```

- **Input**: Read-only access to the full `PlannerState`
- **Output**: A partial state update containing only the fields the agent owns
- **Side Effects**: Agents may call external tools (flights, weather) or invoke LLMs via `withStructuredOutput`
- **Idempotency**: All agents return `{}` when their required inputs are missing, making them safe to invoke repeatedly

## 3.3 Risk Guard Agent

**Purpose**: First and last line of defense against adversarial inputs and unsafe outputs.

**Implementation** (`src/agents/risk-guard.agent.ts`):

```
Input:  state.userRequest.requestText, state.finalPlan
Output: safetyFlags, decisionLog
```

- Detects prompt injection via regex patterns (`src/security/guardrails.ts`)
- Detects unsafe output patterns if a final plan already exists
- Sets `BLOCKED_PROMPT_INJECTION` flag when injection is detected
- The router (`routeFromRiskGuard`) routes blocked requests directly to the plan synthesizer for a safe refusal

**Patterns Detected**:
- "ignore (all/previous/prior) instructions"
- "reveal the system prompt"
- "bypass safety/policy"
- "act as ... without restrictions"
- "disable security/guardrails"

## 3.4 Preference Agent

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

## 3.5 Destination Agent

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

## 3.6 Itinerary Agent

**Purpose**: Construct a concrete day-by-day itinerary grounded in real flights and weather data.

**Implementation** (`src/agents/itinerary.agent.ts`):

### Flight Search

If `originIata` and destination IATA are available, calls `searchFlightOffers()` (Duffel integration) to fetch live offers.

### Weather Risk Assessment

Calls `fetchWeatherRiskSummary()` (Open-Meteo integration) to get daily forecasts with risk levels:

- **HIGH**: Severe weather codes (thunderstorm, heavy snow, heavy rain) or precipitation probability >= 70%
- **MEDIUM**: Precipitation probability >= 40%
- **LOW**: Everything else

### Activity Generation

Activities are built from **curated place anchors** per city code (e.g., `TYO` -> Asakusa, Ueno Park, Shibuya) with a deterministic fallback for unknown cities (`{city} Old Town`, `{city} Central Market`, etc.).

For each day:
- **High-risk weather**: Indoor-focused activities (museums, cultural centers)
- **Normal weather**: Outdoor highlight tours and neighborhood exploration

Activities rotate across place anchors using modulo indexing to avoid duplication.

**Decision Log Evidence**:
- Number of flight options found
- Number of high-risk weather days
- Number of place anchors used

## 3.7 Budget Agent

**Purpose**: Estimate total trip cost and determine feasibility against the user budget.

**Implementation** (`src/agents/budget.agent.ts`):

### Cost Model

```
total = cheapestFlight + lodgingEstimate + dailySpendEstimate

lodgingEstimate = nightlyRate[accommodationPreference] * tripNights
  where nightlyRate = { budget: 90, midrange: 160, premium: 300 }

dailySpendEstimate = (adults * 85 + children * 45) * tripDays
```

### Output

```typescript
BudgetAssessmentSchema = z.object({
  estimatedTotal: z.number().nonnegative(),
  budgetLimit: z.number().positive(),
  withinBudget: z.boolean(),
  optimizationTips: z.array(z.string()),
});
```

### Optimization Tips

- **Within budget**: Suggests keeping a contingency reserve
- **Over budget**: Suggests lowering accommodation tier, reducing paid activities, or considering alternate airports

**Risk Flag**: `BUDGET_EXCEEDED` when `estimatedTotal > budgetLimit`.

## 3.8 Packing Agent

**Purpose**: Generate a contextual packing list based on weather forecasts and planned activities.

**Implementation** (`src/agents/packing.agent.ts`):

### Base Items (always included)
- Passport and travel documents
- Phone charger and power adapter
- Daily medication kit

### Weather-Driven Items
- Precipitation >= 50%: compact umbrella, waterproof jacket
- Temperature min < 10C: warm mid-layer
- Temperature max >= 28C: sunscreen, reusable water bottle

### Activity-Driven Items
- Tours/exploration: comfortable walking shoes
- Indoor activities: light indoor layers

Items are deduplicated via `Set` before output.

## 3.9 Plan Synthesizer Agent

**Purpose**: Assemble all agent outputs into a final, validated plan artifact.

**Implementation** (`src/agents/plan-synthesizer.agent.ts`):

### Safe Refusal Path

If `BLOCKED_PROMPT_INJECTION` is present in `safetyFlags`, the synthesizer produces a refusal summary instead of a travel plan.

### Normal Path

Assembles:
- **Summary**: Human-readable trip overview with destination, days, and budget status
- **Selected Destination**: First candidate from `destinationCandidates`
- **Selected Flight**: First option from `flightOptions` (if available)
- **Itinerary**: Full `itineraryDraft`
- **Budget**: Full `budgetAssessment`
- **Packing List**: Full `packingList`
- **Safety Flags**: All accumulated flags

### Output Guardrails

Before returning, the synthesizer runs `detectUnsafeOutput()` on the generated summary. Any unsafe patterns are added to `safetyFlags`.

The final plan is validated against `FinalPlanSchema` using Zod before being written to state.

## 3.10 Agent Dependency Injection

Agents accept dependencies to support testing with fakes and stubs:

| Agent | Dependencies |
|-------|-------------|
| `preference_agent` | `{ model: ChatOpenAI }` |
| `destination_agent` | `{ model: ChatOpenAI }` |
| `itinerary_agent` | `{ searchFlights, fetchWeather }` |

Default dependencies use production implementations (real OpenAI model, real Duffel/Open-Meteo APIs), while tests inject `FakeStructuredChatModel` and stubbed tool functions.

## 3.11 Decision Log

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
