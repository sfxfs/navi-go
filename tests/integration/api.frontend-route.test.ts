import type { ChatOpenAI } from "@langchain/openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPlannerGraph } from "../../src/graph/builder.js";
import { createApiServer } from "../../src/interfaces/api/server.js";
import { createInMemoryCheckpointer } from "../../src/persistence/checkpointer.js";
import { FakeStructuredChatModel } from "../helpers/fake-model.js";

describe("frontend static route", () => {
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
        searchFlights: async () => [],
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

  it("serves the frontend entry at root", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("NaviGo Travel Planner");
  });

  it("keeps the plan API route working", async () => {
    const threadId = "thread-frontend-1";

    const postResponse = await app.inject({
      method: "POST",
      url: "/plan",
      payload: {
        threadId,
        scenario: "frontend-test",
        userRequest: {
          requestText: "Plan a history-focused trip",
          destinationHint: "Rome",
          destinationCityCode: "ROM",
          destinationIata: "FCO",
          travelStartDate: "2026-08-01",
          travelEndDate: "2026-08-03",
          budget: 1800,
          interests: ["history"],
        },
      },
    });

    expect(postResponse.statusCode).toBe(200);
    const parsedPost = postResponse.json();
    expect(parsedPost.threadId).toBe(threadId);
    expect(parsedPost.finalPlan.selectedDestination).toBe("Rome");
  });
});
