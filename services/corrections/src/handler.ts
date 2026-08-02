/**
 * POST /v1/corrections (spec §3.2) — the learning loop.
 *
 * Every correction is appended to the immutable corrections_log. For
 * merchant-scope corrections the learning tiers fire:
 *   - user scope   — immediate override on (tenant, user_ref, match_key)
 *   - tenant scope  — once ≥ N distinct users in the tenant agree (or one
 *                     adviser/admin correction — dormant for consumer-only v1)
 *   - global        — a *candidate* is written to promotion_queue only; the
 *                     corrections handler has no access to merchants_global, so
 *                     one tenant can never write the global dictionary (guard).
 * transaction-scope corrections are logged but touch no mapping.
 *
 * Writes are idempotent via the Idempotency-Key header: a replay returns the
 * stored response without re-applying anything.
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { normaliseMerchant } from "@moroku-enrich/engine";
import {
  loadConfig,
  tenantFrom,
  parseJsonBody,
  validate,
  header,
  json,
  error,
  toErrorResponse,
  CorrectionsRequestSchema,
  DynamoRepository,
  tenantScopeReached,
  mergeCorroboration,
  qualifiesForGlobalReview,
  emitCorrectionMetrics,
  type AppliedScope,
  type AuthedEvent,
  type Config,
  type LearningThresholds,
  type Repository,
} from "@moroku-enrich/service-lib";

/** Build the handler over an injected repo/config (tests supply fakes). */
export function makeCorrectionsHandler(repo: Repository, cfg: Config) {
  return async (
    event: AuthedEvent,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const tenant = tenantFrom(event);
    if (!tenant) return error(401, "unauthorized", "missing tenant context");

    const idemKey = header(event.headers, "Idempotency-Key");
    if (idemKey) {
      const prior = await repo.getIdempotent(tenant.tenant_id, idemKey);
      if (prior !== undefined) {
        return json(200, prior, { "Idempotency-Replayed": "true" });
      }
    }

    const req = validate(CorrectionsRequestSchema, parseJsonBody(event));

    const thresholds: LearningThresholds = {
      tenantMinUsers: cfg.tenantPromotionMinUsers,
      globalMinTenants: cfg.globalPromotionMinTenants,
      globalMinUsers: cfg.globalPromotionMinUsers,
      competingMaxShare: 0.3,
    };

    const results = [];
    for (const c of req.corrections) {
      const { match_key } = normaliseMerchant(c.description);
      // zod applies these defaults at runtime; coalesce so the types are clean.
      const actor = c.actor ?? "consumer";
      const scopeHint = c.scope_hint ?? "merchant";

      await repo.appendCorrectionLog({
        tenant: tenant.tenant_id,
        user_ref: c.user_ref,
        match_key,
        description: c.description,
        previous_category: c.previous_category,
        corrected_category: c.corrected_category,
        corrected_classification: c.corrected_classification,
        actor,
        scope_hint: scopeHint,
      });

      // One-off recategorisation: logged, but never touches a mapping (spec §3.2).
      if (scopeHint === "transaction") {
        results.push({
          accepted: true,
          applied_scope: "transaction" satisfies AppliedScope,
          match_key,
          supersedes: null,
        });
        continue;
      }

      // Tier 1 — user scope, immediate.
      const { superseded } = await repo.putUserOverride(
        tenant.tenant_id,
        c.user_ref,
        match_key,
        c.corrected_category,
        c.corrected_classification,
      );
      let applied: AppliedScope = "user";

      // Tier 2 — tenant scope once enough distinct users agree.
      const distinctUsers = await repo.recordAgreement(
        tenant.tenant_id,
        match_key,
        c.corrected_category,
        c.user_ref,
      );
      if (tenantScopeReached(distinctUsers, actor, thresholds.tenantMinUsers)) {
        await repo.putTenantOverride(
          tenant.tenant_id,
          match_key,
          c.corrected_category,
          c.corrected_classification,
        );
        applied = "tenant";
      }

      // Tier 3 — accumulate cross-tenant corroboration; enqueue a global-review
      // CANDIDATE to promotion_queue only (never merchants_global).
      const existing = await repo.getCorroboration(match_key);
      const { item, metrics } = mergeCorroboration(
        existing,
        {
          match_key,
          category: c.corrected_category,
          tenant: tenant.tenant_id,
          user_ref: c.user_ref,
        },
        thresholds.competingMaxShare,
      );
      const qualifies = qualifiesForGlobalReview(metrics, thresholds);
      const status = qualifies ? "pending_review" : metrics.ambiguous ? "ambiguous" : "accumulating";
      await repo.putCorroboration(item, metrics.leadingCategory, status);
      if (qualifies) applied = "global_pending";

      results.push({
        accepted: true,
        applied_scope: applied,
        match_key,
        supersedes: superseded ? `${c.user_ref}~${match_key}` : null,
      });
    }

    const response = { results };
    if (idemKey) await repo.putIdempotent(tenant.tenant_id, idemKey, response);
    emitCorrectionMetrics(cfg.metricNamespace, cfg.stage, results.length);

    // Usage metering (ext-001) — after the loop so an idempotent replay (which
    // returns early above) never double-counts.
    await repo.incrementUsage(
      tenant.tenant_id,
      tenant.environment,
      new Date().toISOString().slice(0, 7),
      { corrections_received: results.length },
    );

    return json(200, response);
  } catch (err) {
    return toErrorResponse(err);
  }
  };
}

const cfg = loadConfig();
export const handler = makeCorrectionsHandler(new DynamoRepository(cfg), cfg);
