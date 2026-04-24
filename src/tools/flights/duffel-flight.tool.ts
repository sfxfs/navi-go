import { z } from "zod";

import { validationToolError } from "../common/errors.js";
import { duffelPost } from "../common/duffel.js";
import type { JsonObject } from "../common/http.js";
import type { FlightOption } from "../../graph/state.js";

export const FlightSearchInputSchema = z.object({
  originIata: z.string().regex(/^[A-Z]{3}$/),
  destinationIata: z.string().regex(/^[A-Z]{3}$/),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().positive().max(9).default(1),
  children: z.number().int().min(0).max(9).default(0),
  travelClass: z.enum(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]).optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  max: z.number().int().positive().max(20).default(10),
});

const DuffelOfferSchema = z.object({
  id: z.string(),
  total_amount: z.string(),
  total_currency: z.string(),
  slices: z.array(
    z.object({
      segments: z.array(
        z.object({
          departing_at: z.string(),
          arriving_at: z.string(),
          origin: z.object({ iata_code: z.string() }),
          destination: z.object({ iata_code: z.string() }),
          marketing_carrier: z.object({ iata_code: z.string() }).optional(),
        }),
      ),
    }),
  ),
});

const DuffelOfferRequestResponseSchema = z.object({
  data: z.object({
    offers: z.array(DuffelOfferSchema),
  }),
});

export type FlightSearchInput = z.input<typeof FlightSearchInputSchema>;

const mapTravelClass = (
  value: FlightSearchInput["travelClass"],
): "economy" | "premium_economy" | "business" | "first" | undefined => {
  if (!value) {
    return undefined;
  }

  switch (value) {
    case "ECONOMY":
      return "economy";
    case "PREMIUM_ECONOMY":
      return "premium_economy";
    case "BUSINESS":
      return "business";
    case "FIRST":
      return "first";
  }
};

const makePassengers = (adults: number, children: number): Array<{ type: "adult" | "child" }> => {
  return [
    ...Array.from({ length: adults }, () => ({ type: "adult" as const })),
    ...Array.from({ length: children }, () => ({ type: "child" as const })),
  ];
};

export const searchFlightOffers = async (
  rawInput: FlightSearchInput,
): Promise<FlightOption[]> => {
  const parsedInput = FlightSearchInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw validationToolError(
      "duffel-flight",
      "Invalid flight search input",
      parsedInput.error,
    );
  }

  const input = parsedInput.data;
  const requestData: JsonObject = {
    slices: [
      {
        origin: input.originIata,
        destination: input.destinationIata,
        departure_date: input.departureDate,
      },
    ],
    passengers: makePassengers(input.adults, input.children),
  };

  const cabinClass = input.travelClass ? mapTravelClass(input.travelClass) : undefined;
  if (cabinClass) {
    requestData.cabin_class = cabinClass;
  }
  requestData.limit = input.max;

  const response = await duffelPost<unknown>({
    provider: "duffel-flight",
    path: "/air/offer_requests",
    body: { data: requestData },
  });

  const parsed = DuffelOfferRequestResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw validationToolError(
      "duffel-flight",
      "Unexpected Duffel offer payload",
      parsed.error,
    );
  }

  return parsed.data.data.offers.map((offer) => {
    const firstSegment = offer.slices[0]?.segments[0];
    const lastSlice = offer.slices[offer.slices.length - 1];
    const lastSegment = lastSlice?.segments[lastSlice.segments.length - 1];

    if (!firstSegment || !lastSegment) {
      throw validationToolError(
        "duffel-flight",
        "Duffel offer missing route segments",
        offer,
      );
    }

    return {
      offerId: offer.id,
      totalPrice: Number.parseFloat(offer.total_amount),
      currency: offer.total_currency,
      seats: undefined,
      route: offer.slices.flatMap((slice) =>
        slice.segments.map(
          (segment) => `${segment.origin.iata_code}-${segment.destination.iata_code}`,
        ),
      ),
      departureAt: firstSegment.departing_at,
      arrivalAt: lastSegment.arriving_at,
      carriers: [
        ...new Set(
          offer.slices.flatMap((slice) =>
            slice.segments
              .map((segment) => segment.marketing_carrier?.iata_code)
              .filter((code): code is string => code !== undefined),
          ),
        ),
      ],
    };
  });
};
