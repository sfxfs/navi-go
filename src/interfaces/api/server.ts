import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyRateLimit from "@fastify/rate-limit";

import {
  buildPlannerGraph,
  type PlannerCompiledGraph,
} from "../../graph/builder.js";
import { getEnv } from "../../config/env.js";
import { registerPlanRoutes } from "./routes/plan.route.js";
import { configureTracingFromEnv } from "../../observability/tracing.js";
import { createPostgresCheckpointer } from "../../persistence/checkpointer.js";

export const createApiServer = async (deps?: {
  graph?: PlannerCompiledGraph;
}): Promise<FastifyInstance> => {
  configureTracingFromEnv();

  const graph =
    deps?.graph ??
    (await buildPlannerGraph({
      checkpointer: await createPostgresCheckpointer(),
    }));
  const app = Fastify({ logger: true });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), "public"),
    prefix: "/",
    index: ["index.html"],
  });

  registerPlanRoutes(app, graph);

  app.get("/health", async () => {
    const env = getEnv();
    let dbStatus: "connected" | "disconnected" = "disconnected";

    if (env.POSTGRES_URL) {
      try {
        // Lightweight connectivity check via a throwaway state lookup
        await graph.getState({
          configurable: { thread_id: "__health_check__" },
        });
        dbStatus = "connected";
      } catch {
        dbStatus = "disconnected";
      }
    } else {
      dbStatus = "connected"; // in-memory checkpointer always available
    }

    return {
      status: dbStatus === "connected" ? "ok" : "degraded",
      db: dbStatus,
      uptime: process.uptime(),
    };
  });

  return app;
};

export const startApiServer = async (): Promise<FastifyInstance> => {
  const env = getEnv();
  const app = await createApiServer();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  await app.listen({
    port: env.PORT,
    host: "0.0.0.0",
  });

  return app;
};
