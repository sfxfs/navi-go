import type { FlightOption } from "../graph/state.js";

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

const toIsoCalendarDate = (value: string): string | undefined => {
  const matched = ISO_DATE_PREFIX.exec(value);
  return matched?.[0];
};

const compareOptionalNumbers = (left: number | undefined, right: number | undefined): number => {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined) {
    return 1;
  }

  if (right === undefined) {
    return -1;
  }

  return left - right;
};

const toTimestamp = (value: string): number | undefined => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const compareFlightOptions = (
  left: FlightOption,
  right: FlightOption,
  travelStartDate: string | undefined,
): number => {
  const leftArrivalDate = toIsoCalendarDate(left.arrivalAt);
  const rightArrivalDate = toIsoCalendarDate(right.arrivalAt);

  const leftArrivesAfterStart =
    travelStartDate !== undefined && leftArrivalDate !== undefined
      ? leftArrivalDate > travelStartDate
      : false;
  const rightArrivesAfterStart =
    travelStartDate !== undefined && rightArrivalDate !== undefined
      ? rightArrivalDate > travelStartDate
      : false;

  if (leftArrivesAfterStart !== rightArrivesAfterStart) {
    return leftArrivesAfterStart ? 1 : -1;
  }

  const arrivalTimestampComparison = compareOptionalNumbers(
    toTimestamp(left.arrivalAt),
    toTimestamp(right.arrivalAt),
  );
  if (arrivalTimestampComparison !== 0) {
    return arrivalTimestampComparison;
  }

  if (left.totalPrice !== right.totalPrice) {
    return left.totalPrice - right.totalPrice;
  }

  const departureTimestampComparison = compareOptionalNumbers(
    toTimestamp(left.departureAt),
    toTimestamp(right.departureAt),
  );
  if (departureTimestampComparison !== 0) {
    return departureTimestampComparison;
  }

  return left.offerId.localeCompare(right.offerId);
};

export const pickRecommendedFlightOption = (
  flightOptions: FlightOption[],
  travelStartDate: string | undefined,
): FlightOption | undefined => {
  if (flightOptions.length === 0) {
    return undefined;
  }

  return [...flightOptions].sort((left, right) =>
    compareFlightOptions(left, right, travelStartDate),
  )[0];
};

export const getFlightCalendarDate = (timestamp: string): string | undefined => {
  return toIsoCalendarDate(timestamp);
};
