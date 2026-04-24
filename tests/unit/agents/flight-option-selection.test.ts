import { describe, expect, it } from "vitest";

import { pickRecommendedFlightOption } from "../../../src/agents/flight-option-selection.js";
import type { FlightOption } from "../../../src/graph/state.js";

const makeFlight = (partial: Partial<FlightOption> & Pick<FlightOption, "offerId">): FlightOption => ({
  offerId: partial.offerId,
  totalPrice: partial.totalPrice ?? 300,
  currency: partial.currency ?? "USD",
  seats: partial.seats,
  route: partial.route ?? ["SFO-HND"],
  departureAt: partial.departureAt ?? "2026-04-25T08:00:00",
  arrivalAt: partial.arrivalAt ?? "2026-04-25T16:00:00",
  carriers: partial.carriers ?? ["ZZ"],
});

describe("flight option selection", () => {
  it("prefers flights that arrive by the trip start date", () => {
    const options: FlightOption[] = [
      makeFlight({
        offerId: "late-cheap",
        totalPrice: 200,
        arrivalAt: "2026-04-26T22:11:00",
      }),
      makeFlight({
        offerId: "on-time",
        totalPrice: 260,
        arrivalAt: "2026-04-25T14:00:00",
      }),
    ];

    const recommended = pickRecommendedFlightOption(options, "2026-04-25");

    expect(recommended?.offerId).toBe("on-time");
  });

  it("prefers lower price when arrivals are equivalently timed", () => {
    const options: FlightOption[] = [
      makeFlight({
        offerId: "expensive",
        totalPrice: 420,
        arrivalAt: "2026-04-25T14:00:00",
      }),
      makeFlight({
        offerId: "cheaper",
        totalPrice: 280,
        arrivalAt: "2026-04-25T14:00:00",
      }),
    ];

    const recommended = pickRecommendedFlightOption(options, "2026-04-25");

    expect(recommended?.offerId).toBe("cheaper");
  });
});
