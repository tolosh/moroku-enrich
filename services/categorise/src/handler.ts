/**
 * POST /v1/categorise (spec §3.1) — batch categorisation.
 *
 * Stub for the CDK build (task 1). Real implementation (task 4) adds zod
 * validation at the boundary and drives the engine signal chain with batched
 * DynamoDB lookups injected per tier.
 */
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 501,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ error: "not_implemented", endpoint: "categorise" }),
});
