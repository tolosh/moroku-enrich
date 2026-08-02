/**
 * Read endpoints (spec §3.3): GET /v1/taxonomy, /v1/merchants/{match_key},
 * /v1/overrides, DELETE /v1/overrides/{id}, GET /v1/health.
 *
 * Stub for the CDK build (task 1) — health already answers so the deployed API
 * has a working liveness probe. Real implementation lands in task 4.
 */
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.rawPath?.endsWith("/v1/health")) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ok", stage: process.env.STAGE ?? "dev" }),
    };
  }
  return {
    statusCode: 501,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "not_implemented", path: event.rawPath }),
  };
};
