import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { detectUnsafeOutput } from "../security/guardrails.js";
import {
  FinalPlanSchema,
  makeDecisionLog,
  type BudgetAssessment,
  type FinalPlan,
  type PlannerState,
} from "../graph/state.js";

export type PlanSynthesizerDependencies = {
  model: ChatOpenAI;
};

const PlanSynthesisSchema = z.object({
  summary: z.string(),
  safetyFlags: z.array(z.string()),
});

const buildFinalPlan = (params: {
  summary: string;
  selectedDestination: string;
  selectedFlightOfferId: string | undefined;
  selectedReturnFlightOfferId: string | undefined;
  itineraryDraft: PlannerState["itineraryDraft"];
  budgetAssessment: BudgetAssessment;
  packingList: PlannerState["packingList"];
  existingSafetyFlags: string[];
  newSafetyFlags: string[];
}): FinalPlan => {
  const mergedSafetyFlags = [
    ...new Set([...params.existingSafetyFlags, ...params.newSafetyFlags]),
  ];
  return FinalPlanSchema.parse({
    summary: params.summary,
    selectedDestination: params.selectedDestination,
    selectedFlightOfferId: params.selectedFlightOfferId,
    selectedReturnFlightOfferId: params.selectedReturnFlightOfferId,
    itinerary: params.itineraryDraft,
    budget: params.budgetAssessment,
    packingList: params.packingList,
    safetyFlags: mergedSafetyFlags,
  });
};

export const runPlanSynthesizerAgent = async (
  state: PlannerState,
  deps: PlanSynthesizerDependencies,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest || !state.budgetAssessment) {
    return {};
  }

  const blocked = state.safetyFlags.some((flag) =>
    flag.startsWith("BLOCKED_PROMPT_INJECTION"),
  );
  const selectedDestination = state.destinationCandidates[0]?.name ?? "Not resolved";
  const selectedFlightOfferId = state.selectedFlightOfferId ?? undefined;
  const selectedReturnFlightOfferId = state.selectedReturnFlightOfferId ?? undefined;

  if (blocked) {
    const summary =
      "Request blocked by risk guard due to prompt-injection patterns. No unsafe planning output generated.";
    const unsafeOutputFlags = detectUnsafeOutput(summary);
    const finalPlan = buildFinalPlan({
      summary,
      selectedDestination,
      selectedFlightOfferId,
      selectedReturnFlightOfferId,
      itineraryDraft: state.itineraryDraft,
      budgetAssessment: state.budgetAssessment,
      packingList: state.packingList,
      existingSafetyFlags: state.safetyFlags,
      newSafetyFlags: unsafeOutputFlags,
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
          outputSummary: "Produced safe refusal plan",
          riskFlags: unsafeOutputFlags,
        }),
      ],
    };
  }

  const structuredModel = deps.model.withStructuredOutput(PlanSynthesisSchema, {
    name: "PlanSynthesis",
  });

  const generated = await structuredModel.invoke(`
You are a travel plan synthesizer. Produce a concise summary and any safety flags for the following trip plan.

Destination: ${selectedDestination}
Itinerary days: ${state.itineraryDraft.length}
Outbound flight: ${selectedFlightOfferId ?? "none"}
Return flight: ${selectedReturnFlightOfferId ?? "none"}
Budget: ${state.budgetAssessment.estimatedTotal.toFixed(2)} / ${state.budgetAssessment.budgetLimit.toFixed(2)} (${state.budgetAssessment.withinBudget ? "within budget" : "over budget"})
Packing items: ${state.packingList.length}
Existing safety flags: ${state.safetyFlags.join(", ") || "none"}

Return a summary (2-3 sentences) and any additional safety flags you detect.
`);

  const unsafeOutputFlags = detectUnsafeOutput(generated.summary);
  const newSafetyFlags = [
    ...new Set([...generated.safetyFlags, ...unsafeOutputFlags]),
  ];

  const finalPlan = buildFinalPlan({
    summary: generated.summary,
    selectedDestination,
    selectedFlightOfferId,
    selectedReturnFlightOfferId,
    itineraryDraft: state.itineraryDraft,
    budgetAssessment: state.budgetAssessment,
    packingList: state.packingList,
    existingSafetyFlags: state.safetyFlags,
    newSafetyFlags,
  });

  return {
    finalPlan,
    safetyFlags: newSafetyFlags,
    decisionLog: [
      makeDecisionLog({
        agent: "plan_synthesizer",
        inputSummary: "Synthesized final travel plan artifact via LLM",
        keyEvidence: [
          `destination=${selectedDestination}`,
          `itineraryDays=${state.itineraryDraft.length}`,
          `safetyFlags=${finalPlan.safetyFlags.length}`,
        ],
        outputSummary: "Produced complete travel plan",
        riskFlags: unsafeOutputFlags,
      }),
    ],
  };
};
