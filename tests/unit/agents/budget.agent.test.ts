import { describe, expect, it } from "vitest";

import { runBudgetAgent } from "../../../src/agents/budget.agent.js";
import type { PlannerState } from "../../../src/graph/state.js";

const makeState = (budget: number): PlannerState => ({
  userRequest: {
    userId: "u1",
    requestText: "Budget test",
    travelStartDate: "2026-07-01",
    travelEndDate: "2026-07-03",
    budget,
    adults: 1,
    children: 0,
    interests: ["museum"],
    destinationHint: "Tokyo",
    destinationCityCode: "TYO",
    destinationIata: "HND",
  },
  preferences: null,
  destinationCandidates: [],
  flightOptions: [
    {
      offerId: "F1",
      totalPrice: 400,
      currency: "USD",
      seats: 3,
      route: ["SFO-HND"],
      departureAt: "2026-07-01T00:00:00Z",
      arrivalAt: "2026-07-01T10:00:00Z",
      carriers: ["NH"],
    },
  ],
  returnFlightOptions: [],
  weatherRisks: null,
  itineraryDraft: [
    { date: "2026-07-01", theme: "museum", activities: ["A"] },
    { date: "2026-07-02", theme: "museum", activities: ["B"] },
    { date: "2026-07-03", theme: "museum", activities: ["C"] },
  ],
  budgetAssessment: null,
  packingList: [],
  safetyFlags: [],
  decisionLog: [],
  finalPlan: null,
  naturalLanguage: null,
  parsedRequest: null,
  pendingQuestions: null,
});

describe("budget agent", () => {
  it("marks within budget plan", async () => {
    const update = await runBudgetAgent(makeState(1600));

    expect(update.budgetAssessment?.withinBudget).toBe(true);
    expect(update.budgetAssessment?.optimizationTips[0]).toContain("within limit");
  });

  it("marks over budget plan", async () => {
    const update = await runBudgetAgent(makeState(500));

    expect(update.budgetAssessment?.withinBudget).toBe(false);
    expect(update.decisionLog?.[0]?.riskFlags).toContain("BUDGET_EXCEEDED");
  });
});
