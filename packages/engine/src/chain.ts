/**
 * The signal chain (spec §4) — evaluated in strict priority order, first hit
 * wins. Pure function of (input, lookups, options); all I/O is the handler's
 * job. Every input path runs the full chain; statements simply have no MCC, so
 * step 3 is skipped for them.
 *
 *   1  exclusion        transfer/ATM/cash-advance      excluded, conf 1.0
 *   2  user_override    (tenant,user,match_key)        conf 1.0
 *   2b tenant_override  (tenant,match_key)             conf 0.98
 *   3  mcc              ISO 18245 → taxonomy           conf 0.95
 *   4  dictionary       merchants_global               conf per row
 *   5  rules            legacy regex floor (empty)     conf 0.7
 *   6  llm_cache        cached one-time classification conf per row (≥ trust)
 *   7  fallback         other_expenses / essential     flags: [unverified]
 */
import {
  defaultClassificationFor,
  type Classification,
} from "@moroku-enrich/taxonomy";
import { normaliseMerchant, type NormalisedMerchant } from "./normaliser.js";
import { ENGINE_VERSION, TAXONOMY_VERSION } from "./version.js";
import { CATEGORY } from "./categories.js";
import { isExclusion } from "./exclusions.js";
import { lookupMcc } from "./mcc.js";
import { applyRules, RULES_CONFIDENCE } from "./rules.js";
import type {
  CategoriseInput,
  ChainOptions,
  EnrichResult,
  LookupContext,
  Source,
} from "./types.js";

/** Category returned by the exclusion tier (spec §4 step 1). */
const TRANSFER_CATEGORY = "transfer";
/** Fallback bucket (kickoff: one of the 16, forced essential on this path). */
const FALLBACK_CATEGORY = CATEGORY.OTHER_EXPENSES;
/** The conservative fallback is always essential — never discretionary (spec §1.3, kickoff). */
const FALLBACK_CLASSIFICATION: Classification = "essential";
/** A low but non-zero confidence for unverified fallback results. */
export const FALLBACK_CONFIDENCE = 0.3;

const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.8; // spec §3.1 confident_pct cutoff
const DEFAULT_LLM_TRUST_THRESHOLD = 0.6; // spec §4 step 6

/**
 * Resolve a classification for a category: an explicit one (from a correction /
 * dictionary row) wins; otherwise the taxonomy default; otherwise `essential`
 * as the conservative safety net (also the value while EXPENSE_CATEGORIES is
 * still empty and taxonomy defaults are unavailable).
 */
function resolveClassification(category: string, explicit?: Classification): Classification {
  return explicit ?? defaultClassificationFor(category) ?? "essential";
}

/** Assemble a result, attaching a `low_confidence` flag under the threshold. */
function build(
  source: Source,
  category: string,
  classification: Classification,
  confidence: number,
  merchant: NormalisedMerchant,
  opts: { excluded?: boolean; flags?: string[]; lowConfidenceThreshold: number },
): EnrichResult {
  const flags = [...(opts.flags ?? [])];
  // Fallback already signals uncertainty via `unverified`; don't double-flag it.
  if (
    source !== "fallback" &&
    confidence < opts.lowConfidenceThreshold &&
    !flags.includes("low_confidence")
  ) {
    flags.push("low_confidence");
  }
  return {
    category,
    classification,
    confidence,
    source,
    excluded: opts.excluded ?? false,
    flags,
    merchant,
    engine_version: ENGINE_VERSION,
    taxonomy_version: TAXONOMY_VERSION,
  };
}

/**
 * Categorise a single transaction. `lookups` supplies pre-resolved override /
 * dictionary / llm_cache rows for this transaction's match_key.
 */
export function categorise(
  input: CategoriseInput,
  lookups: LookupContext,
  options: ChainOptions = {},
): EnrichResult {
  const lowConfidenceThreshold =
    options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const llmTrustThreshold = options.llmTrustThreshold ?? DEFAULT_LLM_TRUST_THRESHOLD;
  const merchant = normaliseMerchant(input.description);
  const common = { lowConfidenceThreshold };

  // 1 — Exclusions. Returned, not dropped.
  if (isExclusion(input)) {
    return build(
      "exclusion",
      TRANSFER_CATEGORY,
      resolveClassification(TRANSFER_CATEGORY),
      1.0,
      merchant,
      { excluded: true, ...common },
    );
  }

  // 2 — User override.
  const userOverride = lookups.userOverride(merchant.match_key);
  if (userOverride) {
    return build(
      "user_override",
      userOverride.category,
      resolveClassification(userOverride.category, userOverride.classification),
      1.0,
      merchant,
      common,
    );
  }

  // 2b — Tenant override.
  const tenantOverride = lookups.tenantOverride(merchant.match_key);
  if (tenantOverride) {
    return build(
      "tenant_override",
      tenantOverride.category,
      resolveClassification(tenantOverride.category, tenantOverride.classification),
      0.98,
      merchant,
      common,
    );
  }

  // 3 — MCC (skipped when the input has no MCC, e.g. statements).
  const mcc = lookupMcc(input.mcc);
  if (mcc) {
    return build(
      "mcc",
      mcc.category,
      resolveClassification(mcc.category),
      mcc.confidence,
      merchant,
      common,
    );
  }

  // 4 — Global dictionary.
  const dict = lookups.dictionary(merchant.match_key);
  if (dict) {
    return build(
      "dictionary",
      dict.category,
      resolveClassification(dict.category, dict.classification),
      dict.confidence,
      merchant,
      common,
    );
  }

  // 5 — Rules (legacy floor; empty placeholder until the Kanopi ruleset lands).
  const rule = applyRules(merchant, input);
  if (rule) {
    return build(
      "rules",
      rule.category,
      resolveClassification(rule.category),
      RULES_CONFIDENCE,
      merchant,
      common,
    );
  }

  // 6 — LLM cache (only when confidence clears the trust threshold, spec §4).
  const cache = lookups.llmCache(merchant.match_key);
  if (cache && cache.confidence >= llmTrustThreshold) {
    return build(
      "llm_cache",
      cache.category,
      resolveClassification(cache.category, cache.classification),
      cache.confidence,
      merchant,
      common,
    );
  }

  // 7 — Conservative fallback. other_expenses / essential / unverified — the
  // classification is FORCED essential here, overriding any taxonomy default
  // for other_expenses (kickoff). Never discretionary.
  return build(
    "fallback",
    FALLBACK_CATEGORY,
    FALLBACK_CLASSIFICATION,
    FALLBACK_CONFIDENCE,
    merchant,
    { flags: ["unverified"], ...common },
  );
}
