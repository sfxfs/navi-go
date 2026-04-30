import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildPlannerGraph, type PlannerGraphDependencies } from "../../src/graph/builder.js";
import { createInMemoryCheckpointer } from "../../src/persistence/checkpointer.js";
import { getEnv } from "../../src/config/env.js";
import { FinalPlanSchema, type FinalPlan } from "../../src/graph/state.js";
import { searchFlightOffers, type FlightSearchInput } from "../../src/tools/flights/duffel-flight.tool.js";
import { fetchWeatherRiskSummary, type WeatherSearchInput } from "../../src/tools/weather/openmeteo-weather.tool.js";
import type { WeatherRiskSummary, FlightOption } from "../../src/graph/state.js";

/**
 * LLM-as-Judge Quality Eval
 *
 * Runs the full planner with real LLM on representative scenarios,
 * then uses a separate LLM call to judge output quality on multiple
 * dimensions. Designed to catch content-quality regressions that
 * schema-level evals cannot detect.
 *
 * Requires OPENAI_API_KEY. Gated on env presence.
 * DUFFEL_API_TOKEN is optional — falls back to empty flight results.
 * Open-Meteo weather uses retry + fallback for transient network errors.
 */

const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  threadId: string;
  request: {
    userId: string;
    requestText: string;
    originIata: string;
    destinationHint: string;
    destinationCityCode: string;
    destinationIata: string;
    travelStartDate: string;
    travelEndDate: string;
    budget: number;
    adults: number;
    children: number;
    interests: string[];
  };
  criteria: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "Tokyo culture trip",
    threadId: "eval-judge-tokyo",
    request: {
      userId: "eval-user",
      requestText: "Plan a 3-day culture and food trip to Tokyo",
      originIata: "SFO",
      destinationHint: "Tokyo",
      destinationCityCode: "TYO",
      destinationIata: "HND",
      travelStartDate: "2026-10-10",
      travelEndDate: "2026-10-12",
      budget: 3000,
      adults: 1,
      children: 0,
      interests: ["culture", "food", "history"],
    },
    criteria: [
      "Itinerary covers 3 days with coherent daily themes",
      "Budget estimate under $3000",
      "Includes at least one food-related activity",
      "Weather notes present for each day",
      "Packing list relevant to Tokyo in October (autumn)",
    ],
  },
  {
    name: "Paris art weekend",
    threadId: "eval-judge-paris",
    request: {
      userId: "eval-user",
      requestText: "A weekend art trip to Paris",
      originIata: "JFK",
      destinationHint: "Paris",
      destinationCityCode: "PAR",
      destinationIata: "CDG",
      travelStartDate: "2026-11-07",
      travelEndDate: "2026-11-09",
      budget: 4000,
      adults: 2,
      children: 0,
      interests: ["art", "architecture", "shopping"],
    },
    criteria: [
      "Itinerary covers 3 days with art/architecture focus",
      "Budget reflects 2 adults",
      "Packing list appropriate for Paris in November (cold, rain possible)",
      "At least one museum or gallery mentioned",
    ],
  },
  {
    name: "Bangkok budget trip",
    threadId: "eval-judge-bangkok",
    request: {
      userId: "eval-user",
      requestText: "Cheap 4-day Bangkok adventure",
      originIata: "SIN",
      destinationHint: "Bangkok",
      destinationCityCode: "BKK",
      destinationIata: "BKK",
      travelStartDate: "2026-12-15",
      travelEndDate: "2026-12-18",
      budget: 800,
      adults: 1,
      children: 0,
      interests: ["adventure", "food", "temples"],
    },
    criteria: [
      "Budget optimization tips present given tight $800 budget",
      "Packing list reflects Bangkok's tropical December weather",
      "At least one temple activity",
      "Daily themes make sense for a single traveler",
    ],
  },
];

// ---------------------------------------------------------------------------
// Judge schema
// ---------------------------------------------------------------------------

const JudgeOutputSchema = z.object({
  itineraryQuality: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Are daily themes coherent? Activities suitable for destination and interests? Weather factored into planning?",
    ),
  budgetAccuracy: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Is estimated total realistic relative to the budget limit? Optimization tips actionable and specific?",
    ),
  packingRelevance: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Does the packing list match the destination, season, and planned activities?",
    ),
  safetyFlagsAccuracy: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Are safety flags justified? Any obviously missing risks (e.g., weather warnings)?",
    ),
  overallCoherence: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Does the plan read as a cohesive whole? Do all sections (summary, itinerary, budget, packing) align?",
    ),
  criticalIssues: z
    .array(z.string())
    .describe(
      "Concrete, specific problems. Empty if none. Examples: missing an entire itinerary day, recommending unsafe activity, budget estimate off by >50%, contradictory packing advice.",
    ),
  summary: z.string().describe("One-sentence overall quality assessment."),
});

