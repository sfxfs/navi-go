import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";

import { buildPlannerGraph } from "../../src/graph/builder.js";
import { UserRequestSchema } from "../../src/graph/state.js";
import { createInMemoryCheckpointer } from "../../src/persistence/checkpointer.js";
import { FakeStructuredChatModel } from "../helpers/fake-model.js";

describe("planner graph integration", () => {
  it("builds complete plan and persists state by thread", async () => {
    const fakeModel = new FakeStructuredChatModel({
      PreferenceExtraction: {
        travelStyle: "balanced",
        prioritizedInterests: ["food", "museums"],
        preferredPace: "normal",
        accommodationPreference: "midrange",
      },
      DestinationSuggestions: {
        candidates: [
          {
            name: "Tokyo",
            country: "Japan",
            iataCode: "HND",
            cityCode: "TYO",
            rationale: "Excellent fit for food and culture",
          },
        ],
      },
    }) as unknown as ChatOpenAI;

    const graph = await buildPlannerGraph({
      model: fakeModel,
      checkpointer: createInMemoryCheckpointer(),
      itineraryAgentDependencies: {
        searchFlights: async () => [
          {
            offerId: "F-1",
            totalPrice: 550,
            currency: "USD",
            seats: 3,
            route: ["SFO-HND"],
            departureAt: "2026-07-01T08:00:00Z",
            arrivalAt: "2026-07-01T18:00:00Z",
            carriers: ["NH"],
          },
        ],
        searchHotels: async () => [
          {
            hotelId: "H-1",
            name: "Tokyo Inn",
            rating: 4.1,
            checkInDate: "2026-07-01",
            checkOutDate: "2026-07-04",
            totalPrice: 480,
            currency: "USD",
          },
        ],
        fetchWeather: async () => ({
          location: "Tokyo, Japan",
          timezone: "Asia/Tokyo",
          daily: [
            {
              date: "2026-07-01",
              weatherCode: 1,
              temperatureMax: 27,
              temperatureMin: 21,
              precipitationProbabilityMax: 20,
              riskLevel: "LOW",
            },
            {
              date: "2026-07-02",
              weatherCode: 95,
              temperatureMax: 24,
              temperatureMin: 18,
              precipitationProbabilityMax: 80,
              riskLevel: "HIGH",
            },
          ],
          highRiskDates: ["2026-07-02"],
        }),
      },
    });

    const threadId = "thread-graph-1";
    const userRequest = UserRequestSchema.parse({
      userId: "u1",
      requestText: "Plan a balanced Tokyo food+culture trip",
      originIata: "SFO",
      destinationHint: "Tokyo",
      destinationCityCode: "TYO",
      destinationIata: "HND",
      travelStartDate: "2026-07-01",
      travelEndDate: "2026-07-04",
      budget: 2500,
      adults: 1,
      children: 0,
      interests: ["food", "museums"],
    });

    const firstResult = await graph.invoke(
      { userRequest },
      { configurable: { thread_id: threadId } },
    );

    expect(firstResult.finalPlan?.selectedDestination).toBe("Tokyo");
    expect(firstResult.budgetAssessment?.estimatedTotal).toBeGreaterThan(0);

    const snapshot = await graph.getState({
      configurable: { thread_id: threadId },
    });

    expect(snapshot.values.finalPlan).not.toBeNull();
    expect(Array.isArray(snapshot.values.decisionLog)).toBe(true);

    const secondResult = await graph.invoke(
      {},
      { configurable: { thread_id: threadId } },
    );

    expect(secondResult.finalPlan?.selectedDestination).toBe("Tokyo");
  });
});
