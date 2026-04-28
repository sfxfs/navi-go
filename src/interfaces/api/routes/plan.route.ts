import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import type { PlannerCompiledGraph } from "../../../graph/builder.js";
import {
  ParsedRequestSchema,
  UserRequestSchema,
} from "../../../graph/state.js";
import { ToolError } from "../../../tools/common/errors.js";
import { buildTraceMetadata } from "../../../observability/tracing.js";

const PlanPayloadSchema = z.object({
  threadId: z.string().min(1),
  scenario: z.string().min(1).default("api"),
  userRequest: UserRequestSchema,
});

const ChatPayloadSchema = z.object({
  threadId: z.string().min(1),
  scenario: z.string().min(1).default("api-chat"),
  naturalLanguage: z.string().min(1),
  context: ParsedRequestSchema.optional(),
});

const ChatResumePayloadSchema = z.object({
  threadId: z.string().min(1),
  scenario: z.string().min(1).default("api-chat"),
  answers: ParsedRequestSchema,
});

const ThreadParamsSchema = z.object({
  threadId: z.string().min(1),
});

const handleGraphError = (
  error: unknown,
  request: { log: { error: (msg: unknown, label: string) => void } },
  reply: {
    status: (code: number) => { send: (payload: unknown) => void };
    send: (payload: unknown) => void;
  },
): void => {
  if (error instanceof ZodError) {
    reply.status(400).send({
      error: "VALIDATION_ERROR",
      issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
    return;
  }

  if (error instanceof ToolError) {
    reply.status(502).send({
      error: error.code,
      provider: error.provider,
      message: error.message,
    });
    return;
  }

  request.log.error(error, "Unhandled error during plan invocation");
  reply.status(500).send({
    error: "INTERNAL_ERROR",
    message: "An unexpected error occurred while processing the plan.",
  });
};

export const registerPlanRoutes = (
  app: FastifyInstance,
  graph: PlannerCompiledGraph,
): void => {
  app.post("/plan", async (request, reply) => {
    try {
      const payload = PlanPayloadSchema.parse(request.body);
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
      handleGraphError(error, request, reply);
    }
  });

  app.post("/plan/chat", async (request, reply) => {
    try {
      const payload = ChatPayloadSchema.parse(request.body);
      const result = await graph.invoke(
        {
          naturalLanguage: payload.naturalLanguage,
          parsedRequest: payload.context ?? null,
        },
        {
          configurable: { thread_id: payload.threadId },
          metadata: buildTraceMetadata({
            userId: payload.context?.userId ?? "anonymous",
            threadId: payload.threadId,
            scenario: payload.scenario,
          }),
        },
      );

      if (result.pendingQuestions && result.pendingQuestions.length > 0) {
        return reply.send({
          threadId: payload.threadId,
          status: "awaiting_input",
          pendingQuestions: result.pendingQuestions,
          parsedRequest: result.parsedRequest,
          decisionLog: result.decisionLog,
        });
      }

      return reply.send({
        threadId: payload.threadId,
        status: result.finalPlan ? "complete" : "in_progress",
        finalPlan: result.finalPlan,
        safetyFlags: result.safetyFlags,
        decisionLog: result.decisionLog,
      });
    } catch (error) {
      handleGraphError(error, request, reply);
    }
  });

  app.post("/plan/chat/resume", async (request, reply) => {
    try {
      const payload = ChatResumePayloadSchema.parse(request.body);
      const snapshot = await graph.getState({
        configurable: { thread_id: payload.threadId },
      });

      const currentParsed = snapshot.values.parsedRequest ?? {};
      const mergedParsed = ParsedRequestSchema.safeParse({
        ...currentParsed,
        ...payload.answers,
      });

      if (!mergedParsed.success) {
        return reply.status(400).send({
          error: "VALIDATION_ERROR",
          message: "Merged parsed request is invalid",
          issues: mergedParsed.error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        });
      }

      const result = await graph.invoke(
        {
          parsedRequest: mergedParsed.data,
          pendingQuestions: [],
        },
        {
          configurable: { thread_id: payload.threadId },
          metadata: buildTraceMetadata({
            userId:
              mergedParsed.data.userId ??
              snapshot.values.userRequest?.userId ??
              "anonymous",
            threadId: payload.threadId,
            scenario: payload.scenario,
          }),
        },
      );

      if (result.pendingQuestions && result.pendingQuestions.length > 0) {
        return reply.send({
          threadId: payload.threadId,
          status: "awaiting_input",
          pendingQuestions: result.pendingQuestions,
          parsedRequest: result.parsedRequest,
          decisionLog: result.decisionLog,
        });
      }

      return reply.send({
        threadId: payload.threadId,
        status: result.finalPlan ? "complete" : "in_progress",
        finalPlan: result.finalPlan,
        safetyFlags: result.safetyFlags,
        decisionLog: result.decisionLog,
      });
    } catch (error) {
      handleGraphError(error, request, reply);
    }
  });

  app.get("/plan/:threadId", async (request, reply) => {
    try {
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
    } catch (error) {
      handleGraphError(error, request, reply);
    }
  });
};
