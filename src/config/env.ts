import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  DUFFEL_API_TOKEN: z.string().min(1).optional(),
  DUFFEL_BASE_URL: z.string().url().default("https://api.duffel.com"),
  EXPEDIA_RAPID_API_KEY: z.string().min(1).optional(),
  EXPEDIA_RAPID_SHARED_SECRET: z.string().min(1).optional(),
  EXPEDIA_RAPID_BASE_URL: z.string().url().default("https://test.ean.com"),
  POSTGRES_URL: z.string().url().optional(),
  LANGSMITH_TRACING: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("navi-go"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;

export const getEnv = (): Env => {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
};

export const requireOpenAiApiKey = (): string => {
  const key = getEnv().OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for model-backed planning");
  }

  return key;
};

export const requireDuffelApiToken = (): string => {
  const token = getEnv().DUFFEL_API_TOKEN;
  if (!token) {
    throw new Error("DUFFEL_API_TOKEN is required for flight search");
  }

  return token;
};

export const requireExpediaRapidCredentials = (): {
  apiKey: string;
  sharedSecret: string;
} => {
  const env = getEnv();
  if (!env.EXPEDIA_RAPID_API_KEY || !env.EXPEDIA_RAPID_SHARED_SECRET) {
    throw new Error(
      "EXPEDIA_RAPID_API_KEY and EXPEDIA_RAPID_SHARED_SECRET are required for hotel search",
    );
  }

  return {
    apiKey: env.EXPEDIA_RAPID_API_KEY,
    sharedSecret: env.EXPEDIA_RAPID_SHARED_SECRET,
  };
};

export const requirePostgresUrl = (): string => {
  const postgresUrl = getEnv().POSTGRES_URL;
  if (!postgresUrl) {
    throw new Error("POSTGRES_URL is required for Postgres checkpointer");
  }

  return postgresUrl;
};
