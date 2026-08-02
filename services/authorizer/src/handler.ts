/**
 * HTTP API v2 Lambda authorizer (spec §3, §6; ext-001).
 *
 * Bearer key (`mk_test_…` / `mk_live_…`) → SHA-256 → `tenants` table lookup. Raw
 * keys are never stored; only the hash is compared. On an active tenant, the
 * resolved context (incl. plan + environment) flows to handlers. API Gateway
 * caches the SIMPLE result ~5 min keyed on the Authorization header.
 */
import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { parseBearer, hashToken, tenantContextFrom } from "./authorize.js";

type Result = APIGatewaySimpleAuthorizerWithContextResult<Record<string, string>>;
const DENY: Result = { isAuthorized: false, context: {} };

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TENANTS = process.env.TABLE_TENANTS ?? "";

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<Result> => {
  const header = event.headers?.authorization ?? event.headers?.Authorization ?? "";
  const token = parseBearer(header);
  if (!token) return DENY;

  let item: Record<string, unknown> | undefined;
  try {
    const res = await ddb.send(
      new GetCommand({ TableName: TENANTS, Key: { key_hash: hashToken(token) } }),
    );
    item = res.Item;
  } catch (err) {
    console.error("authorizer: tenant lookup failed", err);
    return DENY;
  }

  const context = tenantContextFrom(item);
  if (!context) return DENY;

  // Soft per-tenant quota counters (spec §3) are enforced here once real
  // metering gates access with the second tenant; usage is metered in the
  // handlers today (ext-001). Stage throttling is the hard backstop meanwhile.
  return { isAuthorized: true, context };
};
