import {
  UserRequestSchema,
  makeDecisionLog,
  type ParsedRequest,
  type PlannerState,
  type UserRequest,
} from "../graph/state.js";

const REQUIRED_FIELDS: Array<keyof ParsedRequest> = [
  "travelStartDate",
  "travelEndDate",
  "budget",
];

const generateQuestions = (missing: string[]): string[] => {
  return missing.map((field) => {
    switch (field) {
      case "travelStartDate":
        return "What is your planned departure date (format: YYYY-MM-DD)?";
      case "travelEndDate":
        return "What is your return date (format: YYYY-MM-DD)?";
      case "budget":
        return "What is your travel budget (numeric amount)?";
      default:
        return `Please provide ${field}`;
    }
  });
};

const buildFullUserRequest = (
  draft: ParsedRequest,
  naturalLanguage: string | null,
): UserRequest => {
  return UserRequestSchema.parse({
    userId: draft.userId ?? "anonymous",
    requestText: draft.requestText ?? naturalLanguage ?? "Travel plan",
    originIata: draft.originIata,
    destinationHint: draft.destinationHint,
    destinationCityCode: draft.destinationCityCode,
    destinationIata: draft.destinationIata,
    travelStartDate: draft.travelStartDate,
    travelEndDate: draft.travelEndDate,
    budget: draft.budget,
    adults: draft.adults ?? 1,
    children: draft.children ?? 0,
    interests: draft.interests ?? [],
  });
};

export const runFormCompleter = async (
  state: PlannerState,
): Promise<Partial<PlannerState>> => {
  if (!state.parsedRequest) {
    return {};
  }

  const draft = { ...state.parsedRequest };
  const missing = REQUIRED_FIELDS.filter(
    (field) => draft[field] === undefined,
  );

  if (missing.length === 0) {
    const userRequest = buildFullUserRequest(draft, state.naturalLanguage);
    return {
      userRequest,
      pendingQuestions: [],
      decisionLog: [
        makeDecisionLog({
          agent: "form_completer",
          inputSummary: "Validated parsed request for completeness",
          keyEvidence: ["All required fields present"],
          outputSummary: "Assembled complete UserRequest",
          riskFlags: [],
        }),
      ],
    };
  }

  const questions = generateQuestions(missing);

  return {
    pendingQuestions: questions,
    decisionLog: [
      makeDecisionLog({
        agent: "form_completer",
        inputSummary: "Validated parsed request for completeness",
        keyEvidence: missing.map((f) => `missing=${f}`),
        outputSummary: `Awaiting user input for ${missing.length} required fields`,
        riskFlags: [],
      }),
    ],
  };
};
