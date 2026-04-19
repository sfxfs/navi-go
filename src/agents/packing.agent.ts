import { makeDecisionLog, type PlannerState } from "../graph/state.js";

export const runPackingAgent = async (
  state: PlannerState,
): Promise<Partial<PlannerState>> => {
  if (!state.weatherRisks) {
    return {};
  }

  const baseItems = [
    "Passport and travel documents",
    "Phone charger and power adapter",
    "Daily medication kit",
  ];

  const weatherItems = new Set<string>();
  const activityItems = new Set<string>();

  for (const day of state.weatherRisks.daily) {
    if (day.precipitationProbabilityMax >= 50) {
      weatherItems.add("Compact umbrella");
      weatherItems.add("Waterproof jacket");
    }
    if (day.temperatureMin < 10) {
      weatherItems.add("Warm mid-layer");
    }
    if (day.temperatureMax >= 28) {
      weatherItems.add("Sunscreen");
      weatherItems.add("Reusable water bottle");
    }
  }

  for (const day of state.itineraryDraft) {
    const normalized = day.activities.join(" ").toLowerCase();
    if (normalized.includes("tour") || normalized.includes("exploration")) {
      activityItems.add("Comfortable walking shoes");
    }
    if (normalized.includes("indoor")) {
      activityItems.add("Light indoor layers");
    }
  }

  const packingList = [...new Set([...baseItems, ...weatherItems, ...activityItems])];

  return {
    packingList,
    decisionLog: [
      makeDecisionLog({
        agent: "packing_agent",
        inputSummary: "Mapped weather and activities to packing checklist",
        keyEvidence: [
          `forecastDays=${state.weatherRisks.daily.length}`,
          `highRiskDays=${state.weatherRisks.highRiskDates.length}`,
        ],
        outputSummary: `Prepared ${packingList.length} packing items`,
        riskFlags: [],
      }),
    ],
  };
};
