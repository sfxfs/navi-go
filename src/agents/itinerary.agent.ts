import { searchFlightOffers } from "../tools/flights/duffel-flight.tool.js";
import { fetchWeatherRiskSummary } from "../tools/weather/openmeteo-weather.tool.js";
import {
  makeDecisionLog,
  type FlightOption,
  type ItineraryDay,
  type PlannerState,
  type WeatherRiskSummary,
} from "../graph/state.js";
import { PLACE_ANCHORS_BY_CITY_CODE } from "../data/place-anchors.js";
import { getFlightCalendarDate, pickRecommendedFlightOption } from "./flight-option-selection.js";

export type ItineraryAgentDependencies = {
  searchFlights: typeof searchFlightOffers;
  fetchWeather: typeof fetchWeatherRiskSummary;
};

const defaultDependencies: ItineraryAgentDependencies = {
  searchFlights: searchFlightOffers,
  fetchWeather: fetchWeatherRiskSummary,
};

const enumerateDates = (startDate: string, endDate: string): string[] => {
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  for (let current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(current.toISOString().slice(0, 10));
  }

  return dates;
};

const buildPlaceAnchors = (
  destinationName: string,
  destinationCityCode: string | null | undefined,
): string[] => {
  const curatedAnchors = destinationCityCode
    ? PLACE_ANCHORS_BY_CITY_CODE[destinationCityCode.toUpperCase()]
    : undefined;

  if (curatedAnchors && curatedAnchors.length > 0) {
    return curatedAnchors;
  }

  return [
    `${destinationName} Old Town`,
    `${destinationName} Central Market`,
    `${destinationName} Riverfront`,
    `${destinationName} Museum Quarter`,
    `${destinationName} Historic Center`,
    `${destinationName} Food Street`,
  ];
};

const pickActivities = (args: {
  interest: string;
  highRisk: boolean;
  primaryAnchor: string;
  secondaryAnchor: string;
  eveningAnchor: string;
  dayNumber: number;
}): string[] => {
  const {
    interest,
    highRisk,
    primaryAnchor,
    secondaryAnchor,
    eveningAnchor,
    dayNumber,
  } = args;

  if (highRisk) {
    return [
      `Day ${dayNumber}: Indoor ${interest} tour at ${primaryAnchor}`,
      `Indoor exploration around ${secondaryAnchor} (museum/cultural center focus)`,
      `Flexible evening dining plan near ${eveningAnchor}`,
    ];
  }

  return [
    `Day ${dayNumber}: ${interest} highlight tour at ${primaryAnchor}`,
    `Neighborhood exploration around ${secondaryAnchor}`,
    `Evening local food walk near ${eveningAnchor}`,
  ];
};

