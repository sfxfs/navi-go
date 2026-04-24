import { describe, expect, it } from "vitest";

import { runFormCompleter } from "../../../src/agents/form-completer.agent.js";
import type { PlannerState } from "../../../src/graph/state.js";

const baseState = (parsedRequest: Record<string, unknown>): PlannerState => ({
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
  naturalLanguage: "Plan a trip to Tokyo",
  parsedRequest: parsedRequest as PlannerState["parsedRequest"],
  pendingQuestions: null,
});

describe("form completer agent", () => {
  it("assembles complete userRequest when all required fields present", async () => {
    const state = baseState({
      travelStartDate: "2026-07-01",
      travelEndDate: "2026-07-05",
      budget: 2500,
      destinationHint: "Tokyo",
    });

    const update = await runFormCompleter(state);

    expect(update.userRequest).toBeDefined();
    expect(update.userRequest?.travelStartDate).toBe("2026-07-01");
    expect(update.userRequest?.travelEndDate).toBe("2026-07-05");
    expect(update.userRequest?.budget).toBe(2500);
    expect(update.pendingQuestions).toEqual([]);
  });

  it("returns pending questions when required fields are missing", async () => {
    const state = baseState({
      destinationHint: "Tokyo",
      budget: 2500,
    });

    const update = await runFormCompleter(state);

    expect(update.userRequest).toBeUndefined();
    expect(update.pendingQuestions).toBeDefined();
    expect(update.pendingQuestions?.length).toBeGreaterThan(0);
    expect(update.pendingQuestions?.some((q) => q.includes("departure date"))).toBe(true);
    expect(update.pendingQuestions?.some((q) => q.includes("return date"))).toBe(true);
  });

  it("skips when no parsedRequest", async () => {
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

    const update = await runFormCompleter(state);
    expect(update).toEqual({});
  });
});
