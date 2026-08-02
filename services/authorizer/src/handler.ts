/**
 * HTTP API v2 Lambda authorizer (spec §3, §6).
 *
 * Bearer key (`mk_live_…`) → SHA-256 → `tenants` table lookup. Raw keys are
 * never stored; only the hash is compared. On an active tenant, the resolved
 * tenant context flows to handlers via the authorizer context. API Gateway
 * caches the SIMPLE result ~5 min keyed on the Authorization header, so this
 * runs at most once per token per window.
 */
import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

/** Tenant context passed to downstream handlers (all values must be strings). */
export interface TenantContext extends Record<string, string> {
  tenant_id: string;
  plan: string;
  status: string;
  name: string;
}

type Result = APIGatewaySimpleAuthorizerWithContextResult<Record<string, string>>;
const DENY: Result = { isAuthorized: false, context: {} };

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TENANTS = process.env.TABLE_TENANTS ?? "";

const BEARER_RE = /^Bearer\s+(mk_live_[A-Za-z0-9._-]+)$/;

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<Result> => {
  const header = event.headers?.authorization ?? event.headers?.Authorization ?? "";
  const match = BEARER_RE.exec(header.trim());
  if (!match) return DENY;

  const token = match[1]!;
  const keyHash = createHash("sha256").update(token).digest("hex");

  let item: Record<string, unknown> | undefined;
  try {
    const res = await ddb.send(
      new GetCommand({ TableName: TENANTS, Key: { key_hash: keyHash } }),
    );
    item = res.Item;
  } catch (err) {
    console.error("authorizer: tenant lookup failed", err);
    return DENY;
  }

  if (!item || item["status"] !== "active") return DENY;

  // Soft per-tenant quota counters (spec §3) are updated here once real metering
  // arrives with the second tenant; stage-level throttling is the hard backstop
  // in the meantime, so the authorizer stays a pure lookup for now.

  const context: TenantContext = {
    tenant_id: String(item["tenant_id"] ?? ""),
    plan: String(item["plan"] ?? "standard"),
    status: String(item["status"]),
    name: String(item["name"] ?? ""),
  };
  return { isAuthorized: true, context };
};
