import { describe, expect, it } from "vitest";

import { runItineraryAgent } from "../../../src/agents/itinerary.agent.js";
import type { PlannerState } from "../../../src/graph/state.js";

const makeBaseState = (): PlannerState => ({
  userRequest: {
    userId: "u1",
    requestText: "Plan a culture-heavy trip",
    originIata: "SFO",
    destinationHint: "Rome",
    destinationCityCode: "ROM",
    destinationIata: "FCO",
    travelStartDate: "2026-09-01",
    travelEndDate: "2026-09-03",
    budget: 2200,
    adults: 1,
    children: 0,
    interests: ["history", "food"],
  },
  preferences: {
    travelStyle: "balanced",
    prioritizedInterests: ["history", "food"],
    preferredPace: "normal",
    accommodationPreference: "midrange",
  },
  destinationCandidates: [
    {
      name: "Rome",
      country: "Italy",
      iataCode: "FCO",
      cityCode: "ROM",
      rationale: "Best for history and food",
    },
  ],
  flightOptions: [],
  weatherRisks: null,
  itineraryDraft: [],
  budgetAssessment: null,
  packingList: [],
  safetyFlags: [],
  decisionLog: [],
  finalPlan: null,
});

describe("itinerary agent", () => {
  it("builds concrete non-duplicated daily activities", async () => {
    const state = makeBaseState();

    const update = await runItineraryAgent(state, {
      searchFlights: async () => [],
      fetchWeather: async () => ({
        location: "Rome, Italy",
        timezone: "Europe/Rome",
        daily: [
          {
            date: "2026-09-01",
            weatherCode: 1,
            temperatureMax: 29,
            temperatureMin: 21,
            precipitationProbabilityMax: 10,
            riskLevel: "LOW",
          },
          {
            date: "2026-09-02",
            weatherCode: 95,
            temperatureMax: 25,
            temperatureMin: 18,
            precipitationProbabilityMax: 85,
            riskLevel: "HIGH",
          },
          {
            date: "2026-09-03",
            weatherCode: 2,
            temperatureMax: 27,
            temperatureMin: 19,
            precipitationProbabilityMax: 20,
            riskLevel: "LOW",
          },
        ],
        highRiskDates: ["2026-09-02"],
      }),
    });

    expect(update.itineraryDraft).toHaveLength(3);

    const activitySignatures = update.itineraryDraft!.map((day) =>
      day.activities.join(" | "),
    );
    expect(new Set(activitySignatures).size).toBe(activitySignatures.length);

    expect(update.itineraryDraft?.[0]?.activities.join(" ")).toContain("Colosseum");
    expect(update.itineraryDraft?.[1]?.activities.join(" ")).toContain("Roman Forum");
    expect(update.itineraryDraft?.[1]?.activities.join(" ").toLowerCase()).toContain(
      "indoor",
    );
  });

  it("falls back to destination-derived anchors for unknown city codes", async () => {
    const base = makeBaseState();
    const state: PlannerState = {
      ...base,
      destinationCandidates: [
        {
          name: "Oslo",
          country: "Norway",
          iataCode: "OSL",
          cityCode: "OSL",
          rationale: "Provided by user",
        },
      ],
      userRequest: {
        ...base.userRequest!,
        destinationHint: "Oslo",
        destinationCityCode: "OSL",
        destinationIata: "OSL",
      },
    };

    const update = await runItineraryAgent(state, {
      searchFlights: async () => [],
      fetchWeather: async () => ({
        location: "Oslo, Norway",
        timezone: "Europe/Oslo",
        daily: [
          {
            date: "2026-09-01",
            weatherCode: 1,
            temperatureMax: 20,
            temperatureMin: 12,
            precipitationProbabilityMax: 15,
            riskLevel: "LOW",
          },
          {
            date: "2026-09-02",
            weatherCode: 1,
            temperatureMax: 19,
            temperatureMin: 11,
            precipitationProbabilityMax: 15,
            riskLevel: "LOW",
          },
          {
            date: "2026-09-03",
            weatherCode: 1,
            temperatureMax: 18,
            temperatureMin: 10,
            precipitationProbabilityMax: 15,
            riskLevel: "LOW",
          },
        ],
        highRiskDates: [],
      }),
    });

    expect(update.itineraryDraft?.[0]?.activities.join(" ")).toContain("Oslo Old Town");
    expect(update.itineraryDraft?.[0]?.theme).toContain("Oslo Old Town");
  });
});
