import { ToolError, mapHttpFailureToToolError } from "./errors.js";

type JsonPrimitive = string | number | boolean | null;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type HttpRequestOptions = {
  provider: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: JsonObject | string;
  timeoutMs?: number;
  retries?: number;
  contentType?: string;
};

const defaultTimeoutMs = 15_000;
const defaultRetries = 2;

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const buildUrl = (url: string, query?: HttpRequestOptions["query"]): string => {
  if (!query) {
    return url;
  }

  const resolved = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    resolved.searchParams.set(key, String(value));
  }

  return resolved.toString();
};

export const requestJson = async <TResponse>(
  options: HttpRequestOptions,
): Promise<TResponse> => {
  const retries = options.retries ?? defaultRetries;
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const targetUrl = buildUrl(options.url, options.query);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const requestInit: RequestInit = {
        method,
        headers: {
          ...options.headers,
        },
        signal: abort.signal,
      };

      if (options.body !== undefined) {
        requestInit.body =
          typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body);

        const headers = requestInit.headers as Record<string, string>;
        if (!headers["content-type"]) {
          headers["content-type"] = options.contentType ?? "application/json";
        }
      }

      const response = await fetch(targetUrl, requestInit);

      if (!response.ok) {
        throw mapHttpFailureToToolError({
          provider: options.provider,
          status: response.status,
          message: `HTTP ${response.status} from ${options.provider}`,
        });
      }

      return (await response.json()) as TResponse;
    } catch (error) {
      const isFinalAttempt = attempt === retries;
      if (isFinalAttempt) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new ToolError({
            provider: options.provider,
            code: "UPSTREAM_TIMEOUT",
            message: `Timed out requesting ${options.provider}`,
            cause: error,
          });
        }

        if (error instanceof ToolError) {
          throw error;
        }

        if (error instanceof Error) {
          throw mapHttpFailureToToolError({
            provider: options.provider,
            message: error.message,
            cause: error,
          });
        }

        throw mapHttpFailureToToolError({
          provider: options.provider,
          message: "Unknown network failure",
          cause: error,
        });
      }

      await sleep(150 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw mapHttpFailureToToolError({
    provider: options.provider,
    message: "Unreachable retry branch",
  });
};
