import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import {
  DestinationCandidateSchema,
  makeDecisionLog,
  type PlannerState,
} from "../graph/state.js";

const DestinationSuggestionsSchema = z.object({
  candidates: z.array(DestinationCandidateSchema).min(1).max(5),
});

export type DestinationAgentDependencies = {
  model: ChatOpenAI;
};

export const runDestinationAgent = async (
  state: PlannerState,
  deps: DestinationAgentDependencies,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest || state.destinationCandidates.length > 0) {
    return {};
  }

  const structuredModel = deps.model.withStructuredOutput(
    DestinationSuggestionsSchema,
    {
      name: "DestinationSuggestions",
    },
  );

  const generated = await structuredModel.invoke(`
Suggest destination candidates for this trip.

User request: ${state.userRequest.requestText}
Travel dates: ${state.userRequest.travelStartDate} to ${state.userRequest.travelEndDate}
Budget: ${state.userRequest.budget}
Interests: ${state.userRequest.interests.join(", ") || "not provided"}
Travel style: ${state.preferences?.travelStyle ?? "unknown"}
Preferred destination hint: ${state.userRequest.destinationHint ?? "none"}

Return valid city and airport codes where possible.
`);

  const fallbackCandidate = state.userRequest.destinationHint
    ? {
        name: state.userRequest.destinationHint,
        country: "Unknown",
        iataCode: state.userRequest.destinationIata ?? null,
        cityCode: state.userRequest.destinationCityCode ?? null,
        rationale: "Provided by user explicitly",
      }
    : null;

  const candidates = generated.candidates;
  const withFallback =
    fallbackCandidate &&
    !candidates.some((item) => item.cityCode === fallbackCandidate.cityCode)
      ? [fallbackCandidate, ...candidates]
      : candidates;

  return {
    destinationCandidates: withFallback.slice(0, 3),
    decisionLog: [
      makeDecisionLog({
        agent: "destination_agent",
        inputSummary: "Mapped preferences to reachable destinations",
        keyEvidence: withFallback.map((item) => `${item.name}:${item.cityCode ?? "NA"}`),
        outputSummary: `Generated ${Math.min(withFallback.length, 3)} destination candidates`,
        riskFlags: [],
      }),
    ],
  };
};
