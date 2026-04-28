# 2. System Architecture

## 2.1 Architectural Overview

NaviGo follows a **multi-agent state graph** architecture. The core abstraction is a compiled `StateGraph` from LangGraph that iteratively invokes specialized agents, each reading from and writing to a shared, strongly-typed state object. A supervisor node decides which agent runs next based on which state fields are still missing or incomplete.

The system is designed around three layers:

1. **Interface Layer**: HTTP API (Fastify) and CLI runner — both invoke the same compiled graph.
2. **Orchestration Layer**: Graph builder, state schema, routing logic, and checkpointing.
3. **Agent & Tool Layer**: Domain-specific agents and external API integrations.

```
+------------------+------------------+------------------+
|   Interface      |   Orchestration  |   Agent & Tool   |
+------------------+------------------+------------------+
| API Routes       | StateGraph       | Requirement      |
| (plan.route.ts)  | (builder.ts)     | Parser           |
|                  |                  | (req-parser.     |
| CLI Runner       | PlannerState     |  agent.ts)       |
| (run-plan.ts)    | (state.ts)       | Form Completer   |
|                  |                  | (form-completer. |
| Fastify Server   | Router           |  agent.ts)       |
| (server.ts)      | (routes.ts)      | Preference Agent |
|                  |                  | (preference.     |
|                  | Checkpointer      |  agent.ts)       |
|                  | (checkpointer.ts)| Destination Agent|
|                  |                  | (destination.    |
|                  |                  |  agent.ts)       |
|                  |                  | Itinerary Agent  |
|                  |                  | (itinerary.      |
|                  |                  |  agent.ts)       |
|                  |                  | Budget Agent     |
|                  |                  | (budget.agent.ts)|
|                  |                  | Packing Agent    |
|                  |                  | (packing.agent.ts|
|                  |                  | )                |
|                  |                  | Risk Guard       |
|                  |                  | (risk-guard.     |
|                  |                  |  agent.ts)       |
|                  |                  | Plan Synthesizer |
|                  |                  | (plan-synthesizer|
|                  |                  | .agent.ts)       |
+------------------+------------------+------------------+
|                                     | Duffel Flight    |
|                                     | (duffel-flight.  |
|                                     |  tool.ts)        |
|                                     | Open-Meteo       |
|                                     | Weather          |
|                                     | (openmeteo-      |
|                                     |  weather.tool.ts)|
+------------------+------------------+------------------+
```

## 2.2 State Schema

The graph state is defined in `src/graph/state.ts` using LangGraph `Annotation.Root`. Every field has a reducer function that controls how agent outputs merge into the running state.

### PlannerState Fields

| Field | Type | Reducer | Description |
|-------|------|---------|-------------|
| `userRequest` | `UserRequest \| null` | Replace | Parsed user input with dates, budget, IATA codes, interests |
| `preferences` | `Preferences \| null` | Replace | Extracted travel style, pace, accommodation tier |
| `destinationCandidates` | `DestinationCandidate[]` | Replace | Ranked destinations with rationale |
| `flightOptions` | `FlightOption[]` | Replace | Live outbound flight offers from Duffel |
| `returnFlightOptions` | `FlightOption[]` | Replace | Live return flight offers from Duffel |
| `weatherRisks` | `WeatherRiskSummary \| null` | Replace | Daily weather forecasts with risk levels |
| `itineraryDraft` | `ItineraryDay[]` | Replace | Day-by-day activities and themes |
| `budgetAssessment` | `BudgetAssessment \| null` | Replace | Estimated total vs. limit with tips |
| `packingList` | `string[]` | Replace | Generated packing items |
| `selectedFlightOfferId` | `string \| null` | Replace | Recommended outbound flight offer ID |
| `selectedReturnFlightOfferId` | `string \| null` | Replace | Recommended return flight offer ID |
| `safetyFlags` | `string[]` | Set union | Accumulated risk flags (deduplicated) |
| `decisionLog` | `DecisionLogEntry[]` | Concat | Auditable trace of every agent step |
| `finalPlan` | `FinalPlan \| null` | Replace | Synthesized final artifact |
| `naturalLanguage` | `string \| null` | Replace | Raw natural-language user input |
| `parsedRequest` | `ParsedRequest \| null` | Replace | Partially extracted request fields |
| `pendingQuestions` | `string[] \| null` | Replace | Clarifying questions for missing fields |

### Replace vs. Union Reducers

Most fields use a **replace reducer** (`(_, next) => next`) because agents produce complete snapshots of their domain. Only `safetyFlags` uses a **set union** to accumulate flags across phases, and `decisionLog` uses concatenation to preserve history.

## 2.3 Graph Builder

`src/graph/builder.ts` assembles the `StateGraph`:

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

