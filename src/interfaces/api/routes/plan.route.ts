import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { PlannerCompiledGraph } from "../../../graph/builder.js";
import { UserRequestSchema } from "../../../graph/state.js";
import { ToolError } from "../../../tools/common/errors.js";
import { buildTraceMetadata } from "../../../observability/tracing.js";

const PlanPayloadSchema = z.object({
  threadId: z.string().min(1),
  scenario: z.string().min(1).default("api"),
  userRequest: UserRequestSchema,
});

const ThreadParamsSchema = z.object({
  threadId: z.string().min(1),
});

export const registerPlanRoutes = (
  app: FastifyInstance,
  graph: PlannerCompiledGraph,
): void => {
  app.post("/plan", async (request, reply) => {
    const payload = PlanPayloadSchema.parse(request.body);

    try {
      const result = await graph.invoke(
        {
          userRequest: payload.userRequest,
        },
        {
          configurable: { thread_id: payload.threadId },
          metadata: buildTraceMetadata({
            userId: payload.userRequest.userId,
            threadId: payload.threadId,
            scenario: payload.scenario,
          }),
        },
      );

      return reply.send({
        threadId: payload.threadId,
        finalPlan: result.finalPlan,
        safetyFlags: result.safetyFlags,
        decisionLog: result.decisionLog,
      });
    } catch (error) {
      if (error instanceof ToolError) {
        return reply.status(502).send({
          error: error.code,
          provider: error.provider,
          message: error.message,
        });
      }

      throw error;
    }
  });

  app.get("/plan/:threadId", async (request, reply) => {
    const params = ThreadParamsSchema.parse(request.params);
    const snapshot = await graph.getState({
      configurable: {
        thread_id: params.threadId,
      },
    });

    return reply.send({
      threadId: params.threadId,
      next: snapshot.next,
      values: snapshot.values,
      metadata: snapshot.metadata,
      createdAt: snapshot.createdAt,
    });
  });
};
