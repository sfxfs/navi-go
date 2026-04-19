import { makeDecisionLog, type PlannerState } from "../graph/state.js";

export const runBudgetAgent = async (
  state: PlannerState,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest || state.itineraryDraft.length === 0) {
    return {};
  }

  const cheapestFlight = state.flightOptions
    .map((option) => option.totalPrice)
    .sort((a, b) => a - b)[0];

  const cheapestHotel = state.hotelOptions
    .map((option) => option.totalPrice)
    .sort((a, b) => a - b)[0];

  const dailySpendEstimate =
    (state.userRequest.adults * 85 + state.userRequest.children * 45) *
    state.itineraryDraft.length;

  const estimatedTotal =
    (cheapestFlight ?? 0) +
    (cheapestHotel ?? 0) +
    dailySpendEstimate;

  const withinBudget = estimatedTotal <= state.userRequest.budget;

  const optimizationTips = withinBudget
    ? [
        "Budget is within limit; keep a contingency reserve for transfers.",
      ]
    : [
        "Select lower-cost accommodation tier.",
        "Reduce paid activities on peak-price days.",
        "Consider nearby alternate airport for cheaper flights.",
      ];

  return {
    budgetAssessment: {
      estimatedTotal,
      budgetLimit: state.userRequest.budget,
      withinBudget,
      optimizationTips,
    },
    decisionLog: [
      makeDecisionLog({
        agent: "budget_agent",
        inputSummary: "Evaluated trip draft against budget constraints",
        keyEvidence: [
          `estimatedTotal=${estimatedTotal.toFixed(2)}`,
          `budget=${state.userRequest.budget.toFixed(2)}`,
        ],
        outputSummary: withinBudget
          ? "Trip is currently budget-feasible"
          : "Trip exceeds budget and needs optimization",
        riskFlags: withinBudget ? [] : ["BUDGET_EXCEEDED"],
      }),
    ],
  };
};
