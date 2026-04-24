import { describe, expect, it } from "vitest";

import { runRequirementParser } from "../../../src/agents/requirement-parser.agent.js";
import type { PlannerState } from "../../../src/graph/state.js";
import { FakeStructuredChatModel } from "../../helpers/fake-model.js";

describe("requirement parser agent", () => {
  it("extracts structured fields from natural language", async () => {
    const fakeModel = new FakeStructuredChatModel({
      RequirementExtraction: {
        requestText: null,
        originIata: null,
        destinationHint: "Tokyo",
        destinationCityCode: "TYO",
        destinationIata: "HND",
        travelStartDate: "2026-07-01",
        travelEndDate: "2026-07-05",
        budget: 2500,
        adults: 2,
        children: null,
        interests: ["food", "museums"],
      },
    });

    const state: PlannerState = {
      userRequest: null,
      preferences: null,
      destinationCandidates: [],
      flightOptions: [],
  returnFlightOptions: [],
      weatherRisks: null,
      itineraryDraft: [],
      budgetAssessment: null,
      packingList: [],
      safetyFlags: [],
      decisionLog: [],
      finalPlan: null,
      naturalLanguage: "Plan a 5-day Tokyo trip for 2 adults with food and museums, budget 2500",
      parsedRequest: null,
      pendingQuestions: null,
    };

    const update = await runRequirementParser(state, {
      model: fakeModel as unknown as Parameters<typeof runRequirementParser>[1]["model"],
    });

    expect(update.parsedRequest).toBeDefined();
    expect(update.parsedRequest?.destinationHint).toBe("Tokyo");
    expect(update.parsedRequest?.budget).toBe(2500);
    expect(update.parsedRequest?.travelStartDate).toBe("2026-07-01");
    expect(update.decisionLog?.[0]?.agent).toBe("requirement_parser");
  });

  it("skips when already parsed", async () => {
    const fakeModel = new FakeStructuredChatModel({});

    const state: PlannerState = {
      userRequest: null,
      preferences: null,
      destinationCandidates: [],
      flightOptions: [],
  returnFlightOptions: [],
      weatherRisks: null,
      itineraryDraft: [],
      budgetAssessment: null,
      packingList: [],
      safetyFlags: [],
      decisionLog: [],
      finalPlan: null,
      naturalLanguage: "Trip to Paris",
      parsedRequest: { requestText: "Trip to Paris" },
      pendingQuestions: null,
    };

    const update = await runRequirementParser(state, {
      model: fakeModel as unknown as Parameters<typeof runRequirementParser>[1]["model"],
    });

    expect(update).toEqual({});
  });

  it("skips when no natural language", async () => {
    const fakeModel = new FakeStructuredChatModel({});

    const state: PlannerState = {
      userRequest: null,
      preferences: null,
      destinationCandidates: [],
      flightOptions: [],
  returnFlightOptions: [],
      weatherRisks: null,
      itineraryDraft: [],
      budgetAssessment: null,
      packingList: [],
      safetyFlags: [],
      decisionLog: [],
      finalPlan: null,
      naturalLanguage: null,
      parsedRequest: null,
      pendingQuestions: null,
    };

    const update = await runRequirementParser(state, {
      model: fakeModel as unknown as Parameters<typeof runRequirementParser>[1]["model"],
    });

    expect(update).toEqual({});
  });
});
