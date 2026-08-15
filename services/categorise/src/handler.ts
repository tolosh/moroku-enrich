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
        incomeSavingsEnabled: cfg.incomeSavingsEnabled,
      });
      return { id: txn.id, ...r };
    });

    // First sighting of an unknown merchant → its key goes onto the queue
    // (spec §4, unconditionally). The classifier is what respects
    // LLM_TIER_ENABLED: while the tier is off its SQS event source is disabled,
    // so keys accumulate on the queue unconsumed until the tier is switched on.
    // Only genuine unknowns enqueue: fallback implies the txn passed the
    // exclusion + credit tiers, but the `!excluded` guard is explicit (ext-004
    // §2) so transfers/withdrawals never enter the queue as classification noise.
    const uniqueUnknown = [
      ...new Set(
        results
          .filter((r) => r.source === "fallback" && !r.excluded)
          .map((r) => r.merchant.match_key),
      ),
    ];
    if (uniqueUnknown.length > 0) {
      await repo.enqueueUnknownMerchants(uniqueUnknown);
    }

    const summary = summarise(results, cfg.lowConfidenceThreshold);
    emitCategoriseMetrics(cfg.metricNamespace, cfg.stage, summary, results);

    // Usage metering (ext-001): atomic per-request counters, split test/live.
    // llm_classifications_triggered is the classifier's COGS counter (it
    // increments when it actually classifies), so categorise does not touch it.
    const increments: Record<string, number> = {
      transactions_categorised: results.length,
    };
    for (const [source, n] of Object.entries(summary.by_source)) {
      increments[`by_source_${source}`] = n ?? 0;
    }
    await repo.incrementUsage(
      tenant.tenant_id,
      tenant.environment,
      new Date().toISOString().slice(0, 7),
      increments,
    );

    return json(200, { results, summary });
  } catch (err) {
    return toErrorResponse(err);
  }
  };
}

const cfg = loadConfig();
export const handler = makeCategoriseHandler(new DynamoRepository(cfg), cfg);