export const runItineraryAgent = async (
  state: PlannerState,
  deps: ItineraryAgentDependencies = defaultDependencies,
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

  const flightOptions: FlightOption[] =
    userRequest.originIata && destinationIata
      ? await deps.searchFlights({
          originIata: userRequest.originIata,
          destinationIata,
          departureDate: userRequest.travelStartDate,
          adults: userRequest.adults,
          children: userRequest.children,
        })
      : [];

  const returnFlightOptions: FlightOption[] =
    userRequest.originIata && destinationIata
      ? await deps.searchFlights({
          originIata: destinationIata,
          destinationIata: userRequest.originIata,
          departureDate: userRequest.travelEndDate,
          adults: userRequest.adults,
          children: userRequest.children,
        })
      : [];

  const weatherRisks: WeatherRiskSummary = await deps.fetchWeather({
    destination: destination.name,
    startDate: userRequest.travelStartDate,
    endDate: userRequest.travelEndDate,
  });

  const interests =
    state.preferences?.prioritizedInterests.length
      ? state.preferences.prioritizedInterests
      : userRequest.interests.length
        ? userRequest.interests
        : ["sightseeing"];

  const placeAnchors = buildPlaceAnchors(
    destination.name,
    destination.cityCode ?? userRequest.destinationCityCode,
  );

  const recommendedFlight = pickRecommendedFlightOption(
    flightOptions,
    userRequest.travelStartDate,
  );
  const arrivalDate = recommendedFlight
    ? getFlightCalendarDate(recommendedFlight.arrivalAt)
    : undefined;

  const recommendedReturnFlight = pickRecommendedFlightOption(
    returnFlightOptions,
    userRequest.travelEndDate,
  );
  const returnDepartureDate = recommendedReturnFlight
    ? getFlightCalendarDate(recommendedReturnFlight.departureAt)
    : undefined;

  let destinationDayNumber = 0;

  const itineraryDraft: ItineraryDay[] = enumerateDates(
    userRequest.travelStartDate,
    userRequest.travelEndDate,
  ).map((date) => {
    const isTransitDayBeforeArrival = arrivalDate !== undefined && date < arrivalDate;
    if (isTransitDayBeforeArrival) {
      const route =
        recommendedFlight?.route.length
          ? recommendedFlight.route.join(" → ")
          : `${userRequest.originIata ?? "origin"} → ${destinationIata ?? destination.name}`;

      return {
        date,
        theme: `Transit to ${destination.name}`,
        activities: [
          `Take flight ${recommendedFlight?.offerId ?? "(pending)"} on route ${route}`,
          `Keep this day flexible for airport transfers and check-in`,
          `Avoid fixed tours before arriving in ${destination.name}`,
        ],
        weatherNote: `Transit day; start destination activities after arrival on ${arrivalDate}.`,
      };
    }

    destinationDayNumber += 1;
    const interest = interests[(destinationDayNumber - 1) % interests.length] ?? "sightseeing";
    const dayWeather = weatherRisks.daily.find((item) => item.date === date);
    const highRisk = dayWeather?.riskLevel === "HIGH";
    const primaryAnchor =
      placeAnchors[(destinationDayNumber - 1) % placeAnchors.length] ??
      `${destination.name} Historic Center`;
    const secondaryAnchor =
      placeAnchors[(destinationDayNumber + 1) % placeAnchors.length] ??
      `${destination.name} Museum Quarter`;
    const eveningAnchor =
      placeAnchors[(destinationDayNumber + 3) % placeAnchors.length] ??
      `${destination.name} Food Street`;
    const isArrivalDay = arrivalDate !== undefined && date === arrivalDate;
    const isDepartureDay = returnDepartureDate !== undefined && date === returnDepartureDate;

    if (isArrivalDay) {
      return {
        date,
        theme: `Arrival in ${destination.name}`,
        activities: [
          `Day ${destinationDayNumber}: Arrive via flight ${recommendedFlight?.offerId ?? "(pending)"}`,
          `Complete immigration, transfer, and hotel check-in`,
          `Take a light evening walk near ${eveningAnchor}`,
        ],
        weatherNote: `Arrival day; keep plans light before full exploration starts.`,
      };
    }

    if (isDepartureDay) {
      const returnRoute =
        recommendedReturnFlight?.route.length
          ? recommendedReturnFlight.route.join(" → ")
          : `${destinationIata ?? destination.name} → ${userRequest.originIata ?? "origin"}`;

      return {
        date,
        theme: `Departure from ${destination.name}`,
        activities: [
          `Day ${destinationDayNumber}: Check-out and transfer to airport`,
          `Take return flight ${recommendedReturnFlight?.offerId ?? "(pending)"} on route ${returnRoute}`,
          `Arrive home; end of trip`,
        ],
        weatherNote: `Departure day; keep luggage packed and allow buffer time for airport transfer.`,
      };
    }

    return {
      date,
      theme: `${interest} in ${primaryAnchor}`,
      activities: pickActivities({
        interest,
        highRisk,
        primaryAnchor,
        secondaryAnchor,
        eveningAnchor,
        dayNumber: destinationDayNumber,
      }),
      weatherNote: highRisk
        ? `Weather risk is high for ${date}; prioritize indoor venues around ${primaryAnchor}`
        : `Weather acceptable for outdoor activities around ${primaryAnchor}`,
    };
  });

  return {
    flightOptions,
    returnFlightOptions,
    weatherRisks,
    itineraryDraft,
    decisionLog: [
      makeDecisionLog({
        agent: "itinerary_agent",
        inputSummary: "Fetched outbound/return flights and drafted daily itinerary",
        keyEvidence: [
          `outboundFlights=${flightOptions.length}`,
          `returnFlights=${returnFlightOptions.length}`,
          `highRiskDays=${weatherRisks.highRiskDates.length}`,
          `placeAnchors=${placeAnchors.length}`,
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
