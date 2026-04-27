import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";

import {
  ParsedRequestSchema,
  makeDecisionLog,
  type PlannerState,
} from "../graph/state.js";

export type RequirementParserDependencies = {
  model: ChatOpenAI;
};

const ExtractedRequestSchema = z.object({
  requestText: z.string().nullable(),
  originIata: z.string().regex(/^[A-Z]{3}$/).nullable(),
  destinationHint: z.string().min(2).nullable(),
  destinationCityCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  destinationIata: z.string().regex(/^[A-Z]{3}$/).nullable(),
  travelStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  travelEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  budget: z.number().positive().nullable(),
  adults: z.number().int().positive().max(9).nullable(),
  children: z.number().int().min(0).max(9).nullable(),
  interests: z.array(z.string().min(1)).nullable(),
});

export const runRequirementParser = async (
  state: PlannerState,
  deps: RequirementParserDependencies,
): Promise<Partial<PlannerState>> => {
  if (!state.naturalLanguage || state.parsedRequest) {
    return {};
  }

  const structuredModel = deps.model.withStructuredOutput(
    ExtractedRequestSchema,
    {
      name: "RequirementExtraction",
    },
  );

  const extracted = await structuredModel.invoke(`
You are a travel planning assistant. Extract structured trip requirements from the user's natural language request.

User request: ${JSON.stringify(state.naturalLanguage)}

Extract all fields you can identify. If a field is not mentioned, omit it.
- Dates must be in YYYY-MM-DD format (e.g. 2026-07-01).
- Budget should be a number (local currency, assume the user means the numeric amount).
- IATA codes are 3-letter uppercase airport codes.
- Interests should be an array of short keywords like ["food", "museums", "hiking"].
`);

  const filtered = Object.fromEntries(
    Object.entries(extracted).filter(([, value]) => value !== null),
  );

  const parsedRequest = ParsedRequestSchema.parse({
    ...filtered,
    requestText: filtered.requestText ?? state.naturalLanguage,
  });

  return {
    parsedRequest,
    decisionLog: [
      makeDecisionLog({
        agent: "requirement_parser",
        inputSummary: `Parsed natural language request`,
        keyEvidence: [
          `raw="${state.naturalLanguage}"`,
          `extractedFields=${Object.keys(parsedRequest).join(",")}`,
        ],
        outputSummary: `Extracted ${Object.keys(parsedRequest).length} fields`,
        riskFlags: [],
      }),
    ],
  };
};
