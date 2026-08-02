/**
 * POST /v1/corrections (spec §3.2) — the learning loop.
 *
 * Stub for the CDK build (task 1). Real implementation (task 4) adds zod
 * validation, the user/tenant/global learning tiers, the poisoning guard, the
 * immutable corrections_log append, and Idempotency-Key support.
 */
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 501,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ error: "not_implemented", endpoint: "corrections" }),
});
