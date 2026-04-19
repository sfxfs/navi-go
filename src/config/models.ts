import { ChatOpenAI } from "@langchain/openai";

import { getEnv, requireOpenAiApiKey } from "./env.js";

export const createPlanningModel = (): ChatOpenAI => {
  const env = getEnv();

  return new ChatOpenAI({
    apiKey: requireOpenAiApiKey(),
    model: env.OPENAI_MODEL,
    temperature: 0.2,
  });
};
