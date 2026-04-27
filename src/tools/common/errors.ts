export type ToolErrorCode =
  | "AUTH_ERROR"
  | "RATE_LIMIT"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_BAD_RESPONSE"
  | "NETWORK_ERROR"
  | "VALIDATION_ERROR";

export class ToolError extends Error {
  public readonly code: ToolErrorCode;
  public readonly status: number | undefined;
  public readonly provider: string;

  public constructor(params: {
    message: string;
    code: ToolErrorCode;
    provider: string;
    status?: number;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = "ToolError";
    this.code = params.code;
    this.status = params.status;
    this.provider = params.provider;
  }
}

export const mapHttpFailureToToolError = (params: {
  provider: string;
  status?: number;
  message: string;
  cause?: unknown;
}): ToolError => {
  if (params.status === 401 || params.status === 403) {
    return new ToolError({
      provider: params.provider,
      code: "AUTH_ERROR",
      status: params.status,
      message: params.message,
      cause: params.cause,
    });
  }

  if (params.status === 429) {
    return new ToolError({
      provider: params.provider,
      code: "RATE_LIMIT",
      status: params.status,
      message: params.message,
      cause: params.cause,
    });
  }

  if (params.status !== undefined && params.status >= 500) {
    return new ToolError({
      provider: params.provider,
      code: "UPSTREAM_BAD_RESPONSE",
      status: params.status,
      message: params.message,
      cause: params.cause,
    });
  }

  if (params.status !== undefined) {
    return new ToolError({
      provider: params.provider,
      code: "UPSTREAM_BAD_RESPONSE",
      status: params.status,
      message: params.message,
      cause: params.cause,
    });
  }

  return new ToolError({
    provider: params.provider,
    code: "NETWORK_ERROR",
    message: params.message,
    cause: params.cause,
  });
};

export const validationToolError = (
  provider: string,
  message: string,
  cause?: unknown,
): ToolError => {
  return new ToolError({
    provider,
    code: "VALIDATION_ERROR",
    message,
    cause,
  });
};
