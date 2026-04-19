import {
  searchFlightOffers,
  type FlightOption,
} from "../tools/flights/duffel-flight.tool.js";
import {
  searchHotelOffers,
  type HotelOption,
} from "../tools/hotels/expedia-hotel.tool.js";
import {
  fetchWeatherRiskSummary,
  type WeatherRiskSummary,
} from "../tools/weather/openmeteo-weather.tool.js";
import { makeDecisionLog, type ItineraryDay, type PlannerState } from "../graph/state.js";

export type ItineraryAgentDependencies = {
  searchFlights: typeof searchFlightOffers;
  searchHotels: typeof searchHotelOffers;
  fetchWeather: typeof fetchWeatherRiskSummary;
};

const defaultDependencies: ItineraryAgentDependencies = {
  searchFlights: searchFlightOffers,
  searchHotels: searchHotelOffers,
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

const pickActivities = (interest: string, highRisk: boolean): string[] => {
  if (highRisk) {
    return [
      `Indoor ${interest} experience`,
      "Local museum or cultural center",
      "Flexible evening dining plan",
    ];
  }

  return [
    `${interest} highlight tour`,
    "Neighborhood exploration",
    "Evening local food walk",
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

  const destinationIata = destination.iataCode ?? state.userRequest.destinationIata;
  const destinationCityCode = destination.cityCode ?? state.userRequest.destinationCityCode;

  const flightOptions: FlightOption[] =
    state.userRequest.originIata && destinationIata
      ? await deps.searchFlights({
          originIata: state.userRequest.originIata,
          destinationIata,
          departureDate: state.userRequest.travelStartDate,
          adults: state.userRequest.adults,
          children: state.userRequest.children,
        })
      : [];

  const hotelOptions: HotelOption[] = destinationCityCode
    ? await deps.searchHotels({
        cityCode: destinationCityCode,
        destinationQuery: destination.name,
        checkInDate: state.userRequest.travelStartDate,
        checkOutDate: state.userRequest.travelEndDate,
        adults: state.userRequest.adults,
      })
    : [];

  const weatherRisks: WeatherRiskSummary = await deps.fetchWeather({
    destination: destination.name,
    startDate: state.userRequest.travelStartDate,
    endDate: state.userRequest.travelEndDate,
  });

  const interests =
    state.preferences?.prioritizedInterests.length
      ? state.preferences.prioritizedInterests
      : state.userRequest.interests.length
        ? state.userRequest.interests
        : ["sightseeing"];

  const itineraryDraft: ItineraryDay[] = enumerateDates(
    state.userRequest.travelStartDate,
    state.userRequest.travelEndDate,
  ).map((date, index) => {
    const interest = interests[index % interests.length] ?? "sightseeing";
    const dayWeather = weatherRisks.daily.find((item) => item.date === date);
    const highRisk = dayWeather?.riskLevel === "HIGH";

    return {
      date,
      theme: interest,
      activities: pickActivities(interest, highRisk),
      weatherNote: highRisk
        ? "Weather risk is high; prioritize indoor and transferable bookings"
        : "Weather acceptable for outdoor activities",
    };
  });

  return {
    flightOptions,
    hotelOptions,
    weatherRisks,
    itineraryDraft,
    decisionLog: [
      makeDecisionLog({
        agent: "itinerary_agent",
        inputSummary: "Fetched flights/hotels/weather and drafted daily itinerary",
        keyEvidence: [
          `flights=${flightOptions.length}`,
          `hotels=${hotelOptions.length}`,
          `highRiskDays=${weatherRisks.highRiskDates.length}`,
        ],
        outputSummary: `Generated ${itineraryDraft.length}-day itinerary`,
        riskFlags:
          weatherRisks.highRiskDates.length > 0
            ? ["WEATHER_HIGH_RISK"]
            : [],
      }),
    ],
  };
};
