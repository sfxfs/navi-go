import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { describe, expect, it } from "vitest";

import { requestJson } from "../../../src/tools/common/http.js";

type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
) => void;

const withServer = async <T>(
  handler: HttpHandler,
  run: (url: string) => Promise<T>,
): Promise<T> => {
  const server = createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to resolve test server address");
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
};

describe("requestJson", () => {
  it("sends query params and parses json", async () => {
    const response = await withServer(
      (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ echoed: url.searchParams.get("city") }));
      },
      (baseUrl) =>
        requestJson<{ echoed: string | null }>({
          provider: "test-provider",
          url: `${baseUrl}/echo`,
          query: { city: "TYO" },
        }),
    );

    expect(response).toEqual({ echoed: "TYO" });
  });

  it("raises timeout error when upstream stalls", async () => {
    await expect(
      withServer(
        () => {
          // intentionally no response to trigger timeout
        },
        (baseUrl) =>
          requestJson({
            provider: "timeout-provider",
            url: `${baseUrl}/timeout`,
            timeoutMs: 30,
            retries: 0,
          }),
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
      provider: "timeout-provider",
    });
  });
});
