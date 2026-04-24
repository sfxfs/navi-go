import { END } from "@langchain/langgraph";

import { isBlockedByRiskGuard } from "../agents/risk-guard.agent.js";
import type { PlannerState } from "./state.js";

export type PlannerNodeName =
  | "risk_guard"
  | "supervisor"
  | "preference_agent"
  | "destination_agent"
  | "itinerary_agent"
  | "budget_agent"
  | "packing_agent"
  | "plan_synthesizer"
  | "requirement_parser"
  | "form_completer";

export const routeFromStart = (
  state: PlannerState,
): PlannerNodeName | typeof END => {
  if (state.naturalLanguage && !state.parsedRequest) {
    return "requirement_parser";
  }

  if (state.parsedRequest && !state.userRequest) {
    return "form_completer";
  }

  if (state.userRequest) {
    return "risk_guard";
  }

  return END;
};

export const routeFromFormCompleter = (
  state: PlannerState,
): PlannerNodeName | typeof END => {
  if (state.pendingQuestions && state.pendingQuestions.length > 0) {
    return END;
  }

  if (state.userRequest) {
    return "risk_guard";
  }

  return END;
};

export const routeFromRiskGuard = (
  state: PlannerState,
): PlannerNodeName | typeof END => {
  if (isBlockedByRiskGuard(state) && !state.finalPlan) {
    return "plan_synthesizer";
  }

  if (state.finalPlan) {
    return END;
  }

  return "supervisor";
};

export const routeFromSupervisor = (
  state: PlannerState,
): PlannerNodeName | typeof END => {
  if (!state.userRequest) {
    return END;
  }

  if (!state.preferences) {
    return "preference_agent";
  }

  if (state.destinationCandidates.length === 0) {
    return "destination_agent";
  }

  const itineraryInputsMissing =
    state.itineraryDraft.length === 0 || state.weatherRisks === null;

  if (itineraryInputsMissing) {
    return "itinerary_agent";
  }

  if (!state.budgetAssessment) {
    return "budget_agent";
  }

  if (state.packingList.length === 0) {
    return "packing_agent";
  }

  if (!state.finalPlan) {
    return "plan_synthesizer";
  }

  return END;
};

/**
 * Supervisor node for state-driven routing.
 *
 * This node intentionally does not modify state; routing decisions are made
 * solely by `routeFromSupervisor` based on the current PlannerState.
 */
export const runSupervisorNode = async (): Promise<Partial<PlannerState>> => {
  return {};
};
