import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

export const UserRequestSchema = z.object({
  userId: z.string().min(1).default("anonymous"),
  requestText: z.string().min(1),
  originIata: z.string().regex(/^[A-Z]{3}$/).optional(),
  destinationHint: z.string().min(2).optional(),
  destinationCityCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  destinationIata: z.string().regex(/^[A-Z]{3}$/).optional(),
  travelStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  travelEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  budget: z.number().positive(),
  adults: z.number().int().positive().max(9).default(1),
  children: z.number().int().min(0).max(9).default(0),
  interests: z.array(z.string().min(1)).default([]),
});

export const PreferencesSchema = z.object({
  travelStyle: z.enum(["relaxed", "balanced", "packed"]),
  prioritizedInterests: z.array(z.string().min(1)),
  preferredPace: z.enum(["slow", "normal", "fast"]),
  accommodationPreference: z.enum(["budget", "midrange", "premium"]),
});

export const DestinationCandidateSchema = z.object({
  name: z.string(),
  country: z.string(),
  iataCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  cityCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  rationale: z.string(),
});

export const ItineraryDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  theme: z.string(),
  activities: z.array(z.string()),
  weatherNote: z.string().optional(),
});

export const BudgetAssessmentSchema = z.object({
  estimatedTotal: z.number().nonnegative(),
  budgetLimit: z.number().positive(),
  withinBudget: z.boolean(),
  optimizationTips: z.array(z.string()),
});

export const DecisionLogEntrySchema = z.object({
  agent: z.string(),
  inputSummary: z.string(),
  keyEvidence: z.array(z.string()),
  outputSummary: z.string(),
  riskFlags: z.array(z.string()),
  timestamp: z.string(),
});

export const FinalPlanSchema = z.object({
  summary: z.string(),
  selectedDestination: z.string(),
  selectedFlightOfferId: z.string().optional(),
  selectedReturnFlightOfferId: z.string().optional(),
  itinerary: z.array(ItineraryDaySchema),
  budget: BudgetAssessmentSchema,
  packingList: z.array(z.string()),
  safetyFlags: z.array(z.string()),
});

export type UserRequest = z.infer<typeof UserRequestSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type DestinationCandidate = z.infer<typeof DestinationCandidateSchema>;
export type ItineraryDay = z.infer<typeof ItineraryDaySchema>;
export type BudgetAssessment = z.infer<typeof BudgetAssessmentSchema>;
export type DecisionLogEntry = z.infer<typeof DecisionLogEntrySchema>;
export type FinalPlan = z.infer<typeof FinalPlanSchema>;

export const ParsedRequestSchema = UserRequestSchema.partial();

export type ParsedRequest = z.infer<typeof ParsedRequestSchema>;

export type FlightOption = {
  offerId: string;
  totalPrice: number;
  currency: string;
  seats: number | undefined;
  route: string[];
  departureAt: string;
  arrivalAt: string;
  carriers: string[];
};


export type DailyWeather = {
  date: string;
  weatherCode: number;
  temperatureMax: number;
  temperatureMin: number;
  precipitationProbabilityMax: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
};

export type WeatherRiskSummary = {
  location: string;
  timezone: string | undefined;
  daily: DailyWeather[];
  highRiskDates: string[];
};

const replaceReducer = <T>(_: T, next: T): T => next;

export const PlannerStateAnnotation = Annotation.Root({
  userRequest: Annotation<UserRequest | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  preferences: Annotation<Preferences | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  destinationCandidates: Annotation<DestinationCandidate[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  flightOptions: Annotation<FlightOption[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  returnFlightOptions: Annotation<FlightOption[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  weatherRisks: Annotation<WeatherRiskSummary | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  itineraryDraft: Annotation<ItineraryDay[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  budgetAssessment: Annotation<BudgetAssessment | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  packingList: Annotation<string[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  safetyFlags: Annotation<string[]>({
    reducer: (left, right) => [...new Set([...left, ...right])],
    default: () => [],
  }),
  decisionLog: Annotation<DecisionLogEntry[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  finalPlan: Annotation<FinalPlan | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  naturalLanguage: Annotation<string | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  parsedRequest: Annotation<ParsedRequest | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  pendingQuestions: Annotation<string[] | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
});

export type PlannerState = typeof PlannerStateAnnotation.State;

export const makeDecisionLog = (
  entry: Omit<DecisionLogEntry, "timestamp">,
): DecisionLogEntry => ({
  ...entry,
  timestamp: new Date().toISOString(),
});