Every agent edge loops back through `risk_guard`, ensuring continuous safety scanning throughout the planning lifecycle. To reduce latency and cost, the risk guard skips the LLM scan on subsequent invocations when safety flags already exist from a previous run in the same plan cycle — only cheap rule-based checks are re-run.

## 2.4 Routing Logic

The router (`src/graph/routes.ts`) implements state-driven conditional edges:

### `routeFromStart`

- If `naturalLanguage` is present and `parsedRequest` is missing → `requirement_parser`
- If `parsedRequest` is present and `userRequest` is missing → `form_completer`
- If `userRequest` is present → `risk_guard`
- Otherwise → `END`

### `routeFromFormCompleter`

- If `pendingQuestions` is non-empty → `END` (wait for user answers via `/plan/chat/resume`)
- If `userRequest` is assembled → `risk_guard`
- Otherwise → `END`

### `routeFromRiskGuard`

- If `isBlockedByRiskGuard(state)` is true and no final plan exists → `plan_synthesizer` (safe refusal)
- If `finalPlan` is already set → `END`
- Otherwise → `supervisor`

### `routeFromSupervisor`

Checks state fields in dependency order:

1. No `userRequest` → `END`
2. No `preferences` → `preference_agent`
3. No `destinationCandidates` → `destination_agent`
4. Missing `itineraryDraft` or `weatherRisks` → `itinerary_agent`
5. No `budgetAssessment` → `budget_agent`
6. Empty `packingList` → `packing_agent`
7. No `finalPlan` → `plan_synthesizer`
8. Otherwise → `END`

## 2.5 Persistence & Checkpointing

The graph is compiled with a `BaseCheckpointSaver`, enabling thread-level state persistence and recovery.

### PostgreSQL Saver (Production)

```typescript
const saver = PostgresSaver.fromConnString(connectionString);
await saver.setup();
```

Used by default in `buildPlannerGraph()`. Requires `POSTGRES_URL`.

### In-Memory Saver (Tests)

```typescript
const saver = new MemorySaver();
```

Used in unit and integration tests to avoid external database dependencies.

### State Recovery

The API supports `GET /plan/:threadId` to retrieve the current checkpointed state for any thread, including `next` nodes, `values`, `metadata`, and `createdAt`. This enables clients to poll planning progress or resume interrupted sessions.

## 2.6 Interfaces

### HTTP API

Implemented in `src/interfaces/api/server.ts` and `src/interfaces/api/routes/plan.route.ts`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/plan` | `POST` | Invoke planner graph with a structured `userRequest` and `threadId` |
| `/plan/chat` | `POST` | Submit natural-language request; may return `pendingQuestions` |
| `/plan/chat/resume` | `POST` | Answer pending clarifying questions and continue planning |
| `/plan/:threadId` | `GET` | Retrieve checkpointed state by thread |
| `/health` | `GET` | Health check (returns `status`, `db`, `uptime`) |

The POST handlers validate payloads with Zod, catch `ToolError` and map it to `502 Bad Gateway`, and return `finalPlan`, `safetyFlags`, and `decisionLog`. The `/plan/chat/resume` endpoint validates the merged parsed-request payload with `safeParse` to prevent injecting invalid fields on resume.

### CLI Runner

Implemented in `src/interfaces/cli/run-plan.ts`:

Accepts flags: `--thread-id`, `--request`, `--user-id`, `--origin`, `--destination-hint`, `--destination-city`, `--destination-iata`, `--start-date`, `--end-date`, `--budget`, `--adults`, `--children`, `--interests`.

Prints final plan as formatted JSON to stdout.

## 2.7 Error Handling & Resilience

### Tool Errors

All external API calls go through `requestJson()` in `src/tools/common/http.ts`, which provides:

- **Timeout**: 15s default with `AbortController`
- **Retry**: 2 retries with exponential backoff and jitter (`150ms × 2^attempt × random(0.85, 1.15)`)
- **Typed errors**: `ToolError` with codes (`AUTH_ERROR`, `RATE_LIMIT`, `UPSTREAM_TIMEOUT`, `UPSTREAM_BAD_RESPONSE`, `NETWORK_ERROR`, `VALIDATION_ERROR`)

### Schema Validation

Zod schemas guard:
- Environment variables (`src/config/env.ts`)
- API request bodies (`plan.route.ts`)
- LLM structured outputs (agent-level `withStructuredOutput`)
- External API responses (flight and weather tools)

### Fail-Safe Agent Behavior

Every agent returns `{}` (no-op) when its required inputs are missing, making the graph resilient to partial states and out-of-order execution.

## 2.8 Rate Limiting & Static Assets

The Fastify server registers:
- `@fastify/rate-limit` with 100 requests per minute.
- `@fastify/static` to serve files from the `public/` directory (e.g., `index.html` at `/`).
