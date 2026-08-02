/**
 * POST /v1/categorise (spec §3.1) — batch categorisation.
 *
 * Validates at the boundary with zod, normalises each description once, batches
 * the lookup tiers (one BatchGetItem per tier), runs the pure engine chain per
 * transaction, enqueues first-sighting unknown merchants for the LLM tier, and
 * returns per-transaction results plus the summary trust number.
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { categorise, normaliseMerchant } from "@moroku-enrich/engine";
import {
  loadConfig,
  tenantFrom,
  parseJsonBody,
  validate,
  json,
  error,
  toErrorResponse,
  CategoriseRequestSchema,
  DynamoRepository,
  buildLookupContext,
  summarise,
  emitCategoriseMetrics,
  type AuthedEvent,
  type Config,
  type Repository,
} from "@moroku-enrich/service-lib";

/** Build the handler over an injected repo/config (tests supply fakes). */
export function makeCategoriseHandler(repo: Repository, cfg: Config) {
  return async (
    event: AuthedEvent,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const tenant = tenantFrom(event);
    if (!tenant) return error(401, "unauthorized", "missing tenant context");

    const req = validate(CategoriseRequestSchema, parseJsonBody(event));

    const prepared = req.transactions.map((txn) => ({
      txn,
      merchant: normaliseMerchant(txn.description),
    }));

    const lookups = await repo.batchGetLookups(
      tenant.tenant_id,
      prepared.map((p) => ({ matchKey: p.merchant.match_key, userRef: p.txn.user_ref })),
      cfg.promptVersion,
    );

    const results = prepared.map(({ txn }) => {
      const ctx = buildLookupContext(
        lookups,
        tenant.tenant_id,
        txn.user_ref,
        cfg.promptVersion,
      );
      const r = categorise(txn, ctx, {
        lowConfidenceThreshold: cfg.lowConfidenceThreshold,
        llmTrustThreshold: cfg.llmTrustThreshold,
      });
      return { id: txn.id, ...r };
    });

    // First sighting of an unknown merchant → queued for one-time LLM classification.
    if (cfg.llmTierEnabled) {
      const unknown = results
        .filter((r) => r.source === "fallback")
        .map((r) => r.merchant.match_key);
      await repo.enqueueUnknownMerchants(unknown);
    }

    const summary = summarise(results, cfg.lowConfidenceThreshold);
    emitCategoriseMetrics(cfg.metricNamespace, cfg.stage, summary, results);

    return json(200, { results, summary });
  } catch (err) {
    return toErrorResponse(err);
  }
  };
}

const cfg = loadConfig();
export const handler = makeCategoriseHandler(new DynamoRepository(cfg), cfg);
