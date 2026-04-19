import type { ZodType } from "zod";

const injectionPatterns: RegExp[] = [
  /ignore (all|previous|prior) instructions/i,
  /reveal (the )?(system|developer) prompt/i,
  /bypass (safety|guard|policy)/i,
  /act as .* without restrictions/i,
  /disable (security|guardrails?)/i,
];

const unsafeOutputPatterns: RegExp[] = [
  /how to (build|make) (a )?(bomb|weapon)/i,
  /illegal trafficking/i,
  /evade law enforcement/i,
  /self-harm instructions/i,
];

export const detectPromptInjection = (input: string): string[] => {
  return injectionPatterns
    .filter((pattern) => pattern.test(input))
    .map((pattern) => `PROMPT_INJECTION:${pattern.source}`);
};

export const detectUnsafeOutput = (output: string): string[] => {
  return unsafeOutputPatterns
    .filter((pattern) => pattern.test(output))
    .map((pattern) => `UNSAFE_OUTPUT:${pattern.source}`);
};

export const validateWithSchema = <T>(schema: ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Schema validation failed: ${parsed.error.message}`);
  }

  return parsed.data;
};
