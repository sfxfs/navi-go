import { createHash } from "node:crypto";

import { getEnv, requireExpediaRapidCredentials } from "../../config/env.js";
import { requestJson } from "./http.js";

const defaultLanguage = "en-US";

const buildAuthorizationHeader = (): string => {
  const credentials = requireExpediaRapidCredentials();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash("sha512")
    .update(
      `${credentials.apiKey}${credentials.sharedSecret}${timestamp}`,
      "utf8",
    )
    .digest("hex");

  return `EAN APIKey=${credentials.apiKey},Signature=${signature},timestamp=${timestamp}`;
};

export const getExpediaRapidBaseUrl = (): string => {
  return getEnv().EXPEDIA_RAPID_BASE_URL;
};

export const expediaRapidGet = async <TResponse>(params: {
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  provider: string;
  language?: string;
}): Promise<TResponse> => {
  return requestJson<TResponse>({
    provider: params.provider,
    method: "GET",
    url: `${getExpediaRapidBaseUrl()}${params.path}`,
    ...(params.query ? { query: params.query } : {}),
    headers: {
      authorization: buildAuthorizationHeader(),
      accept: "application/json",
      "accept-encoding": "gzip",
      "accept-language": params.language ?? defaultLanguage,
      "user-agent": "navi-go/0.1",
    },
    retries: 2,
  });
};
