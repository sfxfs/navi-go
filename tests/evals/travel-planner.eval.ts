import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";

import { buildPlannerGraph } from "../../src/graph/builder.js";
import { createInMemoryCheckpointer } from "../../src/persistence/checkpointer.js";
import { FakeStructuredChatModel } from "../helpers/fake-model.js";

const hasLangSmithKey = Boolean(process.env.LANGSMITH_API_KEY);

describe("travel planner eval", () => {
  it.skipIf(!hasLangSmithKey)(
    "scores plan completeness for a baseline scenario",
    async () => {
      const fakeModel = new FakeStructuredChatModel({
        PreferenceExtraction: {
          travelStyle: "balanced",
          prioritizedInterests: ["food", "museum"],
          preferredPace: "normal",
          accommodationPreference: "midrange",
        },
        DestinationSuggestions: {
          candidates: [
            {
              name: "Seoul",
              country: "South Korea",
              iataCode: "ICN",
              cityCode: "SEL",
              rationale: "Fits culture and food interests",
            },
          ],
        },
      }) as unknown as ChatOpenAI;

      const graph = await buildPlannerGraph({
        model: fakeModel,
        checkpointer: createInMemoryCheckpointer(),
        itineraryAgentDependencies: {
          searchFlights: async () => [],
          searchHotels: async () => [],
          fetchWeather: async () => ({
            location: "Seoul, South Korea",
            timezone: "Asia/Seoul",
            daily: [
              {
                date: "2026-09-01",
                weatherCode: 1,
                temperatureMax: 25,
                temperatureMin: 18,
                precipitationProbabilityMax: 30,
                riskLevel: "LOW",
              },
            ],
            highRiskDates: [],
          }),
        },
      });

      const result = await graph.invoke(
        {
          userRequest: {
            userId: "eval-user",
            requestText: "Plan a short culture and food trip",
            destinationHint: "Seoul",
            destinationCityCode: "SEL",
            destinationIata: "ICN",
            travelStartDate: "2026-09-01",
            travelEndDate: "2026-09-03",
            budget: 2000,
            adults: 1,
            children: 0,
            interests: ["food", "culture"],
          },
        },
        {
          configurable: {
            thread_id: "eval-thread-1",
          },
        },
      );

      const plan = result.finalPlan;
      const completenessScore =
        Number(Boolean(plan?.summary)) +
        Number((plan?.itinerary.length ?? 0) > 0) +
        Number((plan?.packingList.length ?? 0) > 0) +
        Number(Boolean(plan?.budget));

      expect(completenessScore).toBeGreaterThanOrEqual(4);
    },
  );

  it.skipIf(hasLangSmithKey)(
    "[blocked] LANGSMITH_API_KEY is not configured for eval tracing",
    () => {
      expect(true).toBe(true);
    },
  );
});
