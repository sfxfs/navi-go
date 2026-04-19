import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { requirePostgresUrl } from "../config/env.js";

export const createPostgresCheckpointer = async (
  connString?: string,
): Promise<BaseCheckpointSaver> => {
  const connectionString = connString ?? requirePostgresUrl();
  const saver = PostgresSaver.fromConnString(connectionString);
  await saver.setup();
  return saver;
};

export const createInMemoryCheckpointer = (): BaseCheckpointSaver => {
  return new MemorySaver();
};
