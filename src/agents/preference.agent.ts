import type { ChatOpenAI } from "@langchain/openai";

import {
  PreferencesSchema,
  makeDecisionLog,
  type PlannerState,
} from "../graph/state.js";

export type PreferenceAgentDependencies = {
  model: ChatOpenAI;
};

export const runPreferenceAgent = async (
  state: PlannerState,
  deps: PreferenceAgentDependencies,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest || state.preferences) {
    return {};
  }

  const structuredModel = deps.model.withStructuredOutput(PreferencesSchema, {
    name: "PreferenceExtraction",
  });

  const extracted = await structuredModel.invoke(`
You are extracting travel preferences for trip planning.

User request: ${state.userRequest.requestText}
Interests: ${state.userRequest.interests.join(", ") || "not provided"}
Budget: ${state.userRequest.budget}

Return preference profile.
`);

  const preferences = PreferencesSchema.parse({
    ...extracted,
    prioritizedInterests:
      state.userRequest.interests.length > 0
        ? state.userRequest.interests
        : extracted.prioritizedInterests,
  });

  return {
    preferences,
    decisionLog: [
      makeDecisionLog({
        agent: "preference_agent",
        inputSummary: "Parsed user intent and constraints",
        keyEvidence: [
          `budget=${state.userRequest.budget}`,
          `interests=${preferences.prioritizedInterests.join("|")}`,
        ],
        outputSummary: `Extracted ${preferences.travelStyle} travel profile`,
        riskFlags: [],
      }),
    ],
  };
};
