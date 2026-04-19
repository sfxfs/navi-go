import Fastify, { type FastifyInstance } from "fastify";

import {
  buildPlannerGraph,
  type PlannerCompiledGraph,
} from "../../graph/builder.js";
import { getEnv } from "../../config/env.js";
import { registerPlanRoutes } from "./routes/plan.route.js";
import { configureTracingFromEnv } from "../../observability/tracing.js";

export const createApiServer = async (deps?: {
  graph?: PlannerCompiledGraph;
}): Promise<FastifyInstance> => {
  configureTracingFromEnv();

  const graph = deps?.graph ?? (await buildPlannerGraph());
  const app = Fastify({ logger: true });

  registerPlanRoutes(app, graph);

  app.get("/health", async () => {
    return { status: "ok" };
  });

  return app;
};

export const startApiServer = async (): Promise<FastifyInstance> => {
  const env = getEnv();
  const app = await createApiServer();

  await app.listen({
    port: env.PORT,
    host: "0.0.0.0",
  });

  return app;
};
