import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { searchFlightOffers } from "../tools/flights/duffel-flight.tool.js";
import { fetchWeatherRiskSummary } from "../tools/weather/openmeteo-weather.tool.js";
import {
  ItineraryDaySchema,
  makeDecisionLog,
  type PlannerState,
} from "../graph/state.js";
import { pickRecommendedFlightOption } from "./flight-option-selection.js";
import { PLACE_ANCHORS_BY_CITY_CODE } from "../data/place-anchors.js";

export type ItineraryAgentDependencies = {
  model: ChatOpenAI;
  searchFlights: typeof searchFlightOffers;
  fetchWeather: typeof fetchWeatherRiskSummary;
};

export const defaultItineraryDeps: Omit<ItineraryAgentDependencies, "model"> = {
  searchFlights: searchFlightOffers,
  fetchWeather: fetchWeatherRiskSummary,
};

const ItineraryDraftSchema = z.object({
  itineraryDraft: z.array(ItineraryDaySchema),
});

export const runItineraryAgent = async (
  state: PlannerState,
  deps: ItineraryAgentDependencies,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest) {
    return {};
  }

  const destination = state.destinationCandidates[0];
  if (!destination) {
    return {};
  }
  const userRequest = state.userRequest;

  const destinationIata = destination.iataCode ?? userRequest.destinationIata;

  const shouldSearchFlights = Boolean(userRequest.originIata && destinationIata);
  const originIata = userRequest.originIata!;

  const [outboundResult, returnResult, weatherResult] = await Promise.allSettled([
    shouldSearchFlights
      ? deps.searchFlights({
          originIata,
          destinationIata: destinationIata!,
          departureDate: userRequest.travelStartDate,
          adults: userRequest.adults,
          children: userRequest.children,
        })
      : Promise.resolve([]),
    shouldSearchFlights
      ? deps.searchFlights({
          originIata: destinationIata!,
          destinationIata: originIata,
          departureDate: userRequest.travelEndDate,
          adults: userRequest.adults,
          children: userRequest.children,
        })
      : Promise.resolve([]),
    deps.fetchWeather({
      destination: destination.name,
      startDate: userRequest.travelStartDate,
      endDate: userRequest.travelEndDate,
    }),
  ]);

  const flightOptions =
    outboundResult.status === "fulfilled" ? outboundResult.value : [];
  const returnFlightOptions =
    returnResult.status === "fulfilled" ? returnResult.value : [];

  if (weatherResult.status === "rejected") {
    throw weatherResult.reason;
  }
  const weatherRisks = weatherResult.value;

  const recommendedFlight = pickRecommendedFlightOption(
    flightOptions,
    userRequest.travelStartDate,
  );
  const recommendedReturnFlight = pickRecommendedFlightOption(
    returnFlightOptions,
    userRequest.travelEndDate,
  );

  const structuredModel = deps.model.withStructuredOutput(ItineraryDraftSchema, {
    name: "ItineraryDraft",
  });

  const interests =
    state.preferences?.prioritizedInterests.length
      ? state.preferences.prioritizedInterests
      : userRequest.interests.length
        ? userRequest.interests
        : ["sightseeing"];

  const cityCode = destination.cityCode ?? userRequest.destinationCityCode;
  const anchorPlaces = cityCode ? PLACE_ANCHORS_BY_CITY_CODE[cityCode] : null;
  const anchorHint = anchorPlaces
    ? `\nKnown places of interest in ${destination.name} you should incorporate: ${anchorPlaces.join(", ")}.`
    : "";

  const generated = await structuredModel.invoke(`
You are a travel itinerary planner. Create a detailed day-by-day itinerary based on the following data.

Destination: ${destination.name} (${destination.country})${anchorHint}
Travel dates: ${userRequest.travelStartDate} to ${userRequest.travelEndDate}
Travelers: ${userRequest.adults} adults, ${userRequest.children} children
Budget: ${userRequest.budget}
Interests: ${interests.join(", ")}
Travel style: ${state.preferences?.travelStyle ?? "balanced"}
Preferred pace: ${state.preferences?.preferredPace ?? "normal"}

Outbound flight: ${recommendedFlight ? `${recommendedFlight.offerId} departing ${recommendedFlight.departureAt}, arriving ${recommendedFlight.arrivalAt}, route: ${recommendedFlight.route.join(" → ")}, price ${recommendedFlight.totalPrice} ${recommendedFlight.currency}` : "none available"}
Return flight: ${recommendedReturnFlight ? `${recommendedReturnFlight.offerId} departing ${recommendedReturnFlight.departureAt}, arriving ${recommendedReturnFlight.arrivalAt}, route: ${recommendedReturnFlight.route.join(" → ")}, price ${recommendedReturnFlight.totalPrice} ${recommendedReturnFlight.currency}` : "none available"}

Weather forecast:
${weatherRisks.daily.map((d) => `- ${d.date}: max ${d.temperatureMax}°C, min ${d.temperatureMin}°C, precipitation ${d.precipitationProbabilityMax}%, risk ${d.riskLevel}`).join("\n")}

Instructions:
- If the outbound flight arrives after the start date, mark earlier days as transit days.
- Mark the arrival day as a light schedule.
- Mark the departure day for checkout and airport transfer.
- For each destination day, assign a theme, 2-4 activities, and a weather note.
- On high-risk weather days, prioritize indoor activities.
- Spread interests across days.
`);

  const itineraryDraft = generated.itineraryDraft;

  return {
    flightOptions,
    returnFlightOptions,
    weatherRisks,
    selectedFlightOfferId: recommendedFlight?.offerId ?? null,
    selectedReturnFlightOfferId: recommendedReturnFlight?.offerId ?? null,
    itineraryDraft,
    decisionLog: [
      makeDecisionLog({
        agent: "itinerary_agent",
        inputSummary: "Fetched outbound/return flights and weather; invoked LLM to draft itinerary",
        keyEvidence: [
          `outboundFlights=${flightOptions.length}`,
          `returnFlights=${returnFlightOptions.length}`,
          `highRiskDays=${weatherRisks.highRiskDates.length}`,
        ],
        outputSummary: `Generated ${itineraryDraft.length}-day itinerary with return flight`,
        riskFlags:
          weatherRisks.highRiskDates.length > 0
            ? ["WEATHER_HIGH_RISK"]
            : [],
      }),
    ],
  };
};
