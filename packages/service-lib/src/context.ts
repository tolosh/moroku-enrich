/**
 * Tenant context — the Lambda authorizer resolves the bearer key to a tenant
 * and passes it via the request-context authorizer fields (spec §3). Handlers
 * read it here; they never see or hash the raw key.
 */
import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from "aws-lambda";

export interface TenantContext {
  tenant_id: string;
  plan: string;
  /** `test` | `live` — usage metering is split by environment (ext-001). */
  environment: string;
  status: string;
  name: string;
}

export type AuthedEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<
  Partial<TenantContext>
>;

/** Extract tenant context, or undefined if the authorizer context is absent. */
export function tenantFrom(event: AuthedEvent): TenantContext | undefined {
  const ctx = event.requestContext.authorizer?.lambda;
  if (!ctx || !ctx.tenant_id) return undefined;
  return {
    tenant_id: String(ctx.tenant_id),
    plan: String(ctx.plan ?? "internal"),
    environment: String(ctx.environment ?? "live"),
    status: String(ctx.status ?? "active"),
    name: String(ctx.name ?? ""),
  };
}
