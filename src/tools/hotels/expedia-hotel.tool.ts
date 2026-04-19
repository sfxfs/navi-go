import { z } from "zod";

import { validationToolError } from "../common/errors.js";
import { expediaRapidGet } from "../common/expedia.js";

export const HotelSearchInputSchema = z.object({
  cityCode: z.string().regex(/^[A-Z]{3}$/),
  destinationQuery: z.string().min(2).optional(),
  checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().positive().max(9).default(2),
  roomQuantity: z.number().int().positive().max(4).default(1),
  maxHotels: z.number().int().positive().max(20).default(8),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  countryCode: z.string().regex(/^[A-Z]{2}$/).default("US"),
});

const RegionsResponseSchema = z.array(
  z.object({
    id: z.string(),
    property_ids: z.array(z.string()).optional(),
    property_ids_expanded: z.array(z.string()).optional(),
  }),
);

const AvailabilityResponseSchema = z.array(
  z.object({
    property_id: z.union([z.string(), z.number()]),
    rooms: z
      .array(
        z.object({
          room_name: z.string().optional(),
          rates: z
            .array(
              z.object({
                occupancy_pricing: z.record(
                  z.object({
                    totals: z.object({
                      inclusive: z
                        .object({
                          request_currency: z
                            .object({
                              value: z.string(),
                              currency: z.string(),
                            })
                            .optional(),
                          billable_currency: z.object({
                            value: z.string(),
                            currency: z.string(),
                          }),
                        })
                        .optional(),
                      property_inclusive: z
                        .object({
                          request_currency: z
                            .object({
                              value: z.string(),
                              currency: z.string(),
                            })
                            .optional(),
                          billable_currency: z.object({
                            value: z.string(),
                            currency: z.string(),
                          }),
                        })
                        .optional(),
                    }),
                  }),
                ),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  }),
);

export type HotelSearchInput = z.input<typeof HotelSearchInputSchema>;

export type HotelOption = {
  hotelId: string;
  name: string;
  rating: number | undefined;
  checkInDate: string;
  checkOutDate: string;
  totalPrice: number;
  currency: string;
};

const findPrice = (item: z.infer<typeof AvailabilityResponseSchema>[number]): {
  totalPrice: number;
  currency: string;
} | null => {
  for (const room of item.rooms ?? []) {
    for (const rate of room.rates ?? []) {
      for (const pricing of Object.values(rate.occupancy_pricing)) {
        const totals = pricing.totals;
        const preferred =
          totals.property_inclusive?.request_currency ??
          totals.property_inclusive?.billable_currency ??
          totals.inclusive?.request_currency ??
          totals.inclusive?.billable_currency;

        if (!preferred) {
          continue;
        }

        const parsedPrice = Number.parseFloat(preferred.value);
        if (!Number.isNaN(parsedPrice)) {
          return {
            totalPrice: parsedPrice,
            currency: preferred.currency,
          };
        }
      }
    }
  }

  return null;
};

const resolveRegionPropertyIds = (
  regions: z.infer<typeof RegionsResponseSchema>,
): string[] => {
  const primary = regions[0];
  if (!primary) {
    return [];
  }

  return primary.property_ids ?? primary.property_ids_expanded ?? [];
};

export const searchHotelOffers = async (
  rawInput: HotelSearchInput,
): Promise<HotelOption[]> => {
  const parsedInput = HotelSearchInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw validationToolError(
      "expedia-hotel",
      "Invalid hotel search input",
      parsedInput.error,
    );
  }

  const input = parsedInput.data;

  const regionsResponse = await expediaRapidGet<unknown>({
    provider: "expedia-geography",
    path: "/v3/regions",
    query: {
      include: "property_ids_expanded",
      language: "en-US",
      iata_location_code: input.cityCode,
      type: "city",
      supply_source: "expedia",
      limit: 1,
      ...(input.destinationQuery ? { keyword: input.destinationQuery } : {}),
    },
  });

  const parsedRegions = RegionsResponseSchema.safeParse(regionsResponse);
  if (!parsedRegions.success) {
    throw validationToolError(
      "expedia-geography",
      "Unexpected regions payload",
      parsedRegions.error,
    );
  }

  const propertyIds = resolveRegionPropertyIds(parsedRegions.data).slice(
    0,
    input.maxHotels,
  );
  if (propertyIds.length === 0) {
    return [];
  }

  const availabilityResponse = await expediaRapidGet<unknown>({
    provider: "expedia-availability",
    path: "/v3/properties/availability",
    query: {
      checkin: input.checkInDate,
      checkout: input.checkOutDate,
      currency: input.currencyCode,
      country_code: input.countryCode,
      language: "en-US",
      occupancy: String(input.adults),
      property_id: propertyIds.join(","),
      rate_plan_count: 1,
      sales_channel: "website",
      sales_environment: "hotel_only",
    },
  });

  const parsedAvailability = AvailabilityResponseSchema.safeParse(
    availabilityResponse,
  );
  if (!parsedAvailability.success) {
    throw validationToolError(
      "expedia-availability",
      "Unexpected availability payload",
      parsedAvailability.error,
    );
  }

  return parsedAvailability.data
    .flatMap((propertyItem) => {
      const resolved = findPrice(propertyItem);
      if (!resolved) {
        return [];
      }

      const propertyId = String(propertyItem.property_id);
      const roomName = propertyItem.rooms?.[0]?.room_name;

      return [
        {
          hotelId: propertyId,
          name: roomName ? `${roomName} (${propertyId})` : `Property ${propertyId}`,
          rating: undefined,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          totalPrice: resolved.totalPrice,
          currency: resolved.currency,
        },
      ];
    })
    .sort((a, b) => a.totalPrice - b.totalPrice);
};
