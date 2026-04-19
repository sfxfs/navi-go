import { detectUnsafeOutput } from "../security/guardrails.js";
import {
  FinalPlanSchema,
  makeDecisionLog,
  type PlannerState,
} from "../graph/state.js";

export const runPlanSynthesizerAgent = async (
  state: PlannerState,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest || !state.budgetAssessment) {
    return {};
  }

  const blocked = state.safetyFlags.includes("BLOCKED_PROMPT_INJECTION");
  const selectedDestination = state.destinationCandidates[0]?.name ?? "Not resolved";
  const selectedFlightOfferId = state.flightOptions[0]?.offerId;
  const selectedHotelId = state.hotelOptions[0]?.hotelId;

  const summary = blocked
    ? "Request blocked by risk guard due to prompt-injection patterns. No unsafe planning output generated."
    : `Prepared ${state.itineraryDraft.length}-day itinerary for ${selectedDestination}. ` +
      `Estimated spend ${state.budgetAssessment.estimatedTotal.toFixed(2)} ` +
      `${state.budgetAssessment.withinBudget ? "within" : "above"} budget.`;

  const unsafeOutputFlags = detectUnsafeOutput(summary);

  const finalPlan = FinalPlanSchema.parse({
    summary,
    selectedDestination,
    selectedFlightOfferId,
    selectedHotelId,
    itinerary: state.itineraryDraft,
    budget: state.budgetAssessment,
    packingList: state.packingList,
    safetyFlags: [...state.safetyFlags, ...unsafeOutputFlags],
  });

  return {
    finalPlan,
    safetyFlags: unsafeOutputFlags,
    decisionLog: [
      makeDecisionLog({
        agent: "plan_synthesizer",
        inputSummary: "Synthesized final travel plan artifact",
        keyEvidence: [
          `destination=${selectedDestination}`,
          `itineraryDays=${state.itineraryDraft.length}`,
          `safetyFlags=${finalPlan.safetyFlags.length}`,
        ],
        outputSummary: blocked
          ? "Produced safe refusal plan"
          : "Produced complete travel plan",
        riskFlags: unsafeOutputFlags,
      }),
    ],
  };
};
