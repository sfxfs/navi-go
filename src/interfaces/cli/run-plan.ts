import { buildPlannerGraph } from "../../graph/builder.js";
import { UserRequestSchema } from "../../graph/state.js";
import { buildTraceMetadata, configureTracingFromEnv } from "../../observability/tracing.js";

const argValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
};

export const runCliPlanner = async (): Promise<void> => {
  configureTracingFromEnv();

  const threadId = argValue("--thread-id") ?? "cli-thread";
  const requestText =
    argValue("--request") ??
    "Plan a balanced 4-day city trip with food and museums.";

  const userRequest = UserRequestSchema.parse({
    userId: argValue("--user-id") ?? "cli-user",
    requestText,
    originIata: argValue("--origin"),
    destinationHint: argValue("--destination-hint") ?? "Tokyo",
    destinationCityCode: argValue("--destination-city") ?? "TYO",
    destinationIata: argValue("--destination-iata") ?? "HND",
    travelStartDate: argValue("--start-date") ?? "2026-07-01",
    travelEndDate: argValue("--end-date") ?? "2026-07-04",
    budget: Number.parseFloat(argValue("--budget") ?? "2200"),
    adults: Number.parseInt(argValue("--adults") ?? "1", 10),
    children: Number.parseInt(argValue("--children") ?? "0", 10),
    interests: (argValue("--interests") ?? "food,museums,walks")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  });

  const graph = await buildPlannerGraph();
  const result = await graph.invoke(
    { userRequest },
    {
      configurable: { thread_id: threadId },
      metadata: buildTraceMetadata({
        userId: userRequest.userId,
        threadId,
        scenario: "cli",
      }),
    },
  );

  console.log(JSON.stringify({
    threadId,
    finalPlan: result.finalPlan,
    safetyFlags: result.safetyFlags,
  }, null, 2));
};
