import { detectPromptInjection, detectUnsafeOutput } from "../security/guardrails.js";
import { makeDecisionLog, type PlannerState } from "../graph/state.js";

const blockedFlag = "BLOCKED_PROMPT_INJECTION";

export const runRiskGuardAgent = async (
  state: PlannerState,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest) {
    return {};
  }

  const injectionFlags = detectPromptInjection(state.userRequest.requestText);
  const outputFlags = state.finalPlan
    ? detectUnsafeOutput(state.finalPlan.summary)
    : [];

  const riskFlags = [
    ...injectionFlags.map(() => blockedFlag),
    ...outputFlags,
  ];

  if (riskFlags.length === 0) {
    return {
      decisionLog: [
        makeDecisionLog({
          agent: "risk_guard",
          inputSummary: "Scanned latest request and outputs",
          keyEvidence: ["No injection pattern matched", "No unsafe output matched"],
          outputSummary: "No risk flags raised",
          riskFlags: [],
        }),
      ],
    };
  }

  return {
    safetyFlags: riskFlags,
    decisionLog: [
      makeDecisionLog({
        agent: "risk_guard",
        inputSummary: "Scanned latest request and outputs",
        keyEvidence: [
          ...injectionFlags,
          ...outputFlags,
        ],
        outputSummary: "Raised risk flags for supervisor",
        riskFlags,
      }),
    ],
  };
};

export const isBlockedByRiskGuard = (state: PlannerState): boolean => {
  return state.safetyFlags.includes(blockedFlag);
};
