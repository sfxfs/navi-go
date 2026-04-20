import {
  searchFlightOffers,
  type FlightOption,
} from "../tools/flights/duffel-flight.tool.js";
import {
  fetchWeatherRiskSummary,
  type WeatherRiskSummary,
} from "../tools/weather/openmeteo-weather.tool.js";
import { makeDecisionLog, type ItineraryDay, type PlannerState } from "../graph/state.js";

export type ItineraryAgentDependencies = {
  searchFlights: typeof searchFlightOffers;
  fetchWeather: typeof fetchWeatherRiskSummary;
};

const defaultDependencies: ItineraryAgentDependencies = {
  searchFlights: searchFlightOffers,
  fetchWeather: fetchWeatherRiskSummary,
};

const PLACE_ANCHORS_BY_CITY_CODE: Record<string, string[]> = {
  BCN: [
    "Sagrada Família",
    "Gothic Quarter",
    "Passeig de Gràcia",
    "El Born",
    "Montjuïc",
    "Barceloneta",
  ],
  FLR: [
    "Duomo di Firenze",
    "Uffizi Gallery",
    "Ponte Vecchio",
    "Oltrarno",
    "Piazzale Michelangelo",
    "Santa Croce",
  ],
  IST: [
    "Hagia Sophia",
    "Sultanahmet Square",
    "Grand Bazaar",
    "Galata",
    "Bosphorus Waterfront",
    "Kadıköy Market",
  ],
  LON: [
    "Westminster",
    "South Bank",
    "British Museum",
    "Covent Garden",
    "Notting Hill",
    "Borough Market",
  ],
  MEX: [
    "Zócalo",
    "Chapultepec Park",
    "Roma Norte",
    "Coyoacán",
    "Palacio de Bellas Artes",
    "Mercado de San Juan",
  ],
  NYC: [
    "Central Park",
    "Metropolitan Museum of Art",
    "Lower Manhattan",
    "Brooklyn Bridge Park",
    "Chelsea Market",
    "SoHo",
  ],
  PAR: [
    "Louvre Museum",
    "Le Marais",
    "Latin Quarter",
    "Montmartre",
    "Seine Riverside",
    "Musée d'Orsay",
  ],
  ROM: [
    "Colosseum",
    "Roman Forum",
    "Trastevere",
    "Vatican Museums",
    "Piazza Navona",
    "Testaccio Market",
  ],
  SEL: [
    "Gyeongbokgung Palace",
    "Bukchon Hanok Village",
    "Myeongdong",
    "Hongdae",
    "Insadong",
    "Dongdaemun Design Plaza",
  ],
  TYO: [
    "Asakusa",
    "Ueno Park",
    "Shibuya",
    "Tsukiji Outer Market",
    "Meiji Shrine",
    "Ginza",
  ],
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

  const destinationIata = destination.iataCode ?? state.userRequest.destinationIata;

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

  const placeAnchors = buildPlaceAnchors(
    destination.name,
    destination.cityCode ?? state.userRequest.destinationCityCode,
  );

  const itineraryDraft: ItineraryDay[] = enumerateDates(
    state.userRequest.travelStartDate,
    state.userRequest.travelEndDate,
  ).map((date, index) => {
    const interest = interests[index % interests.length] ?? "sightseeing";
    const dayWeather = weatherRisks.daily.find((item) => item.date === date);
    const highRisk = dayWeather?.riskLevel === "HIGH";
    const primaryAnchor =
      placeAnchors[index % placeAnchors.length] ?? `${destination.name} Historic Center`;
    const secondaryAnchor =
      placeAnchors[(index + 2) % placeAnchors.length] ?? `${destination.name} Museum Quarter`;
    const eveningAnchor =
      placeAnchors[(index + 4) % placeAnchors.length] ?? `${destination.name} Food Street`;

    return {
      date,
      theme: `${interest} in ${primaryAnchor}`,
      activities: pickActivities({
        interest,
        highRisk,
        primaryAnchor,
        secondaryAnchor,
        eveningAnchor,
        dayNumber: index + 1,
      }),
      weatherNote: highRisk
        ? `Weather risk is high for ${date}; prioritize indoor venues around ${primaryAnchor}`
        : `Weather acceptable for outdoor activities around ${primaryAnchor}`,
    };
  });

  return {
    flightOptions,
    weatherRisks,
    itineraryDraft,
    decisionLog: [
      makeDecisionLog({
        agent: "itinerary_agent",
        inputSummary: "Fetched flights/weather and drafted daily itinerary",
        keyEvidence: [
          `flights=${flightOptions.length}`,
          `highRiskDays=${weatherRisks.highRiskDates.length}`,
          `placeAnchors=${placeAnchors.length}`,
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
