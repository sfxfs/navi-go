import type { z } from "zod";

export class FakeStructuredChatModel {
  public constructor(private readonly outputs: Record<string, unknown>) {}

  public withStructuredOutput<TReturn extends Record<string, unknown>>(
    schema: z.ZodType<TReturn>,
    config?: { name?: string },
  ): { invoke: (prompt: string) => Promise<TReturn> } {
    const key = config?.name ?? "default";

    return {
      invoke: async (prompt: string) => {
        void prompt;
        return schema.parse(this.outputs[key]);
      },
    };
  }
}
