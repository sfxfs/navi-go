import { getEnv, requireDuffelApiToken } from "../../config/env.js";
import { requestJson, type JsonObject } from "./http.js";

const defaultDuffelVersion = "v2";

export const getDuffelBaseUrl = (): string => {
  return getEnv().DUFFEL_BASE_URL;
};

export const duffelPost = async <TResponse>(params: {
  path: string;
  body: JsonObject;
  provider: string;
}): Promise<TResponse> => {
  const token = requireDuffelApiToken();

  return requestJson<TResponse>({
    provider: params.provider,
    method: "POST",
    url: `${getDuffelBaseUrl()}${params.path}`,
    body: params.body,
    headers: {
      authorization: `Bearer ${token}`,
      "duffel-version": defaultDuffelVersion,
    },
    retries: 2,
  });
};
