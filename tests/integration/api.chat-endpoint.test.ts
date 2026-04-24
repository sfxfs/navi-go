import type { ChatOpenAI } from "@langchain/openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPlannerGraph } from "../../src/graph/builder.js";
import { createApiServer } from "../../src/interfaces/api/server.js";
import { createInMemoryCheckpointer } from "../../src/persistence/checkpointer.js";
import { FakeStructuredChatModel } from "../helpers/fake-model.js";

describe("plan chat API endpoint", () => {
  let app: Awaited<ReturnType<typeof createApiServer>>;

  beforeAll(async () => {
    const fakeModel = new FakeStructuredChatModel({
      RequirementExtraction: {
        requestText: null,
        originIata: null,
        destinationHint: "Rome",
        destinationCityCode: "ROM",
        destinationIata: "FCO",
        travelStartDate: null,
        travelEndDate: null,
        budget: 1800,
        adults: 1,
        children: null,
        interests: ["history"],
      },
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
            {
              date: "2026-08-02",
              weatherCode: 1,
              temperatureMax: 30,
              temperatureMin: 22,
              precipitationProbabilityMax: 5,
              riskLevel: "LOW",
            },
            {
              date: "2026-08-03",
              weatherCode: 1,
              temperatureMax: 29,
              temperatureMin: 21,
              precipitationProbabilityMax: 5,
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

  it("starts chat planning and asks for missing fields", async () => {
    const threadId = "thread-chat-1";

    const response = await app.inject({
      method: "POST",
      url: "/plan/chat",
      payload: {
        threadId,
        scenario: "integration-test-chat",
        naturalLanguage: "Plan a history-focused trip to Rome",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("awaiting_input");
    expect(body.pendingQuestions.length).toBeGreaterThan(0);
    expect(body.parsedRequest).toBeDefined();
    expect(body.parsedRequest.budget).toBe(1800);
  });

  it("resumes chat planning with missing fields and completes", async () => {
    const threadId = "thread-chat-2";

    await app.inject({
      method: "POST",
      url: "/plan/chat",
      payload: {
        threadId,
        scenario: "integration-test-chat",
        naturalLanguage: "Plan a history-focused trip to Rome",
      },
    });

    const resumeResponse = await app.inject({
      method: "POST",
      url: "/plan/chat/resume",
      payload: {
        threadId,
        scenario: "integration-test-chat",
        answers: {
          travelStartDate: "2026-08-01",
          travelEndDate: "2026-08-03",
        },
      },
    });

    expect(resumeResponse.statusCode).toBe(200);
    const body = resumeResponse.json();
    expect(body.status).toBe("complete");
    expect(body.finalPlan.selectedDestination).toBe("Rome");
  });
});
