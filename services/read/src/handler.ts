/**
 * Read endpoints (spec §3.3):
 *   GET    /v1/health                     — liveness + engine/taxonomy versions (unauth)
 *   GET    /v1/taxonomy                   — categories, classifications, versions
 *   GET    /v1/merchants/{match_key}      — current global mapping
 *   GET    /v1/overrides?user_ref=…       — a user's learned overrides
 *   DELETE /v1/overrides/{id}             — revoke one (logs it; keeps history)
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ENGINE_VERSION, TAXONOMY_VERSION } from "@moroku-enrich/engine";
import { taxonomyDocument } from "@moroku-enrich/taxonomy";
import {
  loadConfig,
  tenantFrom,
  json,
  error,
  toErrorResponse,
  DynamoRepository,
  type AuthedEvent,
  type Config,
  type Repository,
} from "@moroku-enrich/service-lib";

/** Build the delete id for an override so clients can revoke it. */
function overrideId(userRef: string, matchKey: string): string {
  return `${encodeURIComponent(userRef)}~${encodeURIComponent(matchKey)}`;
}

/** Build the handler over an injected repo/config (tests supply fakes). */
export function makeReadHandler(repo: Repository, cfg: Config) {
  return async (
    event: AuthedEvent,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    // --- Health (unauthenticated) ---
    if (method === "GET" && path.endsWith("/v1/health")) {
      return json(200, {
        status: "ok",
        stage: cfg.stage,
        engine_version: ENGINE_VERSION,
        taxonomy_version: TAXONOMY_VERSION,
      });
    }

    // --- Taxonomy (served straight from the versioned package) ---
    if (method === "GET" && path.endsWith("/v1/taxonomy")) {
      return json(200, taxonomyDocument());
    }

    // Everything below is tenant-scoped.
    const tenant = tenantFrom(event);
    if (!tenant) return error(401, "unauthorized", "missing tenant context");

    // --- GET /v1/merchants/{match_key} ---
    if (method === "GET" && event.pathParameters?.["match_key"] !== undefined) {
      const matchKey = decodeURIComponent(event.pathParameters["match_key"]);
      const merchant = await repo.getMerchant(matchKey);
      if (!merchant) return error(404, "not_found", `no mapping for '${matchKey}'`);
      return json(200, merchant);
    }

    // --- GET /v1/overrides?user_ref=… ---
    if (method === "GET" && path.endsWith("/v1/overrides")) {
      const userRef = event.queryStringParameters?.["user_ref"];
      if (!userRef) return error(400, "bad_request", "user_ref query parameter is required");
      const overrides = await repo.listUserOverrides(tenant.tenant_id, userRef);
      return json(200, {
        user_ref: userRef,
        overrides: overrides.map((o) => ({ id: overrideId(userRef, o.match_key), ...o })),
      });
    }

    // --- DELETE /v1/overrides/{id} ---
    if (method === "DELETE" && event.pathParameters?.["id"] !== undefined) {
      const parts = event.pathParameters["id"].split("~");
      if (parts.length !== 2) return error(400, "bad_request", "malformed override id");
      const userRef = decodeURIComponent(parts[0]!);
      const matchKey = decodeURIComponent(parts[1]!);
      const removed = await repo.deleteUserOverride(tenant.tenant_id, userRef, matchKey);
      if (!removed.existed) return error(404, "not_found", "override not found");
      // Revocation is recorded in the log; history is never hard-deleted (spec §3.3).
      await repo.appendCorrectionLog({
        tenant: tenant.tenant_id,
        user_ref: userRef,
        match_key: matchKey,
        description: `override revoked`,
        corrected_category: removed.category ?? "",
        previous_category: removed.category,
        actor: "admin",
        scope_hint: "transaction",
        event_type: "revocation",
      });
      return json(200, { revoked: true, user_ref: userRef, match_key: matchKey });
    }

    return error(404, "not_found", `no route for ${method} ${path}`);
  } catch (err) {
    return toErrorResponse(err);
  }
  };
}

const cfg = loadConfig();
export const handler = makeReadHandler(new DynamoRepository(cfg), cfg);
