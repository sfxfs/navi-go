import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";

import {
  UserRequestSchema,
  makeDecisionLog,
  type PlannerState,
} from "../graph/state.js";

export type FormCompleterDependencies = {
  model: ChatOpenAI;
};

const FormCompletionSchema = z.object({
  isComplete: z.boolean(),
  userRequest: UserRequestSchema.nullable(),
  pendingQuestions: z.array(z.string()),
});

export const runFormCompleter = async (
  state: PlannerState,
  deps: FormCompleterDependencies,
): Promise<Partial<PlannerState>> => {
  if (!state.parsedRequest) {
    return {};
  }

  const structuredModel = deps.model.withStructuredOutput(FormCompletionSchema, {
    name: "FormCompletion",
  });

  const existingUserId =
    typeof state.parsedRequest.userId === "string"
      ? state.parsedRequest.userId
      : "anonymous";

  const generated = await structuredModel.invoke(`
You are a travel planning form completer. Given the extracted fields below, determine if enough information is available to assemble a complete trip request.

Required fields: userId, requestText, travelStartDate, travelEndDate, budget, adults, children, interests.
Missing fields should use sensible defaults (adults=1, children=0, interests=[], userId="${existingUserId}", requestText=the original natural language request).

Extracted fields:
${Object.entries(state.parsedRequest)
  .map(([k, v]) => `- ${k}: ${v === undefined ? "missing" : v}`)
  .join("\n")}

Original request: ${state.naturalLanguage ?? "not provided"}

Return:
- isComplete: true only if travelStartDate, travelEndDate, and budget are present and valid
- userRequest: the fully assembled UserRequest object if complete, otherwise null
- pendingQuestions: 1-2 natural-language questions to ask the user for any missing required fields
`);

  if (generated.isComplete && generated.userRequest) {
    const parsedUserRequest = UserRequestSchema.safeParse(generated.userRequest);
    if (parsedUserRequest.success) {
      return {
        userRequest: parsedUserRequest.data,
        pendingQuestions: [],
        decisionLog: [
          makeDecisionLog({
            agent: "form_completer",
            inputSummary: "Validated parsed request for completeness via LLM",
            keyEvidence: ["All required fields present"],
            outputSummary: "Assembled complete UserRequest",
            riskFlags: [],
          }),
        ],
      };
    }
    // LLM returned structurally invalid userRequest — fall through to pending questions
  }

  const pendingQuestions =
    generated.pendingQuestions.length > 0
      ? generated.pendingQuestions
      : ["Could you provide your travel dates, budget, and destination?"];

  return {
    pendingQuestions,
    decisionLog: [
      makeDecisionLog({
        agent: "form_completer",
        inputSummary: "Validated parsed request for completeness via LLM",
        keyEvidence: pendingQuestions.map((q) => `missing=${q}`),
        outputSummary: `Awaiting user input for required fields`,
        riskFlags: [],
      }),
    ],
  };
};
