import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

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

  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), "public"),
    prefix: "/",
    index: ["index.html"],
  });

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
