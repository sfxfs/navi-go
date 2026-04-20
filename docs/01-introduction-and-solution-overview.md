# 1. Introduction and Solution Overview

## 1.1 Problem Statement

Travel planning is a combinatorial optimization problem that involves balancing multiple constraints and preferences simultaneously: budget limits, flight availability, weather conditions, personal interests, accommodation quality, and safety considerations. Traditional rule-based travel engines provide rigid, template-driven recommendations that fail to adapt to nuanced user intent.

Modern Large Language Models (LLMs) offer natural language understanding and generative planning capabilities, but a single monolithic prompt is insufficient for reliable multi-domain travel planning. Such an approach suffers from hallucination, inconsistent reasoning across planning dimensions, and a lack of verifiability.

## 1.2 Solution: NaviGo

NaviGo is a multi-agent travel planning system built on **LangChain/LangGraph** that decomposes travel planning into specialized, collaborative AI agents. Each agent owns a distinct domain of expertise (preferences, destination selection, itinerary construction, budget analysis, packing recommendations, and safety review). A supervisor-style router coordinates agent execution, while a persistent state graph ensures checkpointed, resumable planning sessions.

### Key Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Domain Decomposition** | Each planning concern is isolated in a dedicated agent with typed inputs/outputs |
| **Stateful Orchestration** | `StateGraph` over `PlannerState` with thread-level checkpointing via PostgreSQL |
| **External Grounding** | Flight search (Duffel) and weather forecasts (Open-Meteo) are fetched via typed tool calls |
| **Dual Interface** | Same compiled graph served over HTTP (Fastify) and CLI with identical behavior |
| **Safety by Design** | Risk guard agent runs before and after each planning phase; prompt injection and unsafe output detection are mandatory |

## 1.3 Capabilities

- **Preference Extraction**: Derives structured travel preferences (style, pace, accommodation tier, prioritized interests) from free-text user requests using OpenAI structured output.
- **Destination Suggestion**: Generates ranked destination candidates with IATA/city codes and rationales, respecting user hints and budget constraints.
- **Itinerary & Flight Synthesis**: Drafts day-by-day itineraries with curated place anchors, fetches live flight offers, and integrates weather risk assessments with indoor fallback recommendations.
- **Budget Feasibility**: Estimates total trip cost (flights + accommodation tier + daily spend) and flags over-budget scenarios with optimization tips.
- **Packing Intelligence**: Generates contextual packing lists based on weather forecasts and planned activities.
- **Safety Guardrails**: Detects prompt injection attempts and unsafe output patterns at the graph boundary, blocking or flagging suspicious content.

## 1.4 Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ (ESM) |
| Language | TypeScript 5.6+ with `NodeNext` module resolution |
| AI Framework | LangChain / LangGraph |
| LLM Provider | OpenAI (`gpt-4o-mini` default) |
| External APIs | Duffel (flight offers), Open-Meteo (weather forecasts + geocoding) |
| Persistence | PostgreSQL via `@langchain/langgraph-checkpoint-postgres` |
| Observability | LangSmith (optional, environment-gated) |
| Server | Fastify 5 |
| Testing | Vitest |
| Validation | Zod schemas at all boundaries |

## 1.5 High-Level Flow

```
User Request (natural language + constraints)
         |
         v
  [risk_guard] -- Scans for injection / unsafe patterns
         |
         v
  [supervisor] -- Decides next agent based on state gaps
         |
    +----+----+----+----+----+
    |         |    |    |    |
    v         v    v    v    v
[preference] [destination] [itinerary] [budget] [packing]
    |         |    |    |    |
    +----+----+----+----+----+
         |
         v
  [plan_synthesizer] -- Assembles final artifact
         |
         v
  Final Plan (JSON: summary, itinerary, budget, packing, safetyFlags, decisionLog)
```

Each agent contributes a `Partial<PlannerState>` update and appends to the shared `decisionLog`, creating an auditable trace of every planning step.

## 1.6 Project Repository

- **Repository**: `navi-go`
- **Entry Point**: `src/index.ts` (API mode default; `--cli` for CLI mode)
- **Source Language**: TypeScript (`.ts` with `.js` import specifiers for ESM compatibility)
- **License**: MIT
