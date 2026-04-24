import { makeDecisionLog, type PlannerState } from "../graph/state.js";
import { pickRecommendedFlightOption } from "./flight-option-selection.js";

export const runBudgetAgent = async (
  state: PlannerState,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest || state.itineraryDraft.length === 0) {
    return {};
  }

  const recommendedFlight = pickRecommendedFlightOption(
    state.flightOptions,
    state.userRequest.travelStartDate,
  );
  const selectedFlightPrice = recommendedFlight?.totalPrice ?? 0;

  const recommendedReturnFlight = pickRecommendedFlightOption(
    state.returnFlightOptions,
    state.userRequest.travelEndDate,
  );
  const selectedReturnFlightPrice = recommendedReturnFlight?.totalPrice ?? 0;

  const tripDays = state.itineraryDraft.length;
  const tripNights = Math.max(tripDays - 1, 0);
  const nightlyRateByPreference = {
    budget: 90,
    midrange: 160,
    premium: 300,
  } as const;
  const accommodationPreference =
    state.preferences?.accommodationPreference ?? "midrange";
  const lodgingEstimate =
    nightlyRateByPreference[accommodationPreference] * tripNights;
  const dailySpendEstimate =
    (state.userRequest.adults * 85 + state.userRequest.children * 45) *
    state.itineraryDraft.length;

  const estimatedTotal =
    selectedFlightPrice +
    selectedReturnFlightPrice +
    lodgingEstimate +
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
          `lodgingEstimate=${lodgingEstimate.toFixed(2)}`,
          `accommodationPreference=${accommodationPreference}`,
          `selectedFlightOfferId=${recommendedFlight?.offerId ?? "none"}`,
        `selectedReturnFlightOfferId=${recommendedReturnFlight?.offerId ?? "none"}`,
        `flightCost=${(selectedFlightPrice + selectedReturnFlightPrice).toFixed(2)}`,
        ],
        outputSummary: withinBudget
          ? "Trip is currently budget-feasible"
          : "Trip exceeds budget and needs optimization",
        riskFlags: withinBudget ? [] : ["BUDGET_EXCEEDED"],
      }),
    ],
  };
};
