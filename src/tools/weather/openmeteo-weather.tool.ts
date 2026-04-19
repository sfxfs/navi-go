import { z } from "zod";

import { requestJson } from "../common/http.js";
import { validationToolError } from "../common/errors.js";

export const WeatherSearchInputSchema = z.object({
  destination: z.string().min(2),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const GeocodingResponseSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().optional(),
        timezone: z.string().optional(),
      }),
    )
    .optional(),
});

const ForecastResponseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_probability_max: z.array(z.number()),
  }),
});

export type WeatherSearchInput = z.input<typeof WeatherSearchInputSchema>;

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

const severeWeatherCodes = new Set([65, 67, 75, 82, 86, 95, 96, 99]);

const toRiskLevel = (weatherCode: number, precipitationProbability: number): DailyWeather["riskLevel"] => {
  if (severeWeatherCodes.has(weatherCode) || precipitationProbability >= 70) {
    return "HIGH";
  }

  if (precipitationProbability >= 40) {
    return "MEDIUM";
  }

  return "LOW";
};

export const fetchWeatherRiskSummary = async (
  rawInput: WeatherSearchInput,
): Promise<WeatherRiskSummary> => {
  const parsedInput = WeatherSearchInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw validationToolError(
      "open-meteo",
      "Invalid weather input",
      parsedInput.error,
    );
  }

  const geoResponse = await requestJson<unknown>({
    provider: "open-meteo-geocoding",
    url: "https://geocoding-api.open-meteo.com/v1/search",
    query: {
      name: parsedInput.data.destination,
      count: 1,
      language: "en",
      format: "json",
    },
    retries: 1,
  });

  const parsedGeo = GeocodingResponseSchema.safeParse(geoResponse);
  if (!parsedGeo.success) {
    throw validationToolError(
      "open-meteo-geocoding",
      "Unexpected geocoding response",
      parsedGeo.error,
    );
  }

  const location = parsedGeo.data.results?.[0];
  if (!location) {
    throw validationToolError(
      "open-meteo-geocoding",
      `Destination not found: ${parsedInput.data.destination}`,
    );
  }

  const forecastResponse = await requestJson<unknown>({
    provider: "open-meteo-forecast",
    url: "https://api.open-meteo.com/v1/forecast",
    query: {
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: "auto",
      start_date: parsedInput.data.startDate,
      end_date: parsedInput.data.endDate,
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    },
    retries: 1,
  });

  const parsedForecast = ForecastResponseSchema.safeParse(forecastResponse);
  if (!parsedForecast.success) {
    throw validationToolError(
      "open-meteo-forecast",
      "Unexpected forecast response",
      parsedForecast.error,
    );
  }

  const daily = parsedForecast.data.daily.time.map((date, index) => {
    const weatherCode = parsedForecast.data.daily.weather_code[index];
    const temperatureMax = parsedForecast.data.daily.temperature_2m_max[index];
    const temperatureMin = parsedForecast.data.daily.temperature_2m_min[index];
    const precipitationProbabilityMax =
      parsedForecast.data.daily.precipitation_probability_max[index];

    if (
      weatherCode === undefined ||
      temperatureMax === undefined ||
      temperatureMin === undefined ||
      precipitationProbabilityMax === undefined
    ) {
      throw validationToolError(
        "open-meteo-forecast",
        "Mismatched daily forecast vectors",
      );
    }

    return {
      date,
      weatherCode,
      temperatureMax,
      temperatureMin,
      precipitationProbabilityMax,
      riskLevel: toRiskLevel(weatherCode, precipitationProbabilityMax),
    } satisfies DailyWeather;
  });

  return {
    location: `${location.name}${location.country ? `, ${location.country}` : ""}`,
    timezone: location.timezone,
    daily,
    highRiskDates: daily
      .filter((item) => item.riskLevel === "HIGH")
      .map((item) => item.date),
  };
};