type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

// ---------------------------------------------------------------------------
// Judge function
// ---------------------------------------------------------------------------

async function judgePlan(
  plan: FinalPlan,
  scenario: Scenario,
  model: ChatOpenAI,
): Promise<JudgeOutput> {
  const structuredJudge = model.withStructuredOutput(JudgeOutputSchema, {
    name: "QualityJudge",
  });

  const itineraryText = plan.itinerary
    .map(
      (d) =>
        `  ${d.date}: ${d.theme}\n    Activities: ${d.activities.join("; ")}${d.weatherNote ? `\n    Weather note: ${d.weatherNote}` : ""}`,
    )
    .join("\n");

  const prompt = `You are an expert travel quality evaluator. Score the following AI-generated travel plan against the scenario criteria.

SCENARIO
  Name: ${scenario.name}
  Budget: $${scenario.request.budget}
  Travelers: ${scenario.request.adults} adult(s), ${scenario.request.children} child(ren)
  Dates: ${scenario.request.travelStartDate} to ${scenario.request.travelEndDate}
  Interests: ${scenario.request.interests.join(", ")}

EVALUATION CRITERIA
${scenario.criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}

PLAN TO EVALUATE
  Summary: ${plan.summary}
  Selected destination: ${plan.selectedDestination}
  Budget: $${plan.budget.estimatedTotal} / $${plan.budget.budgetLimit} (${plan.budget.withinBudget ? "within" : "EXCEEDS"} budget)
  Optimization tips: ${plan.budget.optimizationTips.join("; ") || "none"}

  Itinerary (${plan.itinerary.length} days):
${itineraryText}

  Packing list: ${plan.packingList.join(", ") || "none"}
  Safety flags: ${plan.safetyFlags.length > 0 ? plan.safetyFlags.join(", ") : "none"}

Score each dimension 0–10. Only populate criticalIssues with specific, concrete problems that would make this plan unusable or misleading for a real traveler. Leave criticalIssues empty if the plan is acceptable.`;

  const result = await structuredJudge.invoke(prompt);
  return result;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runScenario(
  scenario: Scenario,
  plannerDeps: PlannerGraphDependencies,
  judgeModel: ChatOpenAI,
): Promise<{ plan: FinalPlan; judge: JudgeOutput }> {
  const graph = await buildPlannerGraph({
    ...plannerDeps,
    checkpointer: createInMemoryCheckpointer(),
  });

  const result = await graph.invoke(
    { userRequest: scenario.request },
    { configurable: { thread_id: scenario.threadId } },
  );

  const parsed = FinalPlanSchema.safeParse(result.finalPlan);
  if (!parsed.success) {
    throw new Error(
      `FinalPlan schema validation failed for "${scenario.name}": ${parsed.error.message}`,
    );
  }

  const plan = parsed.data;
  const judge = await judgePlan(plan, scenario, judgeModel);
  return { plan, judge };
}

// ---------------------------------------------------------------------------
// Minimal acceptance thresholds
// ---------------------------------------------------------------------------

const MIN_DIMENSION_SCORE = 5;
const MIN_OVERALL_SCORE = 6;
const MAX_CRITICAL_ISSUES = 0;

function computeComposite(judge: JudgeOutput): number {
  return (
    (judge.itineraryQuality +
      judge.budgetAccuracy +
      judge.packingRelevance +
      judge.safetyFlagsAccuracy +
      judge.overallCoherence) /
    5
  );
}

// ---------------------------------------------------------------------------
// Fallback weather for transient network failures
// ---------------------------------------------------------------------------

const buildFallbackWeather = (
  input: WeatherSearchInput,
): WeatherRiskSummary => {
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  const days: WeatherRiskSummary['daily'] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push({
      date: d.toISOString().slice(0, 10),
      weatherCode: 3, // Overcast
      temperatureMax: 20,
      temperatureMin: 10,
      precipitationProbabilityMax: 30,
      riskLevel: 'LOW' as const,
    });
  }
  return {
    location: input.destination,
    timezone: undefined,
    daily: days,
    highRiskDates: [],
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LLM-as-judge quality eval", () => {
  it.skipIf(!hasOpenAiKey)(
    "[blocked] OPENAI_API_KEY is not configured for LLM-as-judge eval",
    () => {
      expect(true).toBe(true);
    },
  );

  it.skipIf(!hasOpenAiKey)(
    "runs planner on 3 scenarios and judges output quality",
    async () => {
      const env = getEnv();

      const plannerModel = new ChatOpenAI({
        apiKey: env.OPENAI_API_KEY!,
        model: env.OPENAI_MODEL,
        temperature: 0.2,
      });

      // Use a lower temperature for judging — we want consistent scores
      const judgeModel = new ChatOpenAI({
        apiKey: env.OPENAI_API_KEY!,
        model: env.OPENAI_MODEL,
        temperature: 0.1,
      });

      const hasDuffel = Boolean(env.DUFFEL_API_TOKEN);
      const resilientFetchWeather = async (
        input: WeatherSearchInput,
      ): Promise<WeatherRiskSummary> => {
        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await fetchWeatherRiskSummary(input);
          } catch (err) {
            const isTransient =
              err instanceof Error &&
              (err.message.includes('NETWORK_ERROR') ||
                err.message.includes('fetch failed'));
            if (isTransient && attempt < maxRetries) {
              console.log(
                `  [eval] Weather fetch transient error (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`,
              );
              await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
              continue;
            }
            if (attempt === maxRetries) {
              console.log(
                `  [eval] Weather fetch failed after ${maxRetries + 1} attempts — using fallback weather data`,
              );
              return buildFallbackWeather(input);
            }
            throw err;
          }
        }
        // Unreachable, but TypeScript needs it
        return buildFallbackWeather(input);
      };

      const resilientSearchFlights = async (
        input: FlightSearchInput,
      ): Promise<FlightOption[]> => {
        if (!hasDuffel) {
          console.log(
            "  [eval] DUFFEL_API_TOKEN not set — using empty flight results",
          );
          return [];
        }
        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await searchFlightOffers(input);
          } catch (err) {
            const isTransient =
              err instanceof Error &&
              (err.message.includes('NETWORK_ERROR') ||
                err.message.includes('fetch failed'));
            if (isTransient && attempt < maxRetries) {
              console.log(
                `  [eval] Flight search transient error (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`,
              );
              await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
              continue;
            }
            if (attempt === maxRetries) {
              console.log(
                `  [eval] Flight search failed after ${maxRetries + 1} attempts — using empty results`,
              );
              return [];
            }
            throw err;
          }
        }
        return [];
      };

      const plannerDeps: PlannerGraphDependencies = {
        model: plannerModel,
        itineraryAgentDependencies: {
          searchFlights: resilientSearchFlights,
          fetchWeather: resilientFetchWeather,
        },
      };

      let totalComposite = 0;
      const failures: string[] = [];

      for (const scenario of SCENARIOS) {
        const label = `[eval] Scenario: ${scenario.name}`;
        console.log(`${label} — running planner...`);

        const { judge } = await runScenario(
          scenario,
          plannerDeps,
          judgeModel,
        );

        const composite = computeComposite(judge);
        totalComposite += composite;

        console.log(`${label} — judge scores:`);
        console.log(
          `  itinerary=${judge.itineraryQuality} budget=${judge.budgetAccuracy} packing=${judge.packingRelevance} safety=${judge.safetyFlagsAccuracy} overall=${judge.overallCoherence}`,
        );
        console.log(`  composite=${composite.toFixed(1)}`);
        console.log(`  summary: ${judge.summary}`);

        if (judge.criticalIssues.length > 0) {
          console.log(`  critical issues: ${judge.criticalIssues.join("; ")}`);
        }

        // Per-dimension checks
        if (judge.itineraryQuality < MIN_DIMENSION_SCORE) {
          failures.push(
            `${scenario.name}: itineraryQuality ${judge.itineraryQuality} < ${MIN_DIMENSION_SCORE}`,
          );
        }
        if (judge.budgetAccuracy < MIN_DIMENSION_SCORE) {
          failures.push(
            `${scenario.name}: budgetAccuracy ${judge.budgetAccuracy} < ${MIN_DIMENSION_SCORE}`,
          );
        }
        if (judge.packingRelevance < MIN_DIMENSION_SCORE) {
          failures.push(
            `${scenario.name}: packingRelevance ${judge.packingRelevance} < ${MIN_DIMENSION_SCORE}`,
          );
        }
        if (judge.overallCoherence < MIN_OVERALL_SCORE) {
          failures.push(
            `${scenario.name}: overallCoherence ${judge.overallCoherence} < ${MIN_OVERALL_SCORE}`,
          );
        }
        if (judge.criticalIssues.length > MAX_CRITICAL_ISSUES) {
          failures.push(
            `${scenario.name}: ${judge.criticalIssues.length} critical issue(s) — ${judge.criticalIssues.join("; ")}`,
          );
        }
      }

      const avgComposite = totalComposite / SCENARIOS.length;
      console.log(`\n[eval] Average composite score: ${avgComposite.toFixed(1)} / 10`);

      if (failures.length > 0) {
        console.log(`[eval] FAILURES:`);
        for (const f of failures) {
          console.log(`  - ${f}`);
        }
      }

      expect(failures).toHaveLength(0);
      expect(avgComposite).toBeGreaterThanOrEqual(MIN_OVERALL_SCORE);
    },
    300_000, // 5-minute timeout — real LLM runs 3 scenarios sequentially
  );
});
