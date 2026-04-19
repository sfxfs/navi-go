import { getEnv } from "../config/env.js";

export const configureTracingFromEnv = (): void => {
  const env = getEnv();
  if (!env.LANGSMITH_TRACING) {
    return;
  }

  process.env.LANGSMITH_TRACING = "true";
  process.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;

  if (env.LANGSMITH_API_KEY) {
    process.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
  }
};

export const buildTraceMetadata = (params: {
  userId: string;
  threadId: string;
  scenario: string;
}): Record<string, string> => {
  return {
    userId: params.userId,
    threadId: params.threadId,
    scenario: params.scenario,
    service: "navi-go",
  };
};
