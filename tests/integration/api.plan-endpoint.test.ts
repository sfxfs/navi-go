import type { ChatOpenAI } from "@langchain/openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPlannerGraph } from "../../src/graph/builder.js";
import { createApiServer } from "../../src/interfaces/api/server.js";
import { createInMemoryCheckpointer } from "../../src/persistence/checkpointer.js";
import { FakeStructuredChatModel } from "../helpers/fake-model.js";

describe("plan API endpoint", () => {
  let app: Awaited<ReturnType<typeof createApiServer>>;

  beforeAll(async () => {
    const fakeModel = new FakeStructuredChatModel({
      PreferenceExtraction: {
        travelStyle: "balanced",
        prioritizedInterests: ["history"],
        preferredPace: "normal",
        accommodationPreference: "midrange",
      },
      DestinationSuggestions: {
        candidates: [
          {
            name: "Rome",
            country: "Italy",
            iataCode: "FCO",
            cityCode: "ROM",
            rationale: "Fits history-oriented request",
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
            offerId: "offer-rome-1",
            totalPrice: 499.25,
            currency: "USD",
            seats: 4,
            route: ["JFK", "FCO"],
            departureAt: "2026-08-01T09:00:00Z",
            arrivalAt: "2026-08-01T17:00:00Z",
            carriers: ["AZ"],
          },
        ],
        fetchWeather: async () => ({
          location: "Rome, Italy",
          timezone: "Europe/Rome",
          daily: [
            {
              date: "2026-08-01",
              weatherCode: 1,
              temperatureMax: 31,
              temperatureMin: 23,
              precipitationProbabilityMax: 10,
              riskLevel: "LOW",
            },
          ],
          highRiskDates: [],
        }),
      },
    });

    app = await createApiServer({ graph });
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates and reads persisted plan state by thread", async () => {
    const threadId = "thread-api-1";

    const postResponse = await app.inject({
      method: "POST",
      url: "/plan",
      payload: {
        threadId,
        scenario: "integration-test",
        userRequest: {
          userId: "api-user",
          requestText: "Plan a history-focused trip",
          originIata: "JFK",
          destinationHint: "Rome",
          destinationCityCode: "ROM",
          destinationIata: "FCO",
          travelStartDate: "2026-08-01",
          travelEndDate: "2026-08-03",
          budget: 1800,
          adults: 1,
          children: 0,
          interests: ["history"],
        },
      },
    });

    expect(postResponse.statusCode).toBe(200);
    const parsedPost = postResponse.json();
    expect(parsedPost.threadId).toBe(threadId);
    expect(parsedPost.finalPlan.selectedDestination).toBe("Rome");

    const getResponse = await app.inject({
      method: "GET",
      url: `/plan/${threadId}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const parsedGet = getResponse.json();
    expect(parsedGet.values.finalPlan.selectedDestination).toBe("Rome");
    expect(parsedGet.values.finalPlan.selectedFlightOfferId).toBe("offer-rome-1");
    expect(parsedGet.values.flightOptions).toEqual([
      {
        offerId: "offer-rome-1",
        totalPrice: 499.25,
        currency: "USD",
        seats: 4,
        route: ["JFK", "FCO"],
        departureAt: "2026-08-01T09:00:00Z",
        arrivalAt: "2026-08-01T17:00:00Z",
        carriers: ["AZ"],
      },
    ]);
  });
});
