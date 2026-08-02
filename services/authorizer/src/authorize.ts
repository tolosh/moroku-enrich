/**
 * Pure authorizer helpers (ext-001) — no AWS imports, unit-tested directly.
 *
 * Accepts both `mk_test_…` and `mk_live_…` keys. The plan/environment stored on
 * the tenant row flow into the authorizer context so handlers can meter test vs
 * live separately. A `suspended` tenant is denied.
 */
import { createHash } from "node:crypto";

export interface TenantContext extends Record<string, string> {
  tenant_id: string;
  plan: string;
  environment: string;
  status: string;
  name: string;
}

const BEARER_RE = /^Bearer\s+(mk_(?:test|live)_[A-Za-z0-9._-]+)$/;

/** Extract a valid `mk_test_`/`mk_live_` token from an Authorization header. */
export function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = BEARER_RE.exec(header.trim());
  return m ? m[1] : undefined;
}

/** SHA-256 hex of a bearer token — the `tenants` table primary key. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Build tenant context from a `tenants` row, or null when the row is missing or
 * the tenant is not `active` (revoked keys are `suspended`).
 *
 * Cache-lag note: API Gateway caches the SIMPLE authorizer result ~5 min keyed
 * on the Authorization header, so a key revoked mid-window keeps its cached
 * ALLOW until the TTL expires. On any cache miss this function denies a
 * suspended tenant immediately. Revocation is therefore effective within the
 * cache TTL (documented lag); shorten `resultsCacheTtl` if a tighter bound is
 * needed.
 */
export function tenantContextFrom(
  item: Record<string, unknown> | undefined,
): TenantContext | null {
  if (!item || item["status"] !== "active") return null;
  return {
    tenant_id: String(item["tenant_id"] ?? ""),
    plan: String(item["plan"] ?? "internal"),
    environment: String(item["environment"] ?? "live"),
    status: String(item["status"]),
    name: String(item["name"] ?? ""),
  };
}
