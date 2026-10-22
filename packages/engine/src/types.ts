/**
 * Engine domain types — the categorise result record and the injected lookup
 * contract. Zero AWS imports: the engine is a pure function of (input, lookups).
 * The handler batches DynamoDB (one BatchGetItem per tier per request, spec §6)
 * and supplies the already-resolved rows through `LookupContext`.
 */
import type { Classification } from "@moroku-enrich/taxonomy";
import type { NormalisedMerchant } from "./normaliser.js";

/** The tier that produced a result (spec §3.1 `source`). First hit wins. */
export type Source =
  // ext-008: gambling / crypto detection, evaluated before every other tier so it
  // can tag inflows (and transfer/BPAY deposits) that would otherwise short-circuit.
  | "high_risk"
  | "exclusion"
  | "savings"
  | "credit"
  | "income"
  | "user_override"
  | "tenant_override"
  | "mcc"
  | "dictionary"
  | "rules"
  | "llm_cache"
  | "fallback";

/**
 * One transaction as accepted by the engine (subset of spec §3.1 request).
 * Optional fields tolerate an explicit `undefined` so a zod-parsed request maps
 * in directly under exactOptionalPropertyTypes.
 */
export interface CategoriseInput {
  /** Client-supplied opaque id, echoed back by the handler. */
  id?: string | undefined;
  description: string;
  /** ISO 18245 MCC — open banking has it, statements don't. */
  mcc?: string | undefined;
  /** Signed; negative = debit. */
  amount?: number | undefined;
  currency?: string | undefined;
  date?: string | undefined;
  /** e.g. DocuScan's category code — feeds the exclusion tier. */
  source_category_code?: string | undefined;
  source_category_description?: string | undefined;
  account_type?: string | undefined;
  /** Opaque per-tenant user id — enables user-scoped overrides. */
  user_ref?: string | undefined;
  // --- ext-008 (ENR-25): extra identity fields the gambling/crypto detector
  // matches on. Open-banking feeds carry these; statement/DocuScan feeds set
  // only `description`. All fold into the detector's haystack except
  // `biller_code`, which is matched exactly against the BPAY biller table. ---
  /** Cleaner merchant/payee name when the feed separates it from `description`. */
  merchant_name?: string | undefined;
  /** Free-text payment reference (e.g. a PayID transfer narrative). */
  reference?: string | undefined;
  /** BPAY biller display name. */
  biller_name?: string | undefined;
  /** BPAY biller code — matched exactly against the biller table. */
  biller_code?: string | undefined;
}

/** A user- or tenant-scoped override row (spec §4 steps 2 / 2b). */
export interface OverrideRecord {
  category: string;
  /** Stored classification if the correction pinned one (spec §3.2). */
  classification?: Classification;
}

/** A global dictionary row (spec §4 step 4, table `merchants_global`). */
export interface DictionaryRecord {
  category: string;
  classification?: Classification;
  /** Per-row confidence, 0.85–0.98 (spec §4). */
  confidence: number;
  canonical_name?: string;
  ambiguous?: boolean;
}

/** A cached one-time LLM classification (spec §4 step 6, table `llm_cache`). */
export interface LlmCacheRecord {
  category: string;
  classification?: Classification;
  /** Model-reported confidence; below the trust threshold it is not used. */
  confidence: number;
}

/**
 * Synchronous, pre-resolved lookups injected into the engine. The handler
 * implements these over batched DynamoDB results; tests supply fakes. Keeping
 * them synchronous is what keeps the engine pure and free of I/O.
 */
export interface LookupContext {
  userOverride(matchKey: string): OverrideRecord | undefined;
  tenantOverride(matchKey: string): OverrideRecord | undefined;
  dictionary(matchKey: string): DictionaryRecord | undefined;
  llmCache(matchKey: string): LlmCacheRecord | undefined;
}

/** Tunable thresholds (sourced from SSM/env by the handler; sane defaults here). */
export interface ChainOptions {
  /** Confidence below this earns a `low_confidence` flag; also the confident_pct cutoff (spec §3.1). */
  lowConfidenceThreshold?: number;
  /** LLM-cache rows below this confidence are not trusted (spec §4 step 6). */
  llmTrustThreshold?: number;
  /**
   * ext-006 income recognition + savings subtyping. Defaults to true. Set false
   * to restore exactly the 1.2.0 outcomes (credits → uncategorised_credit, all
   * transfers → transfer) without a code change.
   */
  incomeSavingsEnabled?: boolean;
}

/** The full per-transaction result record (spec §3.1 response). */
export interface EnrichResult {
  category: string;
  classification: Classification;
  confidence: number;
  source: Source;
  /** true for transfer / atm / cash-advance (spec §4 step 1). */
  excluded: boolean;
  /** e.g. ["unverified"] on fallback, ["low_confidence"] under threshold. */
  flags: string[];
  merchant: NormalisedMerchant;
  engine_version: string;
  taxonomy_version: string;
  // --- ext-008 (ENR-25) ---
  /**
   * Cash-flow direction from the sign of `amount`: "in" for a credit, "out" for
   * a debit, omitted when `amount` is absent. Lets a consumer net gambling
   * deposits against winnings and keep crypto buys separate from sells.
   */
  direction?: "in" | "out";
  /**
   * The id of the rule/MCC/biller that produced the tag, for traceability
   * (spec §6). Set for high_risk, rules and income hits; absent otherwise.
   */
  matched_rule_id?: string;
}

/** A lookup context that resolves nothing — for tests and empty batches. */
export const EMPTY_LOOKUPS: LookupContext = {
  userOverride: () => undefined,
  tenantOverride: () => undefined,
  dictionary: () => undefined,
  llmCache: () => undefined,
};
